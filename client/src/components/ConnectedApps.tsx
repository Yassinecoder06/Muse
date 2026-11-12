import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  Check,
  CheckCircle,
  Copy,
  ExternalLink,
  History,
  KeyRound,
  Layers,
  Radio,
  RotateCcw,
  ShieldAlert,
  Trash2,
  X
} from 'lucide-react'
import {
  ALL_SCOPES,
  DEFAULT_SCOPES,
  MODE_EXPLANATIONS,
  SCOPE_DESCRIPTIONS,
  buildChatGptSnippet,
  buildClaudeAiSnippet,
  buildClaudeCodeSnippet,
  buildClaudeDesktopSnippet,
  buildCursorSnippet,
  buildGeminiCliSnippet,
  formatExpiresIn,
  formatRelativeTime,
  isPersonalTokenClient,
  mcpApi,
  resolveClientName,
  subscribeMcpEvents,
  type McpActivityRow,
  type McpApprovalMode,
  type McpApprovalRow,
  type McpClientRow,
  type McpScope,
  type McpSettings,
  type McpStatus,
  type McpTokenRow
} from '../services/mcp'
import { ConfirmModal } from './ConfirmModal'
import './connected-apps.css'

export interface ConnectedAppsProps {
  onToast: (message: string) => void
}

type SnippetTab = 'claude_ai' | 'chatgpt' | 'claude_code' | 'cursor' | 'claude_desktop' | 'gemini_cli'

