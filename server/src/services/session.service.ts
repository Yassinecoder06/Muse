import { createHmac, timingSafeEqual } from 'node:crypto'
import { env } from '../utils/env.js'
import { owner } from './owner.service.js'

export const SESSION_COOKIE = 'muse_session'
const TTL_SECONDS = 60 * 60 * 24 * 30

type SessionClaims = { sub: string; email?: string; exp: number }

function encode(value: unknown) { return Buffer.from(JSON.stringify(value)).toString('base64url') }
// Sessions can only be minted or read once the owner passphrase exists; the
// signing key includes the owner's random session salt. Await owner.ready()
// before calling these.
function signature(value: string) {
  const key = owner.signingKey('session')
  return key ? createHmac('sha256', key).update(value).digest('base64url') : null
}

export function createSession(userId: string, email?: string) {
  const payload: SessionClaims = { sub: userId, email, exp: Math.floor(Date.now() / 1000) + TTL_SECONDS }
  const body = encode(payload)
  const signed = signature(body)
  if (!signed) throw Object.assign(new Error('Set the Muse owner passphrase first.'), { statusCode: 409 })
  return `${body}.${signed}`
}

export function readSession(token: string | undefined): SessionClaims | null {
  if (!token) return null
  const [body, received] = token.split('.')
  if (!body || !received) return null
  const expected = signature(body)
  if (!expected) return null
  const receivedBuffer = Buffer.from(received)
  const expectedBuffer = Buffer.from(expected)
  if (receivedBuffer.length !== expectedBuffer.length || !timingSafeEqual(receivedBuffer, expectedBuffer)) return null
  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionClaims
    return claims.sub && typeof claims.exp === 'number' && claims.exp > Math.floor(Date.now() / 1000) ? claims : null
  } catch { return null }
}

export const sessionCookie = (token: string) => ({
  httpOnly: true,
  secure: env.PUBLIC_URL.startsWith('https://'),
  sameSite: 'lax' as const,
  maxAge: TTL_SECONDS * 1000,
  path: '/'
})

export const clearSessionCookie = { httpOnly: true, secure: env.PUBLIC_URL.startsWith('https://'), sameSite: 'lax' as const, path: '/' }
