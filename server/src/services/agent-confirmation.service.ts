import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { owner } from './owner.service.js'

// Destructive agent tools never run on the model's say-so. The tool call is
// turned into a signed, short-lived token that the user must send back from
// the UI. The token pins the exact target id the user saw on the card.

const TTL_MS = 10 * 60_000
const used = new Map<string, number>()

type Pending = { uid: string; tool: string; args: Record<string, unknown>; exp: number; nonce: string }

function sign(body: string) {
  const key = owner.signingKey('agent-confirm')
  if (!key) throw new Error('Muse owner passphrase is not configured.')
  return createHmac('sha256', key).update(body).digest('base64url')
}

export function createConfirmationToken(userId: string, tool: string, args: Record<string, unknown>) {
  const pending: Pending = { uid: userId, tool, args, exp: Date.now() + TTL_MS, nonce: randomBytes(9).toString('base64url') }
  const body = Buffer.from(JSON.stringify(pending)).toString('base64url')
  return `${body}.${sign(body)}`
}

export function consumeConfirmationToken(userId: string, token: string) {
  const [body, received] = token.split('.')
  if (!body || !received) return null
  const expected = Buffer.from(sign(body))
  const actual = Buffer.from(received)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
  let pending: Pending
  try { pending = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) } catch { return null }
  const now = Date.now()
  for (const [nonce, exp] of used) if (exp < now) used.delete(nonce)
  if (pending.uid !== userId || pending.exp < now || used.has(pending.nonce)) return null
  used.set(pending.nonce, pending.exp)
  return { tool: pending.tool, args: pending.args }
}
