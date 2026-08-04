import type { NextFunction, Request, Response } from 'express'
import { authClient } from '../supabase/client.js'

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) return res.status(401).json({ error: 'Sign in to continue.' })
  const { data, error } = await authClient.auth.getUser(token)
  if (error || !data.user) return res.status(401).json({ error: 'Your session is invalid or expired.' })
  req.userId = data.user.id
  next()
}
