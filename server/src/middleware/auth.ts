import type { NextFunction, Request, Response } from 'express'
import { owner } from '../services/owner.service.js'
import { readSession, SESSION_COOKIE } from '../services/session.service.js'

export const DEFAULT_LOCAL_USER_ID = '00000000-0000-0000-0000-000000000001'

// One way in: the owner's signed session cookie (issued after the passphrase
// or a passkey). Everything else is 401. MCP clients use requireMcpAuth.
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    await owner.ready()
    const claims = readSession(req.cookies?.[SESSION_COOKIE])
    if (!claims) return res.status(401).json({ error: 'Unlock Muse to continue.', code: 'auth_required' })
    req.userId = claims.sub
    req.userEmail = claims.email || 'local@muse.local'
    req.authMethod = 'session'
    next()
  } catch (error) { next(error) }
}
