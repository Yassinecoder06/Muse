import type { NextFunction, Request, Response } from 'express'
import { z } from 'zod'
import { DEFAULT_LOCAL_USER_ID } from '../middleware/auth.js'
import { owner } from '../services/owner.service.js'
import { createSession, readSession, SESSION_COOKIE, sessionCookie } from '../services/session.service.js'

const passphrase = z.string().min(10, 'Use at least 10 characters.').max(256)

function startSession(res: Response) {
  const token = createSession(DEFAULT_LOCAL_USER_ID)
  res.cookie(SESSION_COOKIE, token, sessionCookie(token)).json({ authenticated: true })
}

export async function ownerStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const configured = await owner.configured()
    res.json({ configured, authenticated: configured && !!readSession(req.cookies?.[SESSION_COOKIE]) })
  } catch (error) { next(error) }
}

export async function setupOwner(req: Request, res: Response, next: NextFunction) {
  try {
    const body = z.object({ passphrase, setupCode: z.string().min(1).max(20) }).parse(req.body)
    await owner.setup(body.passphrase, body.setupCode)
    startSession(res)
  } catch (error) { next(error) }
}

export async function loginOwner(req: Request, res: Response, next: NextFunction) {
  try {
    const body = z.object({ passphrase: z.string().min(1).max(256) }).parse(req.body)
    if (!(await owner.verify(body.passphrase))) return res.status(401).json({ error: 'That passphrase is not correct.' })
    startSession(res)
  } catch (error) { next(error) }
}
