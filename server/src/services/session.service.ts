import { createHmac, timingSafeEqual } from 'node:crypto'
import { env } from '../utils/env.js'

export const SESSION_COOKIE = 'muse_session'
const TTL_SECONDS = 60 * 60 * 24 * 30

type SessionClaims = { sub: string; email?: string; exp: number }

function encode(value: unknown) { return Buffer.from(JSON.stringify(value)).toString('base64url') }
function signature(value: string) { return createHmac('sha256', env.MUSE_SESSION_SECRET).update(value).digest('base64url') }

export function createSession(userId: string, email?: string) {
  const payload: SessionClaims = { sub: userId, email, exp: Math.floor(Date.now() / 1000) + TTL_SECONDS }
  const body = encode(payload)
  return `${body}.${signature(body)}`
}

export function readSession(token: string | undefined): SessionClaims | null {
  if (!token) return null
  const [body, received] = token.split('.')
  if (!body || !received) return null
  const expected = signature(body)
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
