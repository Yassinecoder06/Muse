import type { Request, Response, NextFunction } from 'express'
import { randomBytes } from 'crypto'
import os from 'os'
import { z } from 'zod'
import { supabase } from '../supabase/client.js'
import { DEFAULT_LOCAL_USER_ID } from '../middleware/auth.js'

function detectNetworkIps() {
  const interfaces = os.networkInterfaces()
  let localIp = '127.0.0.1'
  let tailscaleIp: string | null = null

  for (const name of Object.keys(interfaces)) {
    const list = interfaces[name] || []
    for (const info of list) {
      if (info.family === 'IPv4' && !info.internal) {
        if (info.address.startsWith('100.')) {
          tailscaleIp = info.address
        } else if (
          info.address.startsWith('192.168.') ||
          info.address.startsWith('10.') ||
          info.address.startsWith('172.16.')
        ) {
          // Prefer physical LAN IP over docker bridge
          if (!localIp || localIp === '127.0.0.1' || name.startsWith('wlan') || name.startsWith('eth') || name.startsWith('en')) {
            localIp = info.address
          }
        }
      }
    }
  }

  // Fallback to detected LAN IP from host if inside container
  if (localIp === '127.0.0.1') {
    localIp = '192.168.100.136'
  }
  if (!tailscaleIp) {
    tailscaleIp = '100.84.254.110'
  }

  return { localIp, tailscaleIp }
}

export async function getNetworkInfo(req: Request, res: Response, next: NextFunction) {
  try {
    const { localIp, tailscaleIp } = detectNetworkIps()
    const requestHost = req.get('host') || 'localhost:8080'
    const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http'

    res.json({
      localIp,
      tailscaleIp,
      port: 8080,
      localUrl: `http://${localIp}:8080`,
      tailscaleUrl: tailscaleIp ? `http://${tailscaleIp}:8080` : null,
      currentOriginUrl: `${protocol}://${requestHost}`,
      hostname: os.hostname()
    })
  } catch (err) {
    next(err)
  }
}

export async function createPairingSession(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.userId || DEFAULT_LOCAL_USER_ID
    const body = z.object({
      serverUrl: z.string().optional()
    }).parse(req.body || {})

    const { localIp } = detectNetworkIps()
    const requestHost = req.get('host') || 'localhost:8080'
    const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http'

    const targetUrl = body.serverUrl?.trim() ||
      (!requestHost.includes('localhost') && !requestHost.includes('127.0.0.1')
        ? `${protocol}://${requestHost}`
        : `http://${localIp}:8080`)

    const token = `muse_pair_${randomBytes(16).toString('hex')}`
    const pinCode = String(Math.floor(100000 + Math.random() * 900000))
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString()

    const { error } = await supabase.from('pairing_tokens').insert({
      token,
      pin_code: pinCode,
      user_id: userId,
      server_url: targetUrl,
      expires_at: expiresAt
    })

    if (error) throw error

    // Compact payload for quick QR scanning by mobile camera
    const qrData = JSON.stringify({
      t: token,
      p: pinCode,
      u: targetUrl
    })

    res.json({
      token,
      pinCode,
      serverUrl: targetUrl,
      expiresAt,
      qrData
    })
  } catch (err) {
    next(err)
  }
}

export async function claimPairingSession(req: Request, res: Response, next: NextFunction) {
  try {
    const body = z.object({
      token: z.string().optional(),
      pinCode: z.string().optional(),
      pin: z.string().optional(),
      deviceName: z.string().min(1).max(100),
      deviceModel: z.string().optional(),
      platform: z.enum(['android', 'ios']).default('android')
    }).parse(req.body)

    const effectivePin = body.pinCode || body.pin

    if (!body.token && !effectivePin) {
      return res.status(400).json({ error: 'Either a pairing token or PIN code is required.' })
    }

    let query = supabase
      .from('pairing_tokens')
      .select('*')
      .gt('expires_at', new Date().toISOString())
      .is('claimed_at', null)

    if (body.token) {
      query = query.eq('token', body.token)
    } else if (effectivePin) {
      query = query.eq('pin_code', effectivePin)
    }

    const { data: tokenRow, error: findError } = await query.maybeSingle()

    if (findError || !tokenRow) {
      return res.status(400).json({ error: 'Invalid or expired pairing code. Please generate a new code on your desktop.' })
    }

    const deviceToken = `muse_dev_${randomBytes(24).toString('hex')}`
    const clientIp = req.ip || req.socket.remoteAddress || null

    const { data: newDevice, error: devError } = await supabase
      .from('remote_devices')
      .insert({
        user_id: tokenRow.user_id,
        device_name: body.deviceName.trim(),
        device_model: body.deviceModel?.trim() || null,
        platform: body.platform,
        device_token: deviceToken,
        last_ip: clientIp,
        last_seen_at: new Date().toISOString()
      })
      .select('id, device_name')
      .single()

    if (devError || !newDevice) {
      throw devError || new Error('Could not register device.')
    }

    // Mark pairing token as claimed
    await supabase
      .from('pairing_tokens')
      .update({
        claimed_at: new Date().toISOString(),
        claimed_by_device: newDevice.id
      })
      .eq('token', tokenRow.token)

    res.json({
      success: true,
      deviceId: newDevice.id,
      deviceToken,
      userId: tokenRow.user_id,
      serverUrl: tokenRow.server_url
    })
  } catch (err) {
    next(err)
  }
}

export async function checkPairingStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const token = typeof req.query.token === 'string' ? req.query.token : ''
    if (!token) return res.status(400).json({ error: 'Token query parameter required' })

    const { data: row } = await supabase
      .from('pairing_tokens')
      .select('claimed_at, claimed_by_device, remote_devices(device_name, device_model, platform)')
      .eq('token', token)
      .maybeSingle()

    if (!row) {
      return res.json({ claimed: false, expired: true })
    }

    if (row.claimed_at) {
      const dev = (row as any).remote_devices
      return res.json({
        claimed: true,
        device: {
          name: dev?.device_name || 'Mobile Phone',
          model: dev?.device_model || '',
          platform: dev?.platform || 'android'
        }
      })
    }

    res.json({ claimed: false })
  } catch (err) {
    next(err)
  }
}

export async function listDevices(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.userId || DEFAULT_LOCAL_USER_ID
    const { data: devices, error } = await supabase
      .from('remote_devices')
      .select('id, device_name, device_model, platform, last_seen_at, created_at')
      .eq('user_id', userId)
      .order('last_seen_at', { ascending: false })

    if (error) throw error
    res.json(devices || [])
  } catch (err) {
    next(err)
  }
}

export async function revokeDevice(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.userId || DEFAULT_LOCAL_USER_ID
    const { id } = req.params

    const { error } = await supabase
      .from('remote_devices')
      .delete()
      .eq('id', id)
      .eq('user_id', userId)

    if (error) throw error
    res.json({ success: true, revokedId: id })
  } catch (err) {
    next(err)
  }
}
