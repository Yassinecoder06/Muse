import type { Request } from 'express'
import { ipKeyGenerator, rateLimit } from 'express-rate-limit'

// ipKeyGenerator groups IPv6 addresses by /56 so one host cannot rotate
// through its prefix to dodge a limit.
const ipKey = (req: Request) => ipKeyGenerator(req.ip || '0.0.0.0')

// Limits are keyed by authenticated user when available and fall back to the
// client IP so unauthenticated endpoints (health, images) are still protected.
const keyGenerator = (req: Request) => req.userId || ipKey(req)

export const apiLimiter = rateLimit({
  windowMs: 60_000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false,
  keyGenerator, message: { error: 'Too many requests, slow down.' }
})

export const uploadLimiter = rateLimit({
  windowMs: 15 * 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false,
  keyGenerator, message: { error: 'Upload limit reached. Try again in a few minutes.' }
})

export const imageLimiter = rateLimit({
  windowMs: 60_000, limit: 600, standardHeaders: 'draft-8', legacyHeaders: false,
  keyGenerator, message: { error: 'Too many requests, slow down.' }
})

// Brute-force protection for the owner passphrase and the 6-digit pairing PIN.
// Keyed by IP only: these run before authentication.
export const loginLimiter = rateLimit({
  windowMs: 15 * 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false,
  keyGenerator: ipKey, message: { error: 'Too many attempts. Try again in a few minutes.' }
})

export const pairingLimiter = rateLimit({
  windowMs: 15 * 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false,
  keyGenerator: ipKey, message: { error: 'Too many pairing attempts. Try again in a few minutes.' }
})