export function ConnectedApps({ onToast }: ConnectedAppsProps) {
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<McpStatus | null>(null)
  const [settings, setSettings] = useState<McpSettings>({ defaultMode: 'minimal', timezone: 'UTC' })
  const [tokens, setTokens] = useState<McpTokenRow[]>([])
  const [clients, setClients] = useState<McpClientRow[]>([])
  const [approvals, setApprovals] = useState<McpApprovalRow[]>([])
  const [activity, setActivity] = useState<McpActivityRow[]>([])

  // Snippets
  const [activeSnippetTab, setActiveSnippetTab] = useState<SnippetTab>('claude_ai')
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  // Trust Mode Confirmation
  const [pendingTrustModeTarget, setPendingTrustModeTarget] = useState<'default' | { clientId: string } | null>(null)

  // Disconnect Client Confirmation
  const [clientToDisconnect, setClientToDisconnect] = useState<McpClientRow | null>(null)

  // Revoke Token Confirmation
  const [tokenToRevoke, setTokenToRevoke] = useState<McpTokenRow | null>(null)

  // Undo Activity Confirmation
  const [activityToUndo, setActivityToUndo] = useState<McpActivityRow | null>(null)

  // Token Creation Form
  const [showCreateToken, setShowCreateToken] = useState(false)
  const [tokenLabel, setTokenLabel] = useState('')
  const [tokenScopes, setTokenScopes] = useState<McpScope[]>(() => [...DEFAULT_SCOPES])
  const [tokenExpiryDays, setTokenExpiryDays] = useState<number | undefined>(90)
  const [createdTokenResult, setCreatedTokenResult] = useState<{ token: string; label: string } | null>(null)
  const [creatingToken, setCreatingToken] = useState(false)

  // Timezone state
  const [currentTimezone, setCurrentTimezone] = useState('')
  const [savingTimezone, setSavingTimezone] = useState(false)

  async function loadAllData() {
    try {
      const [st, sett, toks, clis, apps, acts] = await Promise.all([
        mcpApi.getStatus().catch(() => null),
        mcpApi.getSettings().catch(() => ({ defaultMode: 'minimal' as McpApprovalMode, timezone: 'UTC' })),
        mcpApi.getTokens().catch(() => []),
        mcpApi.getClients().catch(() => []),
        mcpApi.getApprovals().catch(() => []),
        mcpApi.getActivity().catch(() => [])
      ])

      if (st) setStatus(st)
      if (sett) {
        setSettings(sett)
        const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
        setCurrentTimezone(sett.timezone === 'UTC' && localTz !== 'UTC' ? localTz : sett.timezone)
      }
      setTokens(toks)
      setClients(clis)
      setApprovals(apps.filter(a => a.status === 'pending'))
      setActivity(acts)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadAllData()

    // Subscribe to live SSE events (/api/mcp/events)
    const unsubscribe = subscribeMcpEvents(snapshot => {
      if (snapshot.activity) setActivity(snapshot.activity)
      if (snapshot.approvals) setApprovals(snapshot.approvals.filter(a => a.status === 'pending'))
    })

    return () => unsubscribe()
  }, [])

  function copyToClipboard(text: string, key: string) {
    void navigator.clipboard.writeText(text)
    setCopiedKey(key)
    onToast('Copied to clipboard!')
    setTimeout(() => {
      setCopiedKey(current => (current === key ? null : current))
    }, 2500)
  }

  // Handle Mode Selection
  async function selectMode(mode: McpApprovalMode) {
    if (mode === settings.defaultMode) return

    if (mode === 'trust') {
      setPendingTrustModeTarget('default')
      return
    }

    try {
      const updated = await mcpApi.updateSettings({ ...settings, defaultMode: mode })
      setSettings(updated)
      onToast(`Default approval mode updated to ${MODE_EXPLANATIONS[mode].title}.`)
    } catch {
      onToast('Failed to update approval mode.')
    }
  }

  async function confirmTrustMode() {
    if (!pendingTrustModeTarget) return

    if (pendingTrustModeTarget === 'default') {
      try {
        const updated = await mcpApi.updateSettings({ ...settings, defaultMode: 'trust' })
        setSettings(updated)
        onToast('Default approval mode set to Trust.')
      } catch {
        onToast('Failed to update approval mode.')
      }
    } else {
      const { clientId } = pendingTrustModeTarget
      try {
        await mcpApi.updateClient(clientId, { mode: 'trust' })
        setClients(prev => prev.map(c => (c.client_id === clientId ? { ...c, approval_mode: 'trust' } : c)))
        onToast('Client approval mode set to Trust.')
      } catch {
        onToast('Failed to update client approval mode.')
      }
    }
    setPendingTrustModeTarget(null)
  }

  async function saveTimezone() {
    setSavingTimezone(true)
    try {
      const updated = await mcpApi.updateSettings({ ...settings, timezone: currentTimezone.trim() || 'UTC' })
      setSettings(updated)
      onToast('Timezone updated.')
    } catch {
      onToast('Failed to update timezone.')
    } finally {
      setSavingTimezone(false)
    }
  }

  // Client mode override
  async function handleClientModeChange(clientId: string, mode: McpApprovalMode) {
    if (mode === 'trust') {
      setPendingTrustModeTarget({ clientId })
      return
    }
    try {
      await mcpApi.updateClient(clientId, { mode })
      setClients(prev => prev.map(c => (c.client_id === clientId ? { ...c, approval_mode: mode } : c)))
      onToast('Client approval mode updated.')
    } catch {
      onToast('Failed to update client mode.')
    }
  }

  // Client scope toggling
  async function handleClientScopeToggle(clientId: string, scope: McpScope) {
    const client = clients.find(c => c.client_id === clientId)
    if (!client) return
    const currentScopes = client.scopes || []
    const nextScopes = currentScopes.includes(scope)
      ? currentScopes.filter(s => s !== scope)
      : [...currentScopes, scope]

    try {
      await mcpApi.updateClient(clientId, { scopes: nextScopes })
      setClients(prev => prev.map(c => (c.client_id === clientId ? { ...c, scopes: nextScopes } : c)))
      onToast('Client permissions updated.')
    } catch {
      onToast('Failed to update permissions.')
    }
  }

  // Disconnect client
  async function handleDisconnectClient() {
    if (!clientToDisconnect) return
    try {
      await mcpApi.deleteClient(clientToDisconnect.client_id)
      setClients(prev => prev.filter(c => c.client_id !== clientToDisconnect.client_id))
      onToast(`Disconnected ${clientToDisconnect.name}.`)
    } catch {
      onToast('Failed to disconnect client.')
    } finally {
      setClientToDisconnect(null)
    }
  }

  // Create token
  async function handleCreateToken(e: React.FormEvent) {
    e.preventDefault()
    if (!tokenLabel.trim()) return

    setCreatingToken(true)
    try {
      const res = await mcpApi.createToken({
        label: tokenLabel.trim(),
        scopes: tokenScopes,
        expiresInDays: tokenExpiryDays
      })
      setCreatedTokenResult(res)
      setTokenLabel('')
      setShowCreateToken(false)
      const toks = await mcpApi.getTokens()
      setTokens(toks)
      onToast('Personal access token created.')
    } catch {
      onToast('Failed to create personal token.')
    } finally {
      setCreatingToken(false)
    }
  }

  // Revoke token
  async function handleRevokeToken() {
    if (!tokenToRevoke) return
    try {
      await mcpApi.revokeToken(tokenToRevoke.id)
      setTokens(prev => prev.filter(t => t.id !== tokenToRevoke.id))
      onToast('Token revoked.')
    } catch {
      onToast('Failed to revoke token.')
    } finally {
      setTokenToRevoke(null)
    }
  }

  // Approval decision
  async function handleApprove(id: string) {
    try {
      await mcpApi.approveAction(id)
      setApprovals(prev => prev.filter(a => a.id !== id))
      onToast('Action approved.')
    } catch {
      onToast('Failed to approve action.')
    }
  }

  async function handleDeny(id: string) {
    try {
      await mcpApi.denyAction(id)
      setApprovals(prev => prev.filter(a => a.id !== id))
      onToast('Action denied.')
    } catch {
      onToast('Failed to deny action.')
    }
  }

  // Undo activity
  async function handleUndoActivity() {
    if (!activityToUndo) return
    try {
      await mcpApi.undoActivity(activityToUndo.id)
      onToast(`Undone: ${activityToUndo.tool}`)
      const updatedActs = await mcpApi.getActivity()
      setActivity(updatedActs)
    } catch {
      onToast('Failed to undo action (snapshot may be expired or already used).')
    } finally {
      setActivityToUndo(null)
    }
  }

  const mcpUrl = status?.mcpUrl || `${window.location.origin}/mcp`
  const patTokens = tokens.filter(t => t.type === 'pat' && !t.revoked_at)
  const pendingApprovalsCount = approvals.length

  const snippetCode: Record<SnippetTab, string> = {
    claude_ai: buildClaudeAiSnippet(mcpUrl),
    chatgpt: buildChatGptSnippet(mcpUrl),
    claude_code: buildClaudeCodeSnippet(mcpUrl),
    cursor: buildCursorSnippet(mcpUrl),
    claude_desktop: buildClaudeDesktopSnippet(mcpUrl),
    gemini_cli: buildGeminiCliSnippet(mcpUrl)
  }

  if (loading) {
    return (
      <section className="account-card connected-apps-root">
        <header>
          <span>
            <strong>
              <Radio size={16} /> Connected apps (muse-mcp)
            </strong>
            <small>Loading MCP connector status…</small>
          </span>
        </header>
      </section>
    )
  }

  return (
    <section className="account-card connected-apps-root" aria-label="Connected apps management">
      {/* Header */}
      <header className="connected-apps-header">
        <div className="connected-apps-header-left">
          <h3>
            <Radio size={17} style={{ color: '#8660f1' }} />
            Connected apps (muse-mcp)
          </h3>
          {pendingApprovalsCount > 0 && (
            <span className="connected-apps-badge" title={`${pendingApprovalsCount} pending approvals`}>
              {pendingApprovalsCount}
            </span>
          )}
        </div>
      </header>

      {/* 1. Connector Card */}
      <div className="connector-card">
        <div>
          <span style={{ fontSize: '12.5px', fontWeight: 700, color: '#2a2833', display: 'block', marginBottom: 4 }}>
            Streamable HTTP Endpoint
          </span>
          <small style={{ color: '#8a8791', fontSize: '11px', display: 'block', marginBottom: 8 }}>
            Public connector endpoint for claude.ai, ChatGPT, Claude Code, Cursor, and Gemini CLI.
          </small>
        </div>

        <div className="connector-url-row">
          <code className="connector-url-code">{mcpUrl}</code>
          <button
            type="button"
            className="connector-copy-btn"
            onClick={() => copyToClipboard(mcpUrl, 'url')}
            title="Copy connector URL"
          >
            {copiedKey === 'url' ? <Check size={13} style={{ color: '#059669' }} /> : <Copy size={13} />}
            <span>{copiedKey === 'url' ? 'Copied' : 'Copy URL'}</span>
          </button>
        </div>

        {/* Snippet Tabs */}
        <div>
          <span style={{ fontSize: '11px', fontWeight: 600, color: '#65626f', display: 'block', marginBottom: 6 }}>
            Quick Setup Snippets:
          </span>
          <div className="snippet-tabs">
            {(
              [
                ['claude_ai', 'claude.ai'],
                ['chatgpt', 'ChatGPT'],
                ['claude_code', 'Claude Code'],
                ['cursor', 'Cursor'],
                ['claude_desktop', 'Claude Desktop'],
                ['gemini_cli', 'Gemini CLI']
              ] as [SnippetTab, string][]
            ).map(([tabId, label]) => (
              <button
                key={tabId}
                type="button"
                className={`snippet-tab-btn ${activeSnippetTab === tabId ? 'active' : ''}`}
                onClick={() => setActiveSnippetTab(tabId)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="snippet-body">
          <div className="snippet-copy-overlay">
            <button
              type="button"
              className="connector-copy-btn"
              onClick={() => copyToClipboard(snippetCode[activeSnippetTab], activeSnippetTab)}
              title="Copy snippet"
            >
              {copiedKey === activeSnippetTab ? (
                <Check size={12} style={{ color: '#059669' }} />
              ) : (
                <Copy size={12} />
              )}
              <span>{copiedKey === activeSnippetTab ? 'Copied' : 'Copy Snippet'}</span>
            </button>
          </div>
          <code>{snippetCode[activeSnippetTab]}</code>
        </div>
      </div>

      {/* 2. Approval Mode & Timezone */}
      <div className="mode-section">
        <div>
          <span style={{ fontSize: '13px', fontWeight: 700, color: '#2a2833', display: 'block', marginBottom: 4 }}>
            Default Approval Mode
          </span>
          <small style={{ color: '#8a8791', fontSize: '11.5px' }}>
            Determines how tool permissions are authorized for connected MCP clients.
          </small>
        </div>

        <div className="mode-segmented-control">
          {(['minimal', 'standard', 'trust'] as McpApprovalMode[]).map(m => (
            <button
              key={m}
              type="button"
              className={`mode-btn ${settings.defaultMode === m ? 'active' : ''} ${
                m === 'trust' ? 'trust-mode' : ''
              }`}
              onClick={() => void selectMode(m)}
            >
              {MODE_EXPLANATIONS[m].title}
            </button>
          ))}
        </div>

        <div className="mode-explanation">
          {MODE_EXPLANATIONS[settings.defaultMode].desc}
        </div>

        {settings.defaultMode === 'trust' && (
          <div className="mode-warning-banner">
            <ShieldAlert size={16} style={{ flexShrink: 0, marginTop: 1 }} />
            <div>
              <strong>Warning: </strong>
              {MODE_EXPLANATIONS.trust.warning}
            </div>
          </div>
        )}

        {/* Timezone row */}
        <div className="timezone-row">
          <div className="timezone-label">
            <strong>MCP Timezone</strong>
            <small>Used when interpreting natural language times and due dates from external models.</small>
          </div>
          <div className="timezone-controls">
            <input
              type="text"
              className="timezone-input"
              value={currentTimezone}
              onChange={e => setCurrentTimezone(e.target.value)}
              placeholder="e.g. Africa/Tunis or America/New_York"
            />
            <button
              type="button"
              className="connector-copy-btn"
              disabled={savingTimezone || currentTimezone === settings.timezone}
              onClick={() => void saveTimezone()}
            >
              Save
            </button>
          </div>
        </div>
      </div>

      {/* 3. Approvals Inbox */}
      <div className="approvals-inbox">
        <div className="inbox-title-row">
          <h4>
            <CheckCircle size={15} style={{ color: '#8660f1' }} />
            Pending Approvals ({approvals.length})
          </h4>
        </div>

        {approvals.length > 0 ? (
          <div className="approvals-list">
            {approvals.map(app => (
              <div key={app.id} className="approval-card">
                <div className="approval-card-top">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className="approval-tool-badge">{app.tool}</span>
                    <span style={{ fontSize: '11px', color: '#8c8a94' }}>
                      via {resolveClientName(app.client_id, clients)}
                    </span>
                  </div>
                  <span className="approval-time-badge">{formatExpiresIn(app.expires_at)}</span>
                </div>
                <div className="approval-summary">{app.summary}</div>
                <div className="approval-actions">
                  <button
                    type="button"
                    className="btn-deny"
                    onClick={() => void handleDeny(app.id)}
                  >
                    Deny
                  </button>
                  <button
                    type="button"
                    className="btn-approve"
                    onClick={() => void handleApprove(app.id)}
                  >
                    Approve
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-text">
            No pending approvals. When external clients execute sensitive operations in Standard mode, they will appear here.
          </div>
        )}
      </div>

      {/* 4. Connected Clients */}
      <div className="clients-section">
        <div>
          <span style={{ fontSize: '13px', fontWeight: 700, color: '#2a2833', display: 'block', marginBottom: 4 }}>
            Connected Clients ({clients.length})
          </span>
          <small style={{ color: '#8a8791', fontSize: '11.5px' }}>
            Apps authorized via OAuth 2.1 or Personal Access Tokens.
          </small>
        </div>

        {clients.length > 0 ? (
          <div className="clients-list">
            {clients.map(cli => {
              const isPat = isPersonalTokenClient(cli.client_id)
              return (
                <div key={cli.client_id} className="client-item-card">
                  <div className="client-item-top">
                    <div className="client-name-group">
                      <span className="client-name">{cli.name}</span>
                      <span className={`client-type-badge ${isPat ? 'pat' : 'oauth'}`}>
                        {isPat ? 'Personal Token' : 'OAuth'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="client-meta-text">
                        Last active: {formatRelativeTime(cli.last_used_at)}
                      </span>
                      <button
                        type="button"
                        className="btn-deny"
                        style={{ padding: '3px 8px', fontSize: '11px' }}
                        onClick={() => setClientToDisconnect(cli)}
                        title="Disconnect client and revoke all its tokens"
                      >
                        Disconnect
                      </button>
                    </div>
                  </div>

                  {/* Mode override control */}
                  <div className="client-controls-row">
                    <div className="client-mode-select-wrap">
                      <span style={{ color: '#65626f' }}>Mode override:</span>
                      <select
                        className="client-mode-select"
                        value={cli.approval_mode || ''}
                        onChange={e => {
                          const val = e.target.value as McpApprovalMode
                          if (val) void handleClientModeChange(cli.client_id, val)
                        }}
                      >
                        {cli.approval_mode === null && (
                          <option value="" disabled>
                            Default ({settings.defaultMode})
                          </option>
                        )}
                        <option value="minimal">Minimal</option>
                        <option value="standard">Standard</option>
                        <option value="trust">Trust</option>
                      </select>
                    </div>
                  </div>

                  {/* Scope checkboxes */}
                  <div>
                    <span style={{ fontSize: '10.5px', fontWeight: 600, color: '#8a8791', display: 'block' }}>
                      Allowed Scopes (click to toggle):
                    </span>
                    <div className="client-scopes-wrap">
                      {ALL_SCOPES.map(scope => {
                        const active = (cli.scopes || []).includes(scope)
                        return (
                          <button
                            key={scope}
                            type="button"
                            className={`scope-chip ${active ? 'active' : ''}`}
                            onClick={() => void handleClientScopeToggle(cli.client_id, scope)}
                            title={SCOPE_DESCRIPTIONS[scope]}
                          >
                            <input
                              type="checkbox"
                              checked={active}
                              readOnly
                              style={{ pointerEvents: 'none', marginRight: 2 }}
                            />
                            {scope}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="empty-text">No apps currently connected.</div>
        )}
      </div>

      {/* 5. Personal Access Tokens */}
      <div className="tokens-section">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#2a2833', display: 'block', marginBottom: 4 }}>
              Personal Access Tokens ({patTokens.length})
            </span>
            <small style={{ color: '#8a8791', fontSize: '11.5px' }}>
              Bearer tokens starting with <code>muse_mcp_</code> for CLI tools and local scripts.
            </small>
          </div>
          <button
            type="button"
            className="connector-copy-btn"
            onClick={() => setShowCreateToken(!showCreateToken)}
          >
            <KeyRound size={13} />
            <span>{showCreateToken ? 'Cancel' : 'Generate Token'}</span>
          </button>
        </div>

        {/* Show Token Once Banner */}
        {createdTokenResult && (
          <div className="token-once-banner">
            <div className="token-once-warning">
              <AlertTriangle size={15} />
              <span>Copy your personal token now. It will not be shown again!</span>
            </div>
            <div className="token-value-box">
              <code className="token-value-code">{createdTokenResult.token}</code>
              <button
                type="button"
                className="connector-copy-btn"
                onClick={() => copyToClipboard(createdTokenResult.token, 'new_token')}
              >
                {copiedKey === 'new_token' ? (
                  <Check size={13} style={{ color: '#059669' }} />
                ) : (
                  <Copy size={13} />
                )}
                <span>{copiedKey === 'new_token' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <button
              type="button"
              className="connector-copy-btn"
              style={{ alignSelf: 'flex-end' }}
              onClick={() => setCreatedTokenResult(null)}
            >
              Done
            </button>
          </div>
        )}

        {/* Token Creation Form */}
        {showCreateToken && (
          <form className="token-create-form" onSubmit={handleCreateToken}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#2a2833' }}>
              Create Personal Access Token
            </span>
            <div className="token-form-row">
              <input
                type="text"
                className="token-input"
                placeholder="Token label (e.g. Cursor on MacBook)"
                value={tokenLabel}
                onChange={e => setTokenLabel(e.target.value)}
                required
              />
              <select
                className="token-input"
                style={{ maxWidth: 150 }}
                value={tokenExpiryDays ?? 'never'}
                onChange={e => {
                  const val = e.target.value
                  setTokenExpiryDays(val === 'never' ? undefined : parseInt(val, 10))
                }}
              >
                <option value={30}>Expires in 30 days</option>
                <option value={90}>Expires in 90 days</option>
                <option value={365}>Expires in 1 year</option>
                <option value="never">No expiration</option>
              </select>
            </div>

            <div>
              <span style={{ fontSize: '11px', fontWeight: 600, color: '#65626f', display: 'block', marginBottom: 6 }}>
                Scopes:
              </span>
              <div className="client-scopes-wrap">
                {ALL_SCOPES.map(scope => {
                  const active = tokenScopes.includes(scope)
                  return (
                    <button
                      key={scope}
                      type="button"
                      className={`scope-chip ${active ? 'active' : ''}`}
                      onClick={() =>
                        setTokenScopes(prev =>
                          prev.includes(scope) ? prev.filter(s => s !== scope) : [...prev, scope]
                        )
                      }
                      title={SCOPE_DESCRIPTIONS[scope]}
                    >
                      <input
                        type="checkbox"
                        checked={active}
                        readOnly
                        style={{ pointerEvents: 'none', marginRight: 2 }}
                      />
                      {scope}
                    </button>
                  )
                })}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                className="connector-copy-btn"
                onClick={() => setShowCreateToken(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn-approve"
                disabled={creatingToken || !tokenLabel.trim() || tokenScopes.length === 0}
              >
                {creatingToken ? 'Generating…' : 'Generate Token'}
              </button>
            </div>
          </form>
        )}

        {/* Tokens List */}
        {patTokens.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {patTokens.map(tok => (
              <div
                key={tok.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '9px 12px',
                  borderRadius: 8,
                  border: '1px solid #eeedf1',
                  background: '#faf9fb',
                  fontSize: '12px',
                  flexWrap: 'wrap',
                  gap: 8
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <strong style={{ color: '#2a2833' }}>{tok.label || 'Unnamed token'}</strong>
                  <span style={{ fontSize: '10.5px', color: '#8c8a94' }}>
                    Created {formatRelativeTime(tok.created_at)} · Expires:{' '}
                    {tok.expires_at ? new Date(tok.expires_at).toLocaleDateString() : 'Never'}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: '11px', color: '#8c8a94' }}>
                    Last used: {formatRelativeTime(tok.last_used_at)}
                  </span>
                  <button
                    type="button"
                    className="btn-deny"
                    style={{ padding: '3px 8px', fontSize: '11px' }}
                    onClick={() => setTokenToRevoke(tok)}
                  >
                    Revoke
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-text">No active personal access tokens.</div>
        )}
      </div>

      {/* 6. Activity Feed & Undo */}
      <div className="activity-section">
        <div>
          <span style={{ fontSize: '13px', fontWeight: 700, color: '#2a2833', display: 'block', marginBottom: 4 }}>
            Activity Feed ({activity.length})
          </span>
          <small style={{ color: '#8a8791', fontSize: '11.5px' }}>
            Live stream of MCP tool executions with 1-click rollback snapshots.
          </small>
        </div>

        {activity.length > 0 ? (
          <div className="activity-list">
            {activity.map(act => (
              <div key={act.id} className="activity-item">
                <div className="activity-left">
                  <span className="activity-tool">{act.tool}</span>
                  <span className="activity-summary" title={act.summary}>
                    {act.summary}
                  </span>
                </div>
                <div className="activity-right">
                  <span style={{ fontSize: '11px', color: '#8c8a94' }}>
                    {resolveClientName(act.client_id, clients)}
                  </span>
                  <span className={`outcome-pill ${act.outcome}`}>
                    {act.outcome === 'ok' ? 'Success' : act.outcome === 'error' ? 'Error' : 'Pending'}
                  </span>
                  <span style={{ fontSize: '11px', color: '#8c8a94' }}>
                    {formatRelativeTime(act.created_at)}
                  </span>
                  {act.undo_id && (
                    <button
                      type="button"
                      className="btn-undo"
                      onClick={() => setActivityToUndo(act)}
                      title="Undo changes made by this tool"
                    >
                      <RotateCcw size={11} />
                      <span>Undo</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-text">No activity recorded yet.</div>
        )}
      </div>

      {/* Confirm Modal: Trust Mode Warning */}
      <ConfirmModal
        isOpen={Boolean(pendingTrustModeTarget)}
        title="Enable Trust Approval Mode?"
        message="Text in notes or web pages could make the AI delete things without asking; deletions keep a 7-day undo."
        confirmText="Enable Trust Mode"
        cancelText="Cancel"
        danger={true}
        icon="warning"
        onConfirm={() => void confirmTrustMode()}
        onCancel={() => setPendingTrustModeTarget(null)}
      />

      {/* Confirm Modal: Disconnect Client */}
      <ConfirmModal
        isOpen={Boolean(clientToDisconnect)}
        title="Disconnect Client?"
        message={`Are you sure you want to disconnect "${clientToDisconnect?.name}"? All access and refresh tokens will be revoked immediately.`}
        confirmText="Disconnect"
        cancelText="Cancel"
        danger={true}
        icon="trash"
        onConfirm={() => void handleDisconnectClient()}
        onCancel={() => setClientToDisconnect(null)}
      />

      {/* Confirm Modal: Revoke Token */}
      <ConfirmModal
        isOpen={Boolean(tokenToRevoke)}
        title="Revoke Token?"
        message={`Are you sure you want to revoke personal access token "${tokenToRevoke?.label}"? It will stop working immediately.`}
        confirmText="Revoke"
        cancelText="Cancel"
        danger={true}
        icon="trash"
        onConfirm={() => void handleRevokeToken()}
        onCancel={() => setTokenToRevoke(null)}
      />

      {/* Confirm Modal: Undo Activity */}
      <ConfirmModal
        isOpen={Boolean(activityToUndo)}
        title="Undo MCP Action?"
        message={`Undo changes made by "${activityToUndo?.tool}"? Muse will restore the database snapshot recorded before this action ran.`}
        confirmText="Undo Action"
        cancelText="Cancel"
        danger={false}
        icon="info"
        onConfirm={() => void handleUndoActivity()}
        onCancel={() => setActivityToUndo(null)}
      />
    </section>
  )
}
