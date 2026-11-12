import type { MuseTool } from '../services/tools/types.js'
import type { McpDispatcher } from './dispatch.js'
import type { McpAuthPort } from './ports.js'
import type { SessionState } from './server.js'

export const MAX_BATCH_CALLS = 10

/** Tools that need the connection itself (its approvals, its other tools). */
export function sessionTools(state: SessionState, port: McpAuthPort, dispatcher: McpDispatcher, visible: () => readonly MuseTool[]): MuseTool[] {
  const pending: MuseTool = {
    name: 'get_pending_approvals',
    title: 'Get pending approvals',
    description: 'List deletions this connection asked for that are waiting for, or recently got, the owner\'s approval in Muse (Standard approval mode).',
    inputSchema: { type: 'object', properties: {} },
    risk: 'read',
    scope: 'notes:read',
    surfaces: ['mcp'],
    async handler(ctx, args) {
      const approvals = await port.listPendingApprovals(ctx.userId, state.identity.clientId)
      return {
        toolName: 'get_pending_approvals', args,
        result: { approvals: approvals.map(({ id, tool, summary, status, result }) => ({ id, tool, summary, status, ...(result !== undefined ? { result } : {}) })) }
      }
    }
  }

  const batch: MuseTool = {
    name: 'batch',
    title: 'Run several Muse tools',
    description: `Run up to ${MAX_BATCH_CALLS} Muse tool calls in order with one request, e.g. create a note, then two tasks and an event. Deletions are not allowed in a batch; call them one at a time.`,
    inputSchema: {
      type: 'object',
      properties: {
        calls: {
          type: 'array',
          maxItems: MAX_BATCH_CALLS,
          items: {
            type: 'object',
            properties: { tool: { type: 'string', description: 'Tool name, e.g. create_task' }, arguments: { type: 'object', description: 'Arguments for that tool' } },
            required: ['tool']
          }
        }
      },
      required: ['calls']
    },
    risk: 'write',
    scope: 'notes:write',
    surfaces: ['mcp'],
    async handler(ctx, args) {
      const calls = Array.isArray(args.calls) ? args.calls.slice(0, MAX_BATCH_CALLS) : []
      if (!calls.length) throw new Error('Provide at least one call in "calls".')
      const results = []
      for (const raw of calls as { tool?: unknown; arguments?: unknown }[]) {
        const name = String(raw?.tool ?? '')
        const tool = visible().find(candidate => candidate.name === name)
        if (!tool || tool.name === 'batch') { results.push({ tool: name, ok: false, message: `Tool "${name}" is not available here.` }); continue }
        if (tool.risk === 'destructive') { results.push({ tool: name, ok: false, message: 'Deletions cannot run inside batch. Call this tool on its own.' }); continue }
        const toolArgs = raw.arguments && typeof raw.arguments === 'object' ? raw.arguments as Record<string, unknown> : {}
        const outcome = await dispatcher.call(state.identity, state.mode, tool, toolArgs, ctx.timezone)
        results.push({ tool: name, ok: outcome.ok, message: outcome.message, data: outcome.data })
      }
      return { toolName: 'batch', args, result: { succeeded: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results } }
    }
  }

  return [pending, batch]
}
