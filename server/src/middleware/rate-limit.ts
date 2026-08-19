import type { Request } from 'express'
import { rateLimit } from 'express-rate-limit'

// Limits are keyed by authenticated user when available and fall back to the
// client IP so unauthenticated endpoints (health, images) are still protected.
const keyGenerator = (req: Request) => req.userId || req.ip || 'anonymous'

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
