import type { NextFunction, Request, Response } from 'express'

export const DEFAULT_LOCAL_USER_ID = '00000000-0000-0000-0000-000000000001'

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  // Pure local-first mode: zero login required. Never return 401.
  const headerUserId = req.get('x-muse-user-id')
  req.userId = headerUserId && /^[0-9a-f-]{36}$/i.test(headerUserId) ? headerUserId : DEFAULT_LOCAL_USER_ID
  req.userEmail = req.get('x-muse-user-email') || 'local@muse.local'
  req.authMethod = 'session'
  next()
}
