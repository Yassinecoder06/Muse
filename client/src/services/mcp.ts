import { request, root } from './api'

export type McpApprovalMode = 'trust' | 'minimal' | 'standard'

export type McpScope =
  | 'notes:read'
  | 'notes:write'
  | 'tasks'
  | 'calendar'
  | 'memory'
  | 'templates'
  | 'images'
  | 'research'
  | 'web'
  | 'code'

export const ALL_SCOPES: McpScope[] = [
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

export const DEFAULT_SCOPES: McpScope[] = [
  'notes:read',
  'notes:write',
  'tasks',
  'calendar',
  'memory',
  'templates',
  'images',
  'research'
]

export const SCOPE_DESCRIPTIONS: Record<McpScope, string> = {
  'notes:read': 'Search & read notes',
  'notes:write': 'Create, edit & trash notes',
  'tasks': 'Manage tasks & reminders',
  'calendar': 'View & schedule events',
  'memory': 'Store & retrieve memories',
  'templates': 'Custom & specialized templates',
  'images': 'Generate & edit images',
  'research': 'Deep structured research reports',
  'web': 'Live web search',
  'code': 'Python sandbox execution'
}

export const MODE_EXPLANATIONS: Record<McpApprovalMode, { title: string; desc: string; warning?: string }> = {
  trust: {
    title: 'Trust',
    desc: 'Runs immediately without owner approval; deletions and modifications keep a 7-day automatic undo snapshot.',
    warning: 'Text in notes or web pages could make the AI delete things without asking; deletions keep a 7-day undo.'
  },
  minimal: {
    title: 'Minimal (Default)',
    desc: 'Reads run freely; writes ask one-time "Always allow"; destructive actions prompt every time with 7-day undo.'
  },
  standard: {
    title: 'Standard',
    desc: 'Dual verification: client prompts on write, and sensitive operations require interactive owner confirmation in Muse.'
  }
}

export interface McpSettings {
  defaultMode: McpApprovalMode
  timezone: string
}

export interface McpStatus {
  mcpUrl: string
  settings: McpSettings
  tokens: number
  clients: number
  pendingApprovals: number
}

export interface McpTokenRow {
  id: string
  label: string | null
  type: 'pat' | 'oauth_access' | 'oauth_refresh'
  scopes: string[]
  expires_at: string | null
  revoked_at: string | null
  created_at: string
  last_used_at: string | null
}

export interface McpClientRow {
  client_id: string
  name: string
  scopes: string[]
  approval_mode: McpApprovalMode | null
  remembered: boolean
  created_at: string
  last_used_at: string | null
}

export interface McpApprovalRow {
  id: string
  client_id: string
  tool: string
  summary: string
  status: 'pending' | 'approved' | 'denied' | 'executed' | 'failed' | 'expired'
  args: Record<string, unknown>
  created_at: string
  expires_at: string
  result?: unknown
}

export interface McpActivityRow {
  id: string
  client_id: string
  tool: string
  risk: 'read' | 'write' | 'external' | 'destructive'
  summary: string
  outcome: 'ok' | 'error' | 'pending_approval'
  undo_id: string | null
  created_at: string
}

export interface McpEventsSnapshot {
  activity: McpActivityRow[]
  approvals: McpApprovalRow[]
}

// ======================== API Methods ========================

export const mcpApi = {
  getStatus: () => request<McpStatus>('/mcp/status'),
  getSettings: () => request<McpSettings>('/mcp/settings'),
  updateSettings: (settings: McpSettings) =>
    request<McpSettings>('/mcp/settings', {
      method: 'PUT',
      body: JSON.stringify(settings)
    }),
  getTokens: () => request<McpTokenRow[]>('/mcp/tokens'),
  createToken: (input: { label: string; scopes: string[]; expiresInDays?: number }) =>
    request<{ token: string; label: string }>('/mcp/tokens', {
      method: 'POST',
      body: JSON.stringify(input)
    }),
  revokeToken: (id: string) =>
    request<void>(`/mcp/tokens/${id}`, {
      method: 'DELETE'
    }),
  getClients: () => request<McpClientRow[]>('/mcp/clients'),
  updateClient: (id: string, patch: { mode?: McpApprovalMode; scopes?: string[] }) =>
    request<{ ok: boolean }>(`/mcp/clients/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch)
    }),
  deleteClient: (id: string) =>
    request<void>(`/mcp/clients/${id}`, {
      method: 'DELETE'
    }),
  getApprovals: () => request<McpApprovalRow[]>('/mcp/approvals'),
  approveAction: (id: string) =>
    request<{ ok: boolean }>(`/mcp/approvals/${id}/approve`, {
      method: 'POST'
    }),
  denyAction: (id: string) =>
    request<{ ok: boolean }>(`/mcp/approvals/${id}/deny`, {
      method: 'POST'
    }),
  getActivity: () => request<McpActivityRow[]>('/mcp/activity'),
  undoActivity: (id: string) =>
    request<{ ok: boolean }>(`/mcp/activity/${id}/undo`, {
      method: 'POST'
    })
}

/**
 * Connects to Server-Sent Events stream at /api/mcp/events with credentials.
 * Automatically receives initial snapshot and refreshes every 15 seconds.
 * Returns a cleanup unsubscribe callback.
 */
export function subscribeMcpEvents(
  onSnapshot: (snapshot: McpEventsSnapshot) => void,
  onError?: (err: Event) => void
): () => void {
  const eventsUrl = `${root}/mcp/events`
  let eventSource: EventSource | null = null

  try {
    eventSource = new EventSource(eventsUrl, { withCredentials: true })

    eventSource.addEventListener('snapshot', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as McpEventsSnapshot
        onSnapshot(data)
      } catch {
        // Ignore JSON parse errors
      }
    })

    if (onError) {
      eventSource.onerror = onError
    }
  } catch (err) {
    if (onError && err instanceof Event) {
      onError(err)
    }
  }

  return () => {
    if (eventSource) {
      eventSource.close()
      eventSource = null
    }
  }
}

// ======================== Pure Helpers ========================

export function getDefaultScopes(): McpScope[] {
  return [...DEFAULT_SCOPES]
}

export function isPersonalTokenClient(clientId: string): boolean {
  return typeof clientId === 'string' && clientId.startsWith('pat:')
}

export function resolveClientName(clientId: string, clients: McpClientRow[]): string {
  if (!clientId) return 'Unknown client'
  const match = clients.find(c => c.client_id === clientId)
  if (match) return match.name
  if (isPersonalTokenClient(clientId)) {
    return 'Personal Token'
  }
  return clientId.slice(0, 8)
}

export function formatRelativeTime(dateStr: string | null | undefined, now = new Date()): string {
  if (!dateStr) return 'never'
  const timestamp = new Date(dateStr).getTime()
  if (isNaN(timestamp)) return 'unknown'

  const diffMs = now.getTime() - timestamp
  if (diffMs < 0) return 'just now'

  const seconds = Math.floor(diffMs / 1000)
  if (seconds < 45) return 'just now'

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`

  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

export function formatExpiresIn(expiresAt: string | null | undefined, now = new Date()): string {
  if (!expiresAt) return 'Never'
  const target = new Date(expiresAt).getTime()
  if (isNaN(target)) return 'Never'

  const diffMs = target - now.getTime()
  if (diffMs <= 0) return 'Expired'

  const seconds = Math.floor(diffMs / 1000)
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m left`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h left`

  const days = Math.floor(hours / 24)
  return `${days}d left`
}

export function buildClaudeAiSnippet(mcpUrl: string): string {
  return `${mcpUrl}`
}

export function buildChatGptSnippet(mcpUrl: string): string {
  return `${mcpUrl}`
}

export function buildClaudeCodeSnippet(mcpUrl: string, pat?: string): string {
  if (pat) {
    return `claude mcp add --transport http -H "Authorization: Bearer ${pat}" muse ${mcpUrl}`
  }
  return `claude mcp add --transport http muse ${mcpUrl}`
}

export function buildClaudeDesktopSnippet(mcpUrl: string, pat = 'muse_mcp_YOUR_TOKEN'): string {
  // Claude Desktop's config file launches local commands; mcp-remote bridges to
  // the remote server. (Pro/Max plans can instead add the URL under Connectors.)
  const config = {
    mcpServers: {
      muse: {
        command: 'npx',
        args: ['-y', 'mcp-remote', mcpUrl, '--header', 'Authorization:${MUSE_AUTH}'],
        env: { MUSE_AUTH: `Bearer ${pat}` }
      }
    }
  }
  return JSON.stringify(config, null, 2)
}

export function buildCursorSnippet(mcpUrl: string, pat = 'muse_mcp_YOUR_TOKEN'): string {
  // ~/.cursor/mcp.json
  const config = { mcpServers: { muse: { url: mcpUrl, headers: { Authorization: `Bearer ${pat}` } } } }
  return JSON.stringify(config, null, 2)
}

export function buildGeminiCliSnippet(mcpUrl: string, pat = 'muse_mcp_YOUR_TOKEN'): string {
  const config = {
    mcpServers: {
      muse: {
        httpUrl: mcpUrl,
        headers: {
          Authorization: `Bearer ${pat}`
        }
      }
    }
  }
  return JSON.stringify(config, null, 2)
}
