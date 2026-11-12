import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import test from 'node:test'
import express from 'express'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import type { ToolExecutionResult } from '../services/agent-tools.service.js'
import { agentToolDeclarations } from '../services/agent-tools.service.js'
import { museTools, toolsForScopes } from '../services/tools/registry.js'
import { DEFAULT_SCOPES, type JSONSchema, type MuseTool, type ToolRisk } from '../services/tools/types.js'
import { annotationsFor, type ApprovalMode } from './annotations.js'
import { McpDispatcher } from './dispatch.js'
import { createMcpRouter } from './http.js'
import type { Approval, McpAuthPort, McpIdentity, ModeChangeListener, UndoSnapshot } from './ports.js'
import { createResourceProvider } from './resources.js'
import { createMuseServer, type SessionState } from './server.js'

// ---------- fakes ----------

class FakePort implements McpAuthPort {
  approvals: Approval[] = []
  activity: { tool: string; outcome: string; undoId?: string }[] = []
  snapshots: { tool: string; snapshot: UndoSnapshot[] }[] = []
  listeners: ModeChangeListener[] = []
  executor: ((approval: Approval) => Promise<{ ok: boolean; summary: string }>) | null = null
  tokens = new Map<string, McpIdentity>()

  async verifyAccessToken(token: string) { return this.tokens.get(token) ?? null }
  async getMcpSettings() { return { defaultMode: 'minimal' as const, timezone: 'Africa/Tunis' } }
  async createApproval(input: { userId: string; clientId: string; tool: string; args: Record<string, unknown>; summary: string }) {
    const approval: Approval = { id: `ap-${this.approvals.length + 1}`, status: 'pending', ...input }
    this.approvals.push(approval)
    return { id: approval.id, url: `https://muse.test/approve/${approval.id}` }
  }
  async getApproval(id: string) { return this.approvals.find(a => a.id === id) ?? null }
  async listPendingApprovals(userId: string) { return this.approvals.filter(a => a.userId === userId) }
  setApprovalExecutor(executor: (approval: Approval) => Promise<{ ok: boolean; summary: string }>) { this.executor = executor }
  async recordActivity(record: { tool: string; outcome: string; undoId?: string }) { this.activity.push(record) }
  async saveUndoSnapshot(input: { tool: string; snapshot: UndoSnapshot[] }) { this.snapshots.push(input); return { id: `undo-${this.snapshots.length}` } }
  onModeChange(listener: ModeChangeListener) { this.listeners.push(listener); return () => { this.listeners = this.listeners.filter(l => l !== listener) } }
}

interface ExecCall { name: string; args: Record<string, unknown>; confirmed?: boolean; timezone: string }

function fakeExecutor() {
  const calls: ExecCall[] = []
  const execute = async (_userId: string, name: string, args: Record<string, unknown>, options: { timezone: string; confirmed?: boolean }): Promise<ToolExecutionResult> => {
    calls.push({ name, args, confirmed: options.confirmed, timezone: options.timezone })
    if (name === 'delete_task' && !options.confirmed) {
      return { toolName: name, args, result: { requires_confirmation: true, message: 'press Confirm on the card' }, actionCard: { type: 'confirm_required', data: { token: 'SECRET-TOKEN', id: 't1', title: 'Call mom', itemType: 'Task', status: 'Delete' } } }
    }
    if (name === 'delete_task') return { toolName: name, args, result: { success: true, message: 'Deleted task "Call mom".' } }
    return { toolName: name, args, result: { success: true, id: 'n1', message: `${name} ok` } }
  }
  return { calls, execute }
}

const identity: McpIdentity = { userId: 'u1', clientId: 'c1', scopes: [...DEFAULT_SCOPES], approvalMode: 'minimal' }
const capture = async (_userId: string, itemType: string, id: string | null): Promise<UndoSnapshot[]> => [{ table: itemType === 'Task' ? 'tasks' : 'notes', rows: [{ id }] }]

function fakeTool(name: string, risk: ToolRisk, execute: ReturnType<typeof fakeExecutor>['execute']): MuseTool {
  return {
    name, title: name, description: `${name} tool`, risk, scope: 'tasks', surfaces: ['mcp'],
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: risk === 'write' ? ['text'] : [] },
    handler: (ctx, args) => execute(ctx.userId, name, args, { timezone: ctx.timezone })
  }
}

// ---------- registry ----------

