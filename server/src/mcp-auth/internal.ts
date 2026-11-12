import { randomBytes, randomUUID } from 'node:crypto'

export type ApprovalMode = 'trust' | 'minimal' | 'standard'
export type Approval = {
  id: string
  userId: string
  clientId: string
  tool: string
  args: Record<string, unknown>
  summary: string
  status: 'pending' | 'approved' | 'denied' | 'executed' | 'failed' | 'expired'
  result?: { ok: boolean; summary: string }
}
export type McpScope = 'notes:read' | 'notes:write' | 'tasks' | 'calendar' | 'memory' | 'templates' | 'images' | 'research' | 'web' | 'code'
export const LOCAL_USER_ID = '00000000-0000-0000-0000-000000000001'
export const SCOPES: McpScope[] = [
  'notes:read',
  'notes:write',
  'tasks',
  'calendar',
  'memory',
  'templates',
  'images',
  'research',
  'web',
  'code'
]
/** Granted unless a client asks for more; code execution and web search stay opt-in. */
export const DEFAULT_SCOPES: McpScope[] = ['notes:read', 'notes:write', 'tasks', 'calendar', 'memory', 'templates', 'images', 'research']
export function createOpaqueToken(prefix: 'muse_mcp_' | 'muse_oauth_' = 'muse_oauth_') {
  return `${prefix}${randomBytes(32).toString('base64url')}`
}
export const newFamilyId = randomUUID
