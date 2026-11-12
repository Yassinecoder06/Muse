import { createHash } from 'node:crypto'
import { supabase } from '../supabase/client.js'
// The project does not yet generate Supabase Database types for app tables.
// Keep this adapter local so the rest of this module stays explicitly typed.
const db = supabase as unknown as { from: (table: string) => any }
import { env } from '../utils/env.js'
import { approvalCanBeDecided, validAccessRow } from './oauth-logic.js'

import type { ApprovalMode } from './internal.js'
export { onModeChange } from './internal-crypto.js'
type AccessClaims = { userId: string; clientId: string; scopes: string[]; approvalMode: ApprovalMode }
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const checked = (result: { data: any; error: { message: string } | null }): any => { if (result.error) throw new Error(result.error.message); return result.data }

export async function verifyAccessToken(token: string): Promise<AccessClaims | null> {
  if (!token || token.length > 1024) return null
  const digest = hash(token)
  const result = await db.from('mcp_tokens').select('id,user_id,client_id,type,expires_at,revoked_at,scopes,family_id').eq('token_hash',digest).maybeSingle()
  const row = checked(result)
  if (!validAccessRow(row)) return null
  const client = checked(await db.from('mcp_clients').select('approval_mode').eq('client_id',row.client_id).maybeSingle())
  const settings = await getMcpSettings(row.user_id)
  void db.from('mcp_tokens').update({ last_used_at: new Date().toISOString() }).eq('id',row.id)
  const mode = client?.approval_mode || settings.defaultMode
  return { userId: row.user_id, clientId: row.client_id, scopes: row.scopes, approvalMode: mode }
}

export async function createApproval(input: {userId:string;clientId:string;tool:string;args:Record<string,unknown>;summary:string}) {
  const target = typeof input.args.target === 'string' ? input.args.target : typeof input.args.note_id === 'string' ? input.args.note_id : typeof input.args.id === 'string' ? input.args.id : ''
  const data = checked(await db.from('mcp_approvals').insert({ user_id:input.userId,client_id:input.clientId,tool:input.tool,target,args:input.args,summary:input.summary }).select('id').single())!
  return { id:data.id, url:`${env.PUBLIC_URL}/approve/${data.id}` }
}
export async function getApproval(id: string) {
  return checked(await db.from('mcp_approvals').select('*').eq('id',id).maybeSingle())
}
export async function decideApproval(id: string, decision: 'approve'|'deny') {
  const row = await getApproval(id)
  if (!approvalCanBeDecided(row)) return false
  const data = checked(await db.from('mcp_approvals').update({status:decision==='approve'?'approved':'denied',decided_at:new Date().toISOString()}).eq('id',id).eq('status','pending').select('id').maybeSingle())
  return !!data
}
export async function recordActivity(input: {userId:string;clientId:string;tool:string;target?:string;summary:string;status?:string;undoId?:string}) {
  return checked(await db.from('mcp_activity').insert({user_id:input.userId,client_id:input.clientId,tool:input.tool,target:input.target||null,summary:input.summary,status:input.status||'completed',undo_id:input.undoId||null}).select('id').single())
}
export async function saveUndoSnapshot(input: {userId:string;tool:string;target:string;snapshot:unknown}) {
  return checked(await db.from('mcp_undo').insert({user_id:input.userId,tool:input.tool,target:input.target,snapshot:input.snapshot}).select('id').single())
}
export async function getMcpSettings(userId: string) {
  const row = checked(await db.from('mcp_settings').select('default_mode,timezone').eq('user_id',userId).maybeSingle())
  return { defaultMode: (row?.default_mode || 'minimal') as ApprovalMode, timezone: row?.timezone || 'UTC' }
}