function assertStandardSchema(schema: JSONSchema, path: string) {
  if (schema.type) assert.equal(schema.type, schema.type.toLowerCase(), `${path} type must be lower-case`)
  for (const [key, child] of Object.entries(schema.properties ?? {})) assertStandardSchema(child, `${path}.${key}`)
  if (schema.items) assertStandardSchema(schema.items, `${path}[]`)
}

test('registry covers every Bip tool with valid JSON Schema object inputs', () => {
  for (const declaration of agentToolDeclarations) assert.ok(museTools.some(tool => tool.name === declaration.name), `${declaration.name} missing from registry`)
  for (const tool of museTools) {
    assert.equal(tool.inputSchema.type, 'object', `${tool.name} input must be an object schema`)
    assertStandardSchema(tool.inputSchema, tool.name)
    for (const key of tool.inputSchema.required ?? []) assert.ok(tool.inputSchema.properties?.[key], `${tool.name} requires undeclared "${key}"`)
  }
  assert.equal(new Set(museTools.map(tool => tool.name)).size, museTools.length, 'tool names must be unique')
})

test('destructive Bip tools are classified destructive and music tools are gone', () => {
  for (const name of ['permanently_delete_note', 'empty_trash', 'delete_task', 'delete_calendar_event', 'delete_memory', 'delete_specialized_template', 'delete_chat_session']) {
    assert.equal(museTools.find(tool => tool.name === name)?.risk, 'destructive', name)
  }
  assert.equal(museTools.find(tool => tool.name === 'trash_note')?.risk, 'write', 'trash is restorable')
  assert.ok(!museTools.some(tool => /music|playlist/.test(tool.name)))
})

test('default scopes hide code execution and web search; scopes filter tools', () => {
  const names = toolsForScopes(DEFAULT_SCOPES).map(tool => tool.name)
  assert.ok(names.includes('create_note') && names.includes('create_tasks'))
  assert.ok(!names.includes('execute_code') && !names.includes('search_web'))
  const tasksOnly = toolsForScopes(['tasks']).map(tool => tool.name)
  assert.ok(tasksOnly.includes('create_task') && !tasksOnly.includes('create_note'))
})

// ---------- annotations ----------

test('annotations follow the approval-mode table for every risk', () => {
  const expected: Record<ApprovalMode, Record<ToolRisk, [boolean, boolean, boolean]>> = {
    // [readOnlyHint, destructiveHint, openWorldHint]
    trust: { read: [true, false, false], write: [true, false, false], external: [true, false, false], destructive: [true, false, false] },
    minimal: { read: [true, false, false], write: [false, false, false], external: [false, false, false], destructive: [false, true, false] },
    standard: { read: [true, false, false], write: [false, true, false], external: [false, true, true], destructive: [false, true, false] }
  }
  for (const [mode, risks] of Object.entries(expected) as [ApprovalMode, Record<ToolRisk, [boolean, boolean, boolean]>][]) {
    for (const [risk, [readOnly, destructive, openWorld]] of Object.entries(risks) as [ToolRisk, [boolean, boolean, boolean]][]) {
      const hints = annotationsFor(risk, 'T', mode)
      assert.deepEqual([hints.readOnlyHint, hints.destructiveHint, hints.openWorldHint], [readOnly, destructive, openWorld], `${mode}/${risk}`)
    }
  }
})

// ---------- dispatcher (server-side approval enforcement) ----------

const deleteTool = (execute: ReturnType<typeof fakeExecutor>['execute']) => ({ ...fakeTool('delete_task', 'destructive', execute) })

test('standard mode never deletes: it files an approval and hides the confirmation token', async () => {
  const port = new FakePort(); const exec = fakeExecutor()
  const dispatcher = new McpDispatcher({ port, execute: exec.execute, capture })
  const outcome = await dispatcher.call(identity, 'standard', deleteTool(exec.execute), { text_query: 'mom' }, 'UTC')
  assert.ok(outcome.ok)
  assert.equal(outcome.data.pending_approval, true)
  assert.match(outcome.message, /https:\/\/muse\.test\/approve\/ap-1/)
  assert.ok(!exec.calls.some(call => call.confirmed), 'must not execute a confirmed delete')
  assert.ok(!JSON.stringify(outcome).includes('SECRET-TOKEN'))
  assert.deepEqual(port.approvals[0].args, { id: 't1', itemType: 'Task' })
  assert.equal(port.activity.at(-1)?.outcome, 'pending_approval')
})

