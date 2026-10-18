import type { NextFunction, Request, Response } from 'express'
import { supabase } from '../supabase/client.js'

export const DEFAULT_LOCAL_USER_ID = '00000000-0000-0000-0000-000000000001'

const deviceCache = new Map<string, { userId: string; at: number }>()

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const authHeader = req.get('authorization')
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null
  const deviceToken = req.get('x-muse-device-token') || bearerToken

  if (deviceToken && deviceToken.startsWith('muse_dev_')) {
    const cached = deviceCache.get(deviceToken)
    if (cached && Date.now() - cached.at < 60_000) {
      req.userId = cached.userId
      req.userEmail = 'remote-device@muse.local'
      req.authMethod = 'device'
      return next()
    }

    try {
      const { data } = await supabase
        .from('remote_devices')
        .select('id, user_id')
        .eq('device_token', deviceToken)
        .single()

      if (data?.user_id) {
        deviceCache.set(deviceToken, { userId: data.user_id, at: Date.now() })
        req.userId = data.user_id
        req.userEmail = 'remote-device@muse.local'
        req.authMethod = 'device'
        void supabase.from('remote_devices').update({ last_seen_at: new Date().toISOString() }).eq('id', data.id)
        return next()
      }
    } catch {}
  }

  // Pure local-first mode fallback: zero login required. Never return 401.
  const headerUserId = req.get('x-muse-user-id')
  req.userId = headerUserId && /^[0-9a-f-]{36}$/i.test(headerUserId) ? headerUserId : DEFAULT_LOCAL_USER_ID
  req.userEmail = req.get('x-muse-user-email') || 'local@muse.local'
  req.authMethod = 'session'
  next()
}
