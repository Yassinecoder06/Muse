import { createHash, timingSafeEqual } from 'node:crypto'
import { SCOPES } from './internal.js'

const sha256 = (value: string) => createHash('sha256').update(value).digest('base64url')
export function verifyPkce(verifier: string, challenge: string) {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || !/^[-_A-Za-z0-9]{43}$/.test(challenge)) return false
  const actual = Buffer.from(sha256(verifier)),
    expected = Buffer.from(challenge)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
export function downgradedScopes(requested: unknown, allowed: unknown) {
  const requestList = Array.isArray(requested) ? requested : typeof requested === 'string' ? [requested] : []
  const allowedList = Array.isArray(allowed) ? allowed : []
  return requestList.filter(
    (scope): scope is string => typeof scope === 'string' && (SCOPES as string[]).includes(scope) && allowedList.includes(scope)
  )
}
export function validDcrRedirect(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  } catch {
    return false
  }
}
export function validAccessRow(row: { revoked_at: string | null; expires_at: string | null; type: string } | null, now = Date.now()) {
  return (
    !!row && !row.revoked_at && (!row.expires_at || Date.parse(row.expires_at) > now) && (row.type === 'pat' || row.type === 'oauth_access')
  )
}
export function codeCanBeConsumed(row: { consumed_at: string | null; expires_at: string } | null, now = Date.now()) {
  return !!row && !row.consumed_at && Date.parse(row.expires_at) > now
}
export function refreshAction(row: { type: string; revoked_at: string | null } | null): 'reject' | 'rotate' | 'revoke-family' {
  if (!row || row.type !== 'oauth_refresh') return 'reject'
  return row.revoked_at ? 'revoke-family' : 'rotate'
}
export function approvalCanBeDecided(row: { status: string; expires_at: string } | null, now = Date.now()) {
  return !!row && row.status === 'pending' && Date.parse(row.expires_at) > now
}
export function validDcr(body: unknown): body is { client_name: string; redirect_uris: string[]; scope?: string } {
  if (!body || typeof body !== 'object') return false
  const value = body as Record<string, unknown>
  return (
    typeof value.client_name === 'string' &&
    value.client_name.trim().length > 0 &&
    value.client_name.length <= 100 &&
    Array.isArray(value.redirect_uris) &&
    value.redirect_uris.length > 0 &&
    value.redirect_uris.length <= 10 &&
    value.redirect_uris.every(uri => typeof uri === 'string' && validDcrRedirect(uri)) &&
    (value.scope === undefined || typeof value.scope === 'string')
  )
}
