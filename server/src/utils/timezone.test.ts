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

test('reminderInstant: minutes before a local due time, DST-aware', async () => {
  const { reminderInstant, parseClock } = await import('./timezone.js')
  assert.deepEqual(parseClock('15:30:00'), [15, 30])
  assert.deepEqual(parseClock('3:30 PM'), [15, 30])
  assert.deepEqual(parseClock('12:05 am'), [0, 5])
  assert.equal(parseClock('later'), null)
  // 15:30 in Tunis (UTC+1) minus 10 minutes = 14:20 UTC
  assert.equal(reminderInstant('2026-10-20', '15:30', 10, 'Africa/Tunis').toISOString(), '2026-10-20T14:20:00.000Z')
  // Date-only task counts as 09:00 local
  assert.equal(reminderInstant('2026-10-20', null, 0, 'Africa/Tunis').toISOString(), '2026-10-20T08:00:00.000Z')
  // Paris summer (UTC+2) vs winter (UTC+1)
  assert.equal(reminderInstant('2026-07-01', '09:00', 0, 'Europe/Paris').toISOString(), '2026-07-01T07:00:00.000Z')
  assert.equal(reminderInstant('2026-12-01', '09:00', 0, 'Europe/Paris').toISOString(), '2026-12-01T08:00:00.000Z')
})

test('parseClock understands how people (and Bip) write times', async () => {
  const { parseClock, normalizeClock } = await import('./timezone.js')
  assert.deepEqual(parseClock('3pm'), [15, 0])
  assert.deepEqual(parseClock('3 PM'), [15, 0])
  assert.deepEqual(parseClock('15h30'), [15, 30])
  assert.deepEqual(parseClock('20h'), [20, 0])
  assert.deepEqual(parseClock('9'), [9, 0])
  assert.equal(parseClock('25:00'), null)
  assert.equal(normalizeClock('3:05 pm'), '15:05')
  assert.equal(normalizeClock('soon'), null)
})