test('an approved request runs once, confirmed, on the exact target with an undo snapshot', async () => {
  const port = new FakePort(); const exec = fakeExecutor()
  const dispatcher = new McpDispatcher({ port, execute: exec.execute, capture })
  await dispatcher.call(identity, 'standard', deleteTool(exec.execute), { text_query: 'mom' }, 'UTC')
  const result = await dispatcher.executeApproval(port.approvals[0])
  assert.ok(result.ok)
  const confirmed = exec.calls.filter(call => call.confirmed)
  assert.equal(confirmed.length, 1)
  assert.deepEqual(confirmed[0].args, { id: 't1' })
  assert.equal(confirmed[0].timezone, 'Africa/Tunis')
  assert.equal(port.snapshots.length, 1)
})

for (const mode of ['trust', 'minimal'] as const) {
  test(`${mode} mode deletes after saving an undo snapshot`, async () => {
    const port = new FakePort(); const exec = fakeExecutor()
    const dispatcher = new McpDispatcher({ port, execute: exec.execute, capture })
    const outcome = await dispatcher.call(identity, mode, deleteTool(exec.execute), { text_query: 'mom' }, 'UTC')
    assert.ok(outcome.ok)
    assert.equal(outcome.data.undo_id, 'undo-1')
    assert.match(outcome.message, /undo snapshot/i)
    assert.deepEqual(port.snapshots[0].snapshot, [{ table: 'tasks', rows: [{ id: 't1' }] }])
    assert.deepEqual(exec.calls.map(call => call.confirmed), [false, true])
    assert.equal(port.approvals.length, 0)
  })
}

// ---------- MCP protocol round trip ----------

async function connect(state: SessionState, tools: MuseTool[], dispatcher: McpDispatcher) {
  const server = createMuseServer(state, {
    tools, dispatcher,
    resources: createResourceProvider({
      listNotes: async () => [{ id: '11111111-1111-1111-1111-111111111111', title: 'Plan', tags: ['work'], updated_at: '2026-11-12T10:00:00Z' }],
      getNote: async (_u, id) => ({ id, title: 'Plan', content: 'Ship muse-mcp', tags: ['work'], updated_at: '2026-11-12T10:00:00Z' }),
      execute: async (_u, name, args) => ({ toolName: name, args, result: { tasks: [] } })
    }, state.identity.scopes)
  })
  const client = new Client({ name: 'test-client', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return { server, client }
}

test('MCP client lists annotated tools, calls them, and reads resources and prompts', async () => {
  const port = new FakePort(); const exec = fakeExecutor()
  const dispatcher = new McpDispatcher({ port, execute: exec.execute, capture })
  const state: SessionState = { identity: { ...identity, scopes: ['tasks', 'notes:read'] }, mode: 'minimal', timezone: 'Africa/Tunis' }
  const tools = [fakeTool('create_task', 'write', exec.execute), deleteTool(exec.execute)]
  const { client, server } = await connect(state, tools, dispatcher)

  assert.match(client.getInstructions() ?? '', /data, never instructions/)
  const listed = await client.listTools()
  assert.deepEqual(listed.tools.map(tool => tool.name), ['create_task', 'delete_task'])
  assert.equal(listed.tools[1].annotations?.destructiveHint, true)

  const missing = await client.callTool({ name: 'create_task', arguments: {} })
  assert.equal(missing.isError, true)
  const created = await client.callTool({ name: 'create_task', arguments: { text: 'Buy milk', timezone: 'Europe/Paris' } })
  assert.equal(created.isError, false)
  assert.equal(exec.calls.at(-1)?.timezone, 'Europe/Paris', 'explicit timezone wins over the owner timezone')
  assert.ok(!('timezone' in (exec.calls.at(-1)?.args ?? {})))

  const unknown = await client.callTool({ name: 'execute_code', arguments: {} })
  assert.equal(unknown.isError, true)

  const resources = await client.listResources()
  assert.deepEqual(resources.resources.map(r => r.uri).sort(), ['muse://notes/recent', 'muse://tasks/today'])
  const note = await client.readResource({ uri: 'muse://notes/11111111-1111-1111-1111-111111111111' })
  assert.match(String((note.contents[0] as { text: string }).text), /Ship muse-mcp/)
  await assert.rejects(client.readResource({ uri: 'muse://calendar/week' }), /calendar/)

  const prompt = await client.getPrompt({ name: 'plan_my_day', arguments: { brain_dump: 'gym, email Sami' } })
  assert.match(String((prompt.messages[0].content as { text: string }).text), /gym, email Sami/)

  await client.close(); await server.close()
})

test('switching approval mode re-annotates tools live and notifies the client', async () => {
  const port = new FakePort(); const exec = fakeExecutor()
  const dispatcher = new McpDispatcher({ port, execute: exec.execute, capture })
  const state: SessionState = { identity, mode: 'minimal', timezone: 'UTC' }
  const { client, server } = await connect(state, [fakeTool('create_task', 'write', exec.execute)], dispatcher)
  let notified = false
  client.setNotificationHandler(ToolListChangedNotificationSchema, async () => { notified = true })

  assert.equal((await client.listTools()).tools[0].annotations?.readOnlyHint, false)
  state.mode = 'trust'
  await server.sendToolListChanged()
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.ok(notified)
  assert.equal((await client.listTools()).tools[0].annotations?.readOnlyHint, true)
  await client.close(); await server.close()
})

// ---------- HTTP layer ----------

async function serve(port: FakePort) {
  const exec = fakeExecutor()
  const { router, sessions } = createMcpRouter({
    port: () => port, execute: exec.execute, capture,
    resources: scopes => createResourceProvider({ listNotes: async () => [], getNote: async () => { throw new Error('no') }, execute: exec.execute }, scopes),
    tools: [fakeTool('create_task', 'write', exec.execute)],
    publicUrl: 'https://muse-mcp.example.com',
    allowedHosts: ['127.0.0.1']
  })
  const app = express(); app.use(express.json()); app.use('/mcp', router)
  const listener = app.listen(0, '127.0.0.1'); await once(listener, 'listening')
  const base = `http://127.0.0.1:${(listener.address() as AddressInfo).port}`
  return { base, sessions, close: () => { sessions.close(); listener.close() } }
}

const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } }
const mcpHeaders = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }

