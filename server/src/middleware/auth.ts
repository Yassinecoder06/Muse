import { createHash } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { supabase } from '../supabase/client.js'
import { owner } from '../services/owner.service.js'
import { readSession, SESSION_COOKIE } from '../services/session.service.js'

export const DEFAULT_LOCAL_USER_ID = '00000000-0000-0000-0000-000000000001'

const DEVICE_CACHE_MS = 60_000
const deviceCache = new Map<string, { userId: string; deviceId: string; at: number }>()

export const hashDeviceToken = (token: string) => createHash('sha256').update(token).digest('hex')

// Revocation must take effect immediately, not after the cache expires.
export function forgetDevice(deviceId: string) {
  for (const [hash, entry] of deviceCache) if (entry.deviceId === deviceId) deviceCache.delete(hash)
}

async function deviceUser(token: string) {
  const hash = hashDeviceToken(token)
  const cached = deviceCache.get(hash)
  if (cached && Date.now() - cached.at < DEVICE_CACHE_MS) return cached.userId
  deviceCache.delete(hash)
  const { data, error } = await supabase.from('remote_devices').select('id, user_id').eq('token_hash', hash).maybeSingle()
  if (error) throw error
  if (!data?.user_id) return null
  deviceCache.set(hash, { userId: data.user_id, deviceId: data.id, at: Date.now() })
  void supabase.from('remote_devices').update({ last_seen_at: new Date().toISOString() }).eq('id', data.id)
  return data.user_id as string
}

// Two ways in: a paired phone's device token, or the owner's signed session
// cookie (issued after the passphrase or a passkey). Everything else is 401.
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.get('authorization')
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null
    const deviceToken = req.get('x-muse-device-token') || bearerToken

    if (deviceToken?.startsWith('muse_dev_')) {
      const userId = await deviceUser(deviceToken)
      if (!userId) return res.status(401).json({ error: 'This device is no longer paired. Pair it again from Muse desktop.', code: 'device_revoked' })
      req.userId = userId
      req.userEmail = 'remote-device@muse.local'
      req.authMethod = 'device'
      return next()
    }

    await owner.ready()
    const claims = readSession(req.cookies?.[SESSION_COOKIE])
    if (!claims) return res.status(401).json({ error: 'Unlock Muse to continue.', code: 'auth_required' })
    req.userId = claims.sub
    req.userEmail = claims.email || 'local@muse.local'
    req.authMethod = 'session'
    next()
  } catch (error) { next(error) }
}
