import { createHash } from 'node:crypto'
import { supabase } from '../supabase/client.js'
import { mcpPublicUrl } from '../utils/env.js'
import { approvalCanBeDecided, validAccessRow } from './oauth-logic.js'
import type { Approval, ApprovalMode } from './internal.js'
export { onModeChange } from './internal-crypto.js'

const db = supabase as unknown as { from: (table: string) => any }
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const checked = (result: { data: any; error: { message: string } | null }): any => {
  if (result.error) throw new Error(result.error.message)
  return result.data
}
type AccessClaims = { userId: string; clientId: string; scopes: string[]; approvalMode: ApprovalMode }
type ApprovalExecutor = (approval: Approval) => Promise<{ ok: boolean; summary: string }>
let approvalExecutor: ApprovalExecutor | null = null

export function setApprovalExecutor(fn: ApprovalExecutor) {
  approvalExecutor = fn
  void db
    .from('mcp_approvals')
    .select('id')
    .eq('status', 'approved')
    .is('execution_started_at', null)
    .then((result: any) => {
      if (result.error) throw new Error(result.error.message)
      for (const row of result.data || [])
        void executeApprovedApproval(row.id).catch(error => console.error('Could not execute approved MCP action', error))
    })
    .catch((error: unknown) => console.error('Could not resume approved MCP actions', error))
}

export async function verifyAccessToken(token: string): Promise<AccessClaims | null> {
  if (!token || token.length > 1024) return null
  const row = checked(
    await db.from('mcp_tokens').select('id,user_id,client_id,type,expires_at,revoked_at,scopes').eq('token_hash', hash(token)).maybeSingle()
  )
  if (!validAccessRow(row)) return null
  const client = checked(await db.from('mcp_clients').select('approval_mode,scopes').eq('client_id', row.client_id).maybeSingle())
  // A deleted client loses access at once; scope changes in Muse apply to existing tokens.
  if (!client) return null
  const allowed = new Set<string>(client.scopes ?? [])
  const scopes = (row.scopes as string[]).filter(scope => allowed.has(scope))
  const settings = await getMcpSettings(row.user_id)
  void db.from('mcp_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', row.id)
  return { userId: row.user_id, clientId: row.client_id, scopes, approvalMode: client.approval_mode || settings.defaultMode }
}

export async function createApproval(input: {
  userId: string
  clientId: string
  tool: string
  args: Record<string, unknown>
  summary: string
}): Promise<{ id: string; url: string }> {
  const row = checked(
    await db
      .from('mcp_approvals')
      .insert({ user_id: input.userId, client_id: input.clientId, tool: input.tool, args: input.args, summary: input.summary })
      .select('id')
      .single()
  )
  return { id: row.id, url: `${mcpPublicUrl}/approve/${row.id}` }
}

function approvalShape(row: any): Approval {
  return {
    id: row.id,
    userId: row.user_id,
    clientId: row.client_id,
    tool: row.tool,
    args: row.args || {},
    summary: row.summary,
    status: row.status,
    ...(row.result ? { result: row.result } : {})
  }
}

async function executeApprovedApproval(id: string) {
  if (!approvalExecutor) return
  const claimed = checked(
    await db
      .from('mcp_approvals')
      .update({ execution_started_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'approved')
      .is('execution_started_at', null)
      .select('id,user_id,client_id,tool,args,summary,status,result')
      .maybeSingle()
  )
  if (!claimed) return
  let result: { ok: boolean; summary: string }
  try {
    result = await approvalExecutor(approvalShape(claimed))
  } catch (error) {
    result = { ok: false, summary: error instanceof Error ? error.message : 'Approved action failed.' }
  }
  checked(
    await db
      .from('mcp_approvals')
      .update({ status: result.ok ? 'executed' : 'failed', result, executed_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'approved')
  )
}

export async function getApproval(id: string): Promise<Approval | null> {
  const row = checked(
    await db.from('mcp_approvals').select('id,user_id,client_id,tool,args,summary,status,result,expires_at').eq('id', id).maybeSingle()
  )
  if (!row) return null
  if (row.status === 'pending' && Date.parse(row.expires_at) <= Date.now()) {
    checked(await db.from('mcp_approvals').update({ status: 'expired' }).eq('id', id).eq('status', 'pending'))
    row.status = 'expired'
  }
  return approvalShape(row)
}

export async function listPendingApprovals(userId: string, clientId?: string): Promise<Approval[]> {
  let query = db
    .from('mcp_approvals')
    .select('id,user_id,client_id,tool,args,summary,status,result,expires_at')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
  if (clientId) query = query.eq('client_id', clientId)
  return (checked(await query) || []).map(approvalShape)
}

export async function decideApproval(id: string, decision: 'approve' | 'deny'): Promise<boolean> {
  const row = checked(
    await db.from('mcp_approvals').select('id,user_id,client_id,tool,args,summary,status,result,expires_at').eq('id', id).maybeSingle()
  )
  if (!approvalCanBeDecided(row)) return false
  const status = decision === 'approve' ? 'approved' : 'denied'
  const claimed = checked(
    await db
      .from('mcp_approvals')
      .update({ status, decided_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()
  )
  if (!claimed) return false
  if (decision === 'deny') return true
  if (approvalExecutor) await executeApprovedApproval(id)
  return true
}

export async function recordActivity(input: {
  userId: string
  clientId: string
  tool: string
  risk: string
  summary: string
  outcome: 'ok' | 'error' | 'pending_approval'
  undoId?: string
}): Promise<void> {
  checked(
    await db
      .from('mcp_activity')
      .insert({
        user_id: input.userId,
        client_id: input.clientId,
        tool: input.tool,
        risk: input.risk,
        summary: input.summary,
        outcome: input.outcome,
        status: input.outcome === 'ok' ? 'completed' : input.outcome === 'error' ? 'error' : 'pending',
        undo_id: input.undoId || null
      })
  )
}

export async function saveUndoSnapshot(input: {
  userId: string
  clientId: string
  tool: string
  itemType: string
  targetId: string | null
  snapshot: { table: string; rows: Record<string, unknown>[] }[]
}): Promise<{ id: string }> {
  const row = checked(
    await db
      .from('mcp_undo')
      .insert({
        user_id: input.userId,
        client_id: input.clientId,
        tool: input.tool,
        item_type: input.itemType,
        target_id: input.targetId,
        snapshot: input.snapshot
      })
      .select('id')
      .single()
  )
  return { id: row.id }
}

export async function getMcpSettings(userId: string): Promise<{ defaultMode: ApprovalMode; timezone: string }> {
  const row = checked(await db.from('mcp_settings').select('default_mode,timezone').eq('user_id', userId).maybeSingle())
  return { defaultMode: (row?.default_mode || 'minimal') as ApprovalMode, timezone: row?.timezone || 'UTC' }
}
