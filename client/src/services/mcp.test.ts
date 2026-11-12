import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ALL_SCOPES,
  DEFAULT_SCOPES,
  buildChatGptSnippet,
  buildClaudeAiSnippet,
  buildClaudeCodeSnippet,
  buildClaudeDesktopSnippet,
  buildCursorSnippet,
  buildGeminiCliSnippet,
  formatExpiresIn,
  formatRelativeTime,
  getDefaultScopes,
  isPersonalTokenClient,
  resolveClientName,
  type McpClientRow
} from './mcp'

const BASE_NOW = new Date('2026-11-12T16:00:00Z')
const SAMPLE_URL = 'https://muse-mcp.yassinejemmali.me/mcp'

test('default scopes exclude web and code by default', () => {
  const defaults = getDefaultScopes()
  assert.equal(defaults.includes('web'), false)
  assert.equal(defaults.includes('code'), false)
  assert.equal(defaults.includes('notes:read'), true)
  assert.equal(defaults.includes('notes:write'), true)
  assert.equal(defaults.includes('tasks'), true)
  assert.equal(defaults.length, 8)
  assert.equal(ALL_SCOPES.length, 10)
})

test('isPersonalTokenClient identifies PAT clients', () => {
  assert.equal(isPersonalTokenClient('pat:1234-abcd'), true)
  assert.equal(isPersonalTokenClient('oauth-client-xyz'), false)
  assert.equal(isPersonalTokenClient(''), false)
})

test('resolveClientName resolves known clients, personal tokens, and fallbacks', () => {
  const clients: McpClientRow[] = [
    {
      client_id: 'client-claude',
      name: 'Claude Desktop',
      scopes: ['notes:read'],
      approval_mode: 'minimal',
      remembered: true,
      created_at: '2026-11-01T00:00:00Z',
      last_used_at: null
    },
    {
      client_id: 'pat:token-1',
      name: 'My Custom Script',
      scopes: ['tasks'],
      approval_mode: null,
      remembered: false,
      created_at: '2026-11-05T00:00:00Z',
      last_used_at: null
    }
  ]

  assert.equal(resolveClientName('client-claude', clients), 'Claude Desktop')
  assert.equal(resolveClientName('pat:token-1', clients), 'My Custom Script')
  assert.equal(resolveClientName('pat:unknown-id', clients), 'Personal Token')
  assert.equal(resolveClientName('unknown-uuid-long', clients), 'unknown-')
  assert.equal(resolveClientName('', clients), 'Unknown client')
})

test('formatRelativeTime formats past intervals accurately', () => {
  // Just now (< 45s)
  assert.equal(formatRelativeTime('2026-11-12T15:59:30Z', BASE_NOW), 'just now')
  // Minutes
  assert.equal(formatRelativeTime('2026-11-12T15:45:00Z', BASE_NOW), '15m ago')
  // Hours
  assert.equal(formatRelativeTime('2026-11-12T13:00:00Z', BASE_NOW), '3h ago')
  // Days
  assert.equal(formatRelativeTime('2026-11-08T16:00:00Z', BASE_NOW), '4d ago')
  // Months
  assert.equal(formatRelativeTime('2026-09-12T16:00:00Z', BASE_NOW), '2mo ago')
  // Null or invalid
  assert.equal(formatRelativeTime(null, BASE_NOW), 'never')
  assert.equal(formatRelativeTime('invalid-date', BASE_NOW), 'unknown')
})

test('formatExpiresIn formats remaining time and expiration', () => {
  // Expired
  assert.equal(formatExpiresIn('2026-11-12T15:00:00Z', BASE_NOW), 'Expired')
  // Minutes left
  assert.equal(formatExpiresIn('2026-11-12T16:25:00Z', BASE_NOW), '25m left')
  // Hours left
  assert.equal(formatExpiresIn('2026-11-12T20:00:00Z', BASE_NOW), '4h left')
  // Days left
  assert.equal(formatExpiresIn('2026-11-22T16:00:00Z', BASE_NOW), '10d left')
  // Null
  assert.equal(formatExpiresIn(null, BASE_NOW), 'Never')
})

test('snippet builders generate valid instructions and configurations', () => {
  // Claude.ai
  assert.equal(buildClaudeAiSnippet(SAMPLE_URL), SAMPLE_URL)

  // ChatGPT
  assert.equal(buildChatGptSnippet(SAMPLE_URL), SAMPLE_URL)

  // Claude Code CLI
  const cliStandard = buildClaudeCodeSnippet(SAMPLE_URL)
  assert.equal(cliStandard, `claude mcp add --transport http muse ${SAMPLE_URL}`)

  const cliWithPat = buildClaudeCodeSnippet(SAMPLE_URL, 'muse_mcp_test_token')
  assert.equal(
    cliWithPat,
    `claude mcp add --transport http -H "Authorization: Bearer muse_mcp_test_token" muse ${SAMPLE_URL}`
  )

  // Claude Desktop JSON
  const desktopSnippet = buildClaudeDesktopSnippet(SAMPLE_URL, 'token_xyz')
  const desktopParsed = JSON.parse(desktopSnippet)
  assert.equal(desktopParsed.mcpServers.muse.url, SAMPLE_URL)
  assert.equal(desktopParsed.mcpServers.muse.headers.Authorization, 'Bearer token_xyz')

  // Cursor JSON
  const cursorSnippet = buildCursorSnippet(SAMPLE_URL, 'token_xyz')
  const cursorParsed = JSON.parse(cursorSnippet)
  assert.equal(cursorParsed.url, SAMPLE_URL)
  assert.equal(cursorParsed.headers.Authorization, 'Bearer token_xyz')

  // Gemini CLI JSON
  const geminiSnippet = buildGeminiCliSnippet(SAMPLE_URL, 'token_xyz')
  const geminiParsed = JSON.parse(geminiSnippet)
  assert.equal(geminiParsed.mcpServers.muse.httpUrl, SAMPLE_URL)
  assert.equal(geminiParsed.mcpServers.muse.headers.Authorization, 'Bearer token_xyz')
})
