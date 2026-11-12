import { randomUUID } from 'node:crypto'
import { Router, type NextFunction, type Request, type Response } from 'express'
import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { toolsForScopes } from '../services/tools/registry.js'
import type { MuseTool } from '../services/tools/types.js'
import type { ApprovalMode } from './annotations.js'
import { McpDispatcher, type DispatchDeps } from './dispatch.js'
import type { McpAuthPort, McpIdentity } from './ports.js'
import type { ResourceProvider } from './resources.js'
import { createMuseServer, type SessionState } from './server.js'
import { sessionTools } from './session-tools.js'

const SESSION_IDLE_MS = 30 * 60_000
const MAX_SESSIONS = 200

export interface McpHttpOptions {
  port: () => McpAuthPort
  execute: DispatchDeps['execute']
  capture: DispatchDeps['capture']
  resources: (scopes: readonly string[]) => ResourceProvider
  tools?: readonly MuseTool[]
  publicUrl: string
  /** Extra Host values accepted besides PUBLIC_URL's host (e.g. "localhost:3002"). */
  allowedHosts?: string[]
  /** Extra browser origins accepted (e.g. the MCP Inspector at http://localhost:6274). */
  allowedOrigins?: string[]
}

interface Session {
  id: string
  token: string
  state: SessionState
  server: Server
  transport: StreamableHTTPServerTransport
  lastSeen: number
}

type AuthedRequest = Request & { mcpIdentity?: McpIdentity; mcpToken?: string }

function bearer(req: Request): string | null {
  const header = req.get('authorization')
  return header?.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() || null : null
}

export class McpSessions {
  readonly sessions = new Map<string, Session>()
  private unsubscribe: (() => void) | null = null

  constructor(private readonly options: McpHttpOptions, private readonly dispatcher: McpDispatcher) {}

  listen() {
    this.unsubscribe?.()
    this.unsubscribe = this.options.port().onModeChange((userId, clientId, mode) => { void this.applyModeChange(userId, clientId, mode) })
  }

  close() {
    this.unsubscribe?.()
    for (const session of this.sessions.values()) void session.transport.close()
    this.sessions.clear()
  }

  /** Re-annotates tools in every affected open session and tells clients to refetch the list. */
  async applyModeChange(userId: string, clientId: string | null, mode: ApprovalMode) {
    for (const session of [...this.sessions.values()]) {
      if (session.state.identity.userId !== userId) continue
      if (clientId) {
        if (session.state.identity.clientId !== clientId) continue
        session.state.mode = mode
      } else {
        // Default changed: re-resolve, because a client override may still win.
        const identity = await this.options.port().verifyAccessToken(session.token)
        if (!identity) { await this.drop(session.id); continue }
        session.state.identity = identity
        session.state.mode = identity.approvalMode
      }
      await session.server.sendToolListChanged().catch(() => {})
    }
  }

  async open(identity: McpIdentity, token: string): Promise<{ server: Server; transport: StreamableHTTPServerTransport }> {
    this.sweep()
    if (this.sessions.size >= MAX_SESSIONS) this.evictOldest()
    const settings = await this.options.port().getMcpSettings(identity.userId)
    const state: SessionState = { identity, mode: identity.approvalMode, timezone: settings.timezone || 'UTC' }
    const scoped = toolsForScopes(identity.scopes, this.options.tools)
    let tools: MuseTool[] = scoped
    const extra = sessionTools(state, this.options.port(), this.dispatcher, () => tools)
    tools = [...scoped, ...extra.filter(tool => identity.scopes.includes(tool.scope))]
    const server = createMuseServer(state, { tools, dispatcher: this.dispatcher, resources: this.options.resources(identity.scopes) })
    const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: id => { this.sessions.set(id, { id, token, state, server, transport, lastSeen: Date.now() }) },
      onsessionclosed: id => { this.sessions.delete(id) }
    })
    await server.connect(transport)
    return { server, transport }
  }

  find(id: string, identity: McpIdentity): Session | undefined {
    const session = this.sessions.get(id)
    // A session is bound to the client that opened it.
    if (!session || session.state.identity.userId !== identity.userId || session.state.identity.clientId !== identity.clientId) return undefined
    session.lastSeen = Date.now()
    return session
  }

  private async drop(id: string) {
    const session = this.sessions.get(id)
    this.sessions.delete(id)
    await session?.transport.close().catch(() => {})
  }

  private sweep(now = Date.now()) {
    for (const session of this.sessions.values()) if (now - session.lastSeen > SESSION_IDLE_MS) void this.drop(session.id)
  }

  private evictOldest() {
    const oldest = [...this.sessions.values()].sort((a, b) => a.lastSeen - b.lastSeen)[0]
    if (oldest) void this.drop(oldest.id)
  }
}

export function createMcpRouter(options: McpHttpOptions): { router: Router; sessions: McpSessions; dispatcher: McpDispatcher } {
  const publicUrl = new URL(options.publicUrl)
  const resourceMetadata = new URL('/.well-known/oauth-protected-resource', publicUrl).toString()
  const hosts = new Set([publicUrl.host, ...(options.allowedHosts ?? [])].map(host => host.toLowerCase()))
  const origins = new Set([publicUrl.origin, ...(options.allowedOrigins ?? [])])
  const dispatcher = new McpDispatcher({ port: options.port(), execute: options.execute, capture: options.capture })
  const sessions = new McpSessions(options, dispatcher)
  sessions.listen()
  options.port().setApprovalExecutor(approval => dispatcher.executeApproval(approval))

  const router = Router()

  // DNS-rebinding protection: only our public host (and configured local hosts), and no foreign browser origins.
  router.use((req, res, next) => {
    const host = (req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim().toLowerCase()
    const origin = req.get('origin')
    // An allowed entry without a port ("localhost") matches that host on any port.
    const hostAllowed = hosts.has(host) || hosts.has(host.replace(/:\d+$/, ''))
    if (!hostAllowed) return void res.status(403).json({ error: 'Host not allowed for muse-mcp.' })
    if (origin && !origins.has(origin)) return void res.status(403).json({ error: 'Origin not allowed for muse-mcp.' })
    next()
  })

  router.use(async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const token = bearer(req)
      const identity = token ? await options.port().verifyAccessToken(token) : null
      if (!token || !identity) {
        res.set('WWW-Authenticate', `Bearer resource_metadata="${resourceMetadata}"${token ? ', error="invalid_token"' : ''}`)
        return void res.status(401).json({ error: token ? 'Invalid or expired token.' : 'Authentication required.' })
      }
      req.mcpIdentity = identity
      req.mcpToken = token
      next()
    } catch (error) { next(error) }
  })

  router.all('/', async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const identity = req.mcpIdentity!
      const sessionId = req.get('mcp-session-id')
      if (sessionId) {
        const session = sessions.find(sessionId, identity)
        if (!session) return void res.status(404).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Session not found. Start a new session.' }, id: null })
        return void await session.transport.handleRequest(req, res, req.body)
      }
      if (req.method !== 'POST' || !isInitializeRequest(req.body)) {
        return void res.status(400).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Send an initialize request first.' }, id: null })
      }
      const { transport } = await sessions.open(identity, req.mcpToken!)
      await transport.handleRequest(req, res, req.body)
    } catch (error) { next(error) }
  })

  return { router, sessions, dispatcher }
}
