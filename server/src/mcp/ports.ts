import type { ApprovalMode } from './annotations.js'
import type { ToolRisk } from '../services/tools/types.js'

// The MCP core depends on storage (tokens, approvals, activity, undo) only
// through this port. The real implementation lives in server/src/mcp-auth and
// is installed at startup with setMcpAuthPort(); tests install an in-memory one.

export interface McpIdentity {
  userId: string
  clientId: string
  scopes: string[]
  approvalMode: ApprovalMode
}

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'executed' | 'expired'

export interface Approval {
  id: string
  userId: string
  clientId: string
  tool: string
  args: Record<string, unknown>
  summary: string
  status: ApprovalStatus
  result?: unknown
}

export interface UndoSnapshot { table: string; rows: Record<string, unknown>[] }

export interface ActivityRecord {
  userId: string
  clientId: string
  tool: string
  risk: ToolRisk
  summary: string
  outcome: 'ok' | 'error' | 'pending_approval'
  undoId?: string
}

export type ApprovalExecutor = (approval: Approval) => Promise<{ ok: boolean; summary: string }>
export type ModeChangeListener = (userId: string, clientId: string | null, mode: ApprovalMode) => void

export interface McpAuthPort {
  verifyAccessToken(token: string): Promise<McpIdentity | null>
  getMcpSettings(userId: string): Promise<{ defaultMode: ApprovalMode; timezone: string }>
  createApproval(input: { userId: string; clientId: string; tool: string; args: Record<string, unknown>; summary: string }): Promise<{ id: string; url: string }>
  getApproval(id: string): Promise<Approval | null>
  listPendingApprovals(userId: string, clientId?: string): Promise<Approval[]>
  setApprovalExecutor(executor: ApprovalExecutor): void
  recordActivity(record: ActivityRecord): Promise<void>
  /** `snapshot` is restored in array order (e.g. a chat session before its messages). */
  saveUndoSnapshot(input: { userId: string; clientId: string; tool: string; itemType: string; targetId: string | null; snapshot: UndoSnapshot[] }): Promise<{ id: string }>
  onModeChange(listener: ModeChangeListener): () => void
}

/** Refuses every token until the real port is installed, so /mcp is closed by default. */
const closedPort: McpAuthPort = {
  async verifyAccessToken() { return null },
  async getMcpSettings() { return { defaultMode: 'minimal', timezone: 'UTC' } },
  async createApproval() { throw new Error('MCP approvals are not configured.') },
  async getApproval() { return null },
  async listPendingApprovals() { return [] },
  setApprovalExecutor() {},
  async recordActivity() {},
  async saveUndoSnapshot() { throw new Error('MCP undo storage is not configured.') },
  onModeChange() { return () => {} }
}

let current: McpAuthPort = closedPort

export function setMcpAuthPort(port: McpAuthPort) { current = port }
export function mcpAuthPort(): McpAuthPort { return current }
