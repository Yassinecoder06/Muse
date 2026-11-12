import type { ToolExecutionResult } from '../services/agent-tools.service.js'
import type { MuseTool, ToolContext } from '../services/tools/types.js'
import type { ApprovalMode } from './annotations.js'
import type { Approval, McpAuthPort, McpIdentity, UndoSnapshot } from './ports.js'

// Runs one MCP tool call with the connection's approval mode applied on the
// server. Client-side prompts (from annotations) are a convenience; this is
// the part that actually guarantees "standard" never deletes without approval.

export interface DispatchDeps {
  port: McpAuthPort
  /** Bip's executor; `confirmed: true` performs a destructive action. */
  execute(userId: string, name: string, args: Record<string, unknown>, options: { timezone: string; confirmed?: boolean }): Promise<ToolExecutionResult>
  capture(userId: string, itemType: string, id: string | null): Promise<UndoSnapshot[]>
}

export interface DispatchOutcome {
  ok: boolean
  /** Short plain-language line for the model; never contains confirmation tokens. */
  message: string
  data: Record<string, unknown>
}

interface Target { id: string | null; title: string; itemType: string; status: string }

const UNDO_NOTE = 'An undo snapshot is kept in Muse for 7 days (Settings → Connected apps → Activity).'

function targetFrom(execution: ToolExecutionResult): Target | null {
  if (!execution.result?.requires_confirmation) return null
  const data = (execution.actionCard?.data ?? {}) as Record<string, unknown>
  return {
    id: typeof data.id === 'string' ? data.id : null,
    title: String(data.title ?? 'item'),
    itemType: String(data.itemType ?? 'Item'),
    status: String(data.status ?? 'Delete')
  }
}

function describe(target: Target) { return `${target.status} ${target.itemType.toLowerCase()} "${target.title}"` }

function messageOf(execution: ToolExecutionResult, fallback: string) {
  const message = execution.result?.message
  return typeof message === 'string' && message ? message : fallback
}

export class McpDispatcher {
  constructor(private readonly deps: DispatchDeps) {}

  async call(identity: McpIdentity, mode: ApprovalMode, tool: MuseTool, args: Record<string, unknown>, timezone: string): Promise<DispatchOutcome> {
    const ctx: ToolContext = { userId: identity.userId, timezone }
    try {
      const outcome = tool.risk === 'destructive'
        ? await this.destructive(identity, mode, tool, args, timezone)
        : await this.direct(identity, tool, args, ctx)
      await this.log(identity, tool, outcome.ok ? (outcome.data.pending_approval ? 'pending_approval' : 'ok') : 'error', outcome.message, outcome.data.undo_id as string | undefined)
      return outcome
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.log(identity, tool, 'error', message)
      return { ok: false, message, data: { error: message } }
    }
  }

  /** Runs an approved Standard-mode request (called by the /approve page via the port). */
  async executeApproval(approval: Approval): Promise<{ ok: boolean; summary: string }> {
    const settings = await this.deps.port.getMcpSettings(approval.userId)
    const identity: McpIdentity = { userId: approval.userId, clientId: approval.clientId, scopes: [], approvalMode: 'standard' }
    const target: Target = { id: typeof approval.args.id === 'string' ? approval.args.id : null, title: approval.summary, itemType: String(approval.args.itemType ?? ''), status: '' }
    const outcome = await this.confirmAndRun(identity, approval.tool, approval.args, target, settings.timezone)
    await this.log(identity, { name: approval.tool, risk: 'destructive' }, outcome.ok ? 'ok' : 'error', outcome.message, outcome.data.undo_id as string | undefined)
    return { ok: outcome.ok, summary: outcome.message }
  }

  private async direct(identity: McpIdentity, tool: MuseTool, args: Record<string, unknown>, ctx: ToolContext): Promise<DispatchOutcome> {
    let undoId: string | undefined
    if (tool.name === 'update_note' && typeof args.id === 'string') {
      const snapshot = await this.deps.capture(identity.userId, 'Note', args.id)
      if (snapshot.length) undoId = (await this.deps.port.saveUndoSnapshot({ userId: identity.userId, clientId: identity.clientId, tool: tool.name, itemType: 'Note', targetId: args.id, snapshot })).id
    }
    const execution = await tool.handler(ctx, args)
    if (execution.error) return { ok: false, message: execution.error, data: { error: execution.error } }
    return { ok: true, message: messageOf(execution, `${tool.title} done.`), data: { ...execution.result, ...(undoId ? { undo_id: undoId } : {}) } }
  }

  private async destructive(identity: McpIdentity, mode: ApprovalMode, tool: MuseTool, args: Record<string, unknown>, timezone: string): Promise<DispatchOutcome> {
    // Resolve the exact target first (titles → ids); nothing is deleted yet.
    const preview = await this.deps.execute(identity.userId, tool.name, args, { timezone, confirmed: false })
    if (preview.error) return { ok: false, message: preview.error, data: { error: preview.error } }
    const target = targetFrom(preview)
    if (!target) return { ok: true, message: messageOf(preview, 'Nothing to delete.'), data: preview.result }

    if (mode === 'standard') {
      const approval = await this.deps.port.createApproval({
        userId: identity.userId, clientId: identity.clientId, tool: tool.name,
        args: { ...(target.id ? { id: target.id } : {}), itemType: target.itemType },
        summary: describe(target)
      })
      return {
        ok: true,
        message: `Nothing was deleted yet. Ask the user to approve "${describe(target)}" in Muse: ${approval.url}. Then check get_pending_approvals.`,
        data: { pending_approval: true, approval_id: approval.id, approve_url: approval.url, target: { id: target.id, title: target.title, type: target.itemType } }
      }
    }
    return this.confirmAndRun(identity, tool.name, target.id ? { id: target.id } : {}, target, timezone)
  }

  private async confirmAndRun(identity: McpIdentity, toolName: string, args: Record<string, unknown>, target: Target, timezone: string): Promise<DispatchOutcome> {
    const runArgs = target.id ? { id: target.id } : {}
    let undoId: string | undefined
    const snapshot = target.itemType ? await this.deps.capture(identity.userId, target.itemType, target.id) : []
    if (snapshot.length) {
      undoId = (await this.deps.port.saveUndoSnapshot({ userId: identity.userId, clientId: identity.clientId, tool: toolName, itemType: target.itemType, targetId: target.id, snapshot })).id
    }
    const execution = await this.deps.execute(identity.userId, toolName, Object.keys(runArgs).length ? runArgs : args, { timezone, confirmed: true })
    if (execution.error) return { ok: false, message: execution.error, data: { error: execution.error } }
    const done = messageOf(execution, 'Done.')
    return { ok: true, message: undoId ? `${done} ${UNDO_NOTE}` : done, data: { ...execution.result, ...(undoId ? { undo_id: undoId } : {}) } }
  }

  private async log(identity: McpIdentity, tool: Pick<MuseTool, 'name' | 'risk'>, outcome: 'ok' | 'error' | 'pending_approval', summary: string, undoId?: string) {
    try {
      await this.deps.port.recordActivity({ userId: identity.userId, clientId: identity.clientId, tool: tool.name, risk: tool.risk, summary: summary.slice(0, 500), outcome, ...(undoId ? { undoId } : {}) })
    } catch (error) {
      console.warn('[mcp] could not record activity:', error instanceof Error ? error.message : error)
    }
  }
}
