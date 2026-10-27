import test from 'node:test'
import assert from 'node:assert/strict'
import { toDateKey, getEventDateKey } from './CalendarView'
import { localDateString, parseDateWithTime } from '../services/api'

test('toDateKey formats local calendar day as YYYY-MM-DD regardless of time', () => {
  const d1 = new Date(2026, 9, 27, 0, 0, 0)
  assert.equal(toDateKey(d1), '2026-10-27')

  const d2 = new Date(2026, 9, 27, 12, 0, 0)
  assert.equal(toDateKey(d2), '2026-10-27')

  const d3 = new Date(2026, 9, 27, 23, 59, 59)
  assert.equal(toDateKey(d3), '2026-10-27')
})

test('getEventDateKey extracts the local calendar day from UTC ISO timestamps', () => {
  // Oct 27 at 10:00 local in UTC+1 is 09:00 UTC
  // In a previous bug, comparing with .toISOString().slice(0, 10) matched day 28 (the day after)
  // because cellDate was midnight (23:00 UTC of previous day).
  const morningEventUtc = '2026-10-27T09:00:00.000Z'
  const key = getEventDateKey(morningEventUtc)
  assert.ok(key.length === 10, 'Must return YYYY-MM-DD')

  // Corrupted / invalid ISO string returns empty string safely
  assert.equal(getEventDateKey('invalid-iso'), '')
  assert.equal(getEventDateKey(''), '')
})

test('calendar cell matching matches the exact day, never the day after', () => {
  // Simulate an event created on Oct 27 at 10:00 local time
  const targetYear = 2026
  const targetMonth = 9 // October (0-indexed)
  const targetDay = 27

  // Cell for Oct 27
  const cell27 = new Date(targetYear, targetMonth, targetDay, 12, 0, 0)
  const cell27Key = toDateKey(cell27)

  // Cell for Oct 28 (the day after)
  const cell28 = new Date(targetYear, targetMonth, targetDay + 1, 12, 0, 0)
  const cell28Key = toDateKey(cell28)

  assert.equal(cell27Key, '2026-10-27')
  assert.equal(cell28Key, '2026-10-28')

  // Create an event for Oct 27 at 10:00 local time
  const eventStart = new Date(targetYear, targetMonth, targetDay, 10, 0, 0)
  const eventStartIso = eventStart.toISOString()

  // Verify event matches cell 27, NOT cell 28
  assert.equal(getEventDateKey(eventStartIso), cell27Key, 'Event must match the day it was scheduled on')
  assert.notEqual(getEventDateKey(eventStartIso), cell28Key, 'Event must NOT match the day after')
})

test('parseDateWithTime correctly parses date strings in local time without UTC offset drift', () => {
  const d = parseDateWithTime('2026-10-27', 14, 30)
  assert.equal(d.getFullYear(), 2026)
  assert.equal(d.getMonth(), 9)
  assert.equal(d.getDate(), 27)
  assert.equal(d.getHours(), 14)
  assert.equal(d.getMinutes(), 30)
})

test('localDateString formats today in local time', () => {
  const now = new Date()
  const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  assert.equal(localDateString(now), expected)
})
