import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveReminder } from './tasks.controller.js'

const zone = 'Africa/Tunis'

test('relative reminder is computed from the due time', () => {
  assert.deepEqual(resolveReminder({ due_date: '2026-10-20', due_time: '18:00', reminder_minutes_before: 2 }, null, zone),
    { reminder_at: '2026-10-20T16:58:00.000Z', reminder_minutes_before: 2 })
})

test('moving the due time moves a relative reminder', () => {
  const current = { due_date: '2026-10-20', due_time: '18:00', reminder_minutes_before: 15, reminder_at: '2026-10-20T16:45:00.000Z' }
  assert.deepEqual(resolveReminder({ due_time: '19:00' }, current, zone), { reminder_at: '2026-10-20T17:45:00.000Z', reminder_minutes_before: 15 })
})

test('exact reminder time wins and is not tied to the due time', () => {
  assert.deepEqual(resolveReminder({ reminder_at: '2026-10-20T19:45:00+01:00' }, null, zone), { reminder_at: '2026-10-20T18:45:00.000Z', reminder_minutes_before: null })
})

test('clearing, untouched, and missing due date', () => {
  const current = { due_date: '2026-10-20', due_time: '18:00', reminder_minutes_before: 5, reminder_at: 'x' }
  assert.deepEqual(resolveReminder({ reminder_minutes_before: null }, current, zone), { reminder_at: null, reminder_minutes_before: null })
  assert.deepEqual(resolveReminder({ text: 'renamed' } as any, current, zone), {})
  assert.throws(() => resolveReminder({ reminder_minutes_before: 5 }, null, zone), /due date/)
})
