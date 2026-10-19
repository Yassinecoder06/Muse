import type { Request } from 'express'

// The server usually runs in UTC (Docker), but "tomorrow at 8pm" means 8pm
// where the user is. Clients send their IANA zone in `x-muse-timezone`; every
// natural-language date is resolved against it.

const FALLBACK = process.env.MUSE_DEFAULT_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

export function isValidTimezone(zone: string) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); return true } catch { return false }
}

export function requestTimezone(req: Request) {
  const zone = req.get('x-muse-timezone')?.trim()
  return zone && zone.length <= 64 && isValidTimezone(zone) ? zone : FALLBACK
}

// Minutes east of UTC for `zone` at `at` (DST-aware), e.g. Africa/Tunis → 60.
export function offsetMinutes(zone: string, at = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(at).map(part => [part.type, part.value]))
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second))
  return Math.round((asUtc - at.getTime()) / 60_000)
}

// Reference object for chrono.parse so relative phrases resolve in the user's zone.
export function chronoReference(zone: string, instant = new Date()) {
  return { instant, timezone: offsetMinutes(zone, instant) }
}

// Calendar date (YYYY-MM-DD) of `date` as seen in `zone`.
export function localDateString(zone: string, date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

export function describeNow(zone: string, now = new Date()) {
  return {
    date: now.toLocaleDateString('en-US', { timeZone: zone, weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' }),
    time: now.toLocaleTimeString('en-US', { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: true })
  }
}

/** "15:30", "15:30:00" (Postgres time), "3:30 PM", "3pm", "15h30" → [hour, minute]. */
export function parseClock(value: string | null | undefined): [number, number] | null {
  const match = value?.trim().match(/^(\d{1,2})(?:[:h](\d{2}))?(?::\d{2})?\s*h?\s*([ap]\.?m\.?)?$/i)
  if (!match) return null
  let hour = Number(match[1])
  const minute = Number(match[2] ?? 0)
  const meridiem = match[3]?.toLowerCase().replace(/\./g, '')
  if (meridiem === 'pm' && hour < 12) hour += 12
  if (meridiem === 'am' && hour === 12) hour = 0
  return hour < 24 && minute < 60 ? [hour, minute] : null
}

/** Normalizes a free-form time ("3pm") to "HH:MM" for the tasks.due_time column. */
export function normalizeClock(value: string | null | undefined) {
  const parsed = parseClock(value)
  return parsed ? `${String(parsed[0]).padStart(2, '0')}:${String(parsed[1]).padStart(2, '0')}` : null
}

/** Instant of a wall-clock date + time in `zone` (DST-aware). */
export function zonedInstant(date: string, hour: number, minute: number, zone: string) {
  const wallAsUtc = Date.parse(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`)
  // Two passes settle the offset on DST-change days.
  let instant = wallAsUtc - offsetMinutes(zone, new Date(wallAsUtc)) * 60_000
  instant = wallAsUtc - offsetMinutes(zone, new Date(instant)) * 60_000
  return new Date(instant)
}

/**
 * When to alert for a task due at `dueDate` (+ optional `dueTime`) in `zone`,
 * `minutesBefore` earlier. Date-only tasks count as due at 09:00.
 */
export function reminderInstant(dueDate: string, dueTime: string | null | undefined, minutesBefore: number, zone: string) {
  const [hour, minute] = parseClock(dueTime) ?? [9, 0]
  return new Date(zonedInstant(dueDate, hour, minute, zone).getTime() - minutesBefore * 60_000)
}
