import assert from 'node:assert/strict'
import test from 'node:test'
import * as chrono from 'chrono-node'
import { chronoReference, localDateString, offsetMinutes } from './timezone.js'

test('offsetMinutes follows DST for the zone, not the server', () => {
  assert.equal(offsetMinutes('Africa/Tunis', new Date('2026-07-01T12:00:00Z')), 60)
  assert.equal(offsetMinutes('Europe/Paris', new Date('2026-07-01T12:00:00Z')), 120)
  assert.equal(offsetMinutes('Europe/Paris', new Date('2026-01-15T12:00:00Z')), 60)
  assert.equal(offsetMinutes('America/New_York', new Date('2026-01-15T12:00:00Z')), -300)
})

test('"tomorrow at 8pm" resolves to 8pm in the user zone', () => {
  const now = new Date('2026-10-19T10:00:00Z')
  const parsed = chrono.parse('tomorrow at 8pm', chronoReference('Africa/Tunis', now))[0].start.date()
  assert.equal(parsed.toISOString(), '2026-10-20T19:00:00.000Z')
})

test('localDateString uses the user calendar day', () => {
  // 23:30 UTC on the 19th is already the 20th in Tunis.
  assert.equal(localDateString('Africa/Tunis', new Date('2026-10-19T23:30:00Z')), '2026-10-20')
  assert.equal(localDateString('UTC', new Date('2026-10-19T23:30:00Z')), '2026-10-19')
})
