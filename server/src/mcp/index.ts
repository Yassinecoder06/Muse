import { executeAgentTool } from '../services/agent-tools.service.js'
import { notes } from '../services/note.repository.js'
import { env, mcpPublicUrl } from '../utils/env.js'
import { createMcpRouter } from './http.js'
import { mcpAuthPort } from './ports.js'
import { createResourceProvider } from './resources.js'
import { captureSnapshots } from './snapshots.js'

const list = (value: string) => value.split(',').map(item => item.trim()).filter(Boolean)

/**
 * Builds the /mcp router with Muse's real services. Install the auth port
 * (setMcpAuthPort) before calling this, so approvals and mode changes are wired.
 */
export function createMuseMcp() {
  return createMcpRouter({
    port: mcpAuthPort,
    execute: (userId, name, args, options) => executeAgentTool(userId, name, args as Record<string, any>, options),
    capture: captureSnapshots,
    resources: scopes => createResourceProvider({
      listNotes: userId => notes.list(userId),
      getNote: (userId, id) => notes.get(userId, id),
      execute: (userId, name, args, options) => executeAgentTool(userId, name, args as Record<string, any>, options)
    }, scopes),
    publicUrl: mcpPublicUrl,
    allowedHosts: list(env.MCP_ALLOWED_HOSTS),
    allowedOrigins: list(env.MCP_ALLOWED_ORIGINS)
  })
}
