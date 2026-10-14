import { createHash, timingSafeEqual } from 'node:crypto'

export function hashChallenge(value: string) {
  return createHash('sha256').update(value).digest('base64url')
}

export function challengeHashMatches(value: string, expected: string) {
  const actual = Buffer.from(hashChallenge(value))
  const stored = Buffer.from(expected)
  return actual.length === stored.length && timingSafeEqual(actual, stored)
}

export function challengeIsUsable(challenge: { expires_at: string; used_at: string | null }, now = Date.now()) {
  return !challenge.used_at && new Date(challenge.expires_at).getTime() > now
}

// Authenticators that implement a signature counter must move forward. A zero
// counter is valid for authenticators that intentionally do not support one.
export function counterAdvanced(previous: number, next: number) {
  return previous === 0 || next === 0 || next > previous
}