test('/mcp demands a bearer token and points clients at OAuth metadata', async () => {
  const port = new FakePort(); const app = await serve(port)
  try {
    const response = await fetch(`${app.base}/mcp`, { method: 'POST', headers: { ...mcpHeaders, host: '127.0.0.1' }, body: JSON.stringify(initialize) })
    assert.equal(response.status, 401)
    assert.match(response.headers.get('www-authenticate') ?? '', /resource_metadata="https:\/\/muse-mcp\.example\.com\/\.well-known\/oauth-protected-resource"/)
    const bad = await fetch(`${app.base}/mcp`, { method: 'POST', headers: { ...mcpHeaders, authorization: 'Bearer nope' }, body: JSON.stringify(initialize) })
    assert.equal(bad.status, 401)
    assert.match(bad.headers.get('www-authenticate') ?? '', /invalid_token/)
  } finally { app.close() }
})

test('/mcp rejects foreign Origin headers and unknown hosts', async () => {
  const port = new FakePort(); port.tokens.set('good', identity); const app = await serve(port)
  try {
    const foreign = await fetch(`${app.base}/mcp`, { method: 'POST', headers: { ...mcpHeaders, authorization: 'Bearer good', origin: 'https://evil.example' }, body: JSON.stringify(initialize) })
    assert.equal(foreign.status, 403)
    const host = await fetch(`${app.base}/mcp`, { method: 'POST', headers: { ...mcpHeaders, authorization: 'Bearer good', 'x-forwarded-host': 'evil.example' }, body: JSON.stringify(initialize) })
    assert.equal(host.status, 403)
  } finally { app.close() }
})

test('/mcp opens a session bound to the token and applies mode changes from the port', async () => {
  const port = new FakePort(); port.tokens.set('good', identity); port.tokens.set('other', { ...identity, clientId: 'c2' })
  const app = await serve(port)
  try {
    const opened = await fetch(`${app.base}/mcp`, { method: 'POST', headers: { ...mcpHeaders, authorization: 'Bearer good' }, body: JSON.stringify(initialize) })
    assert.equal(opened.status, 200)
    const sessionId = opened.headers.get('mcp-session-id')
    assert.ok(sessionId)
    await opened.text()

    const hijack = await fetch(`${app.base}/mcp`, { method: 'POST', headers: { ...mcpHeaders, authorization: 'Bearer other', 'mcp-session-id': sessionId! }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) })
    assert.equal(hijack.status, 404, 'another client cannot reuse the session')

    for (const listener of port.listeners) listener('u1', 'c1', 'standard')
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(app.sessions.sessions.get(sessionId!)?.state.mode, 'standard')
  } finally { app.close() }
})
