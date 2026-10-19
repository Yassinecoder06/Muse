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
