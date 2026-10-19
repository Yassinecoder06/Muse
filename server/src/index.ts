import dns from 'node:dns'
import { setGlobalDispatcher, Agent } from 'undici'

dns.setDefaultResultOrder('ipv4first')
setGlobalDispatcher(new Agent({ connect: { autoSelectFamily: false } }))

import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ZodError, z } from 'zod'
import { env, webauthn } from './utils/env.js'
import { ensureCollection } from './qdrant/client.js'
import { supabase } from './supabase/client.js'
import { router } from './routes/index.js'
import { startAiWorker } from './services/ai-job.service.js'
import { requireAuth } from './middleware/auth.js'
import { owner } from './services/owner.service.js'
const app = express()
const uploadsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../uploads')
const imageTypes = new Map([
  ['image/jpeg', '.jpg'], ['image/png', '.png'], ['image/gif', '.gif'], ['image/webp', '.webp'], ['image/avif', '.avif']
])
const mimeByExtension = new Map([['.jpg', 'image/jpeg'], ['.png', 'image/png'], ['.gif', 'image/gif'], ['.webp', 'image/webp'], ['.avif', 'image/avif']])
await mkdir(uploadsDirectory, { recursive: true })
const allowedOrigins = [...new Set([...webauthn.origins, ...(process.env.NODE_ENV === 'production' ? [] : ['http://localhost:5174', 'http://127.0.0.1:5174'])])]
// Encrypted attachments are base64 wrapped before they reach the vault. Keep
// this below a deliberately bounded limit, but high enough for the existing
// 5 MB attachment ceiling during the additive legacy migration.
app.use(cors({ origin: allowedOrigins, credentials: true })); app.use(cookieParser()); app.use(express.json({ limit: '12mb' }))
// Exactly one proxy (nginx) sits in front of Express; trusting more lets
// clients spoof X-Forwarded-For and dodge the IP-keyed rate limits.
app.set('trust proxy', 1)
app.get('/health', (_req, res) => res.json({ ok: true }))
app.post('/api/uploads', requireAuth, express.raw({ type: 'image/*', limit: '5mb' }), async (req, res, next) => {
  try {
    const extension = imageTypes.get(req.headers['content-type']?.split(';')[0].toLowerCase() || '')
    if (!extension || !Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Choose a JPEG, PNG, GIF, WebP, or AVIF image up to 5 MB.' })
    let noteId: string | null = null
    if (typeof req.query.noteId === 'string' && z.string().uuid().safeParse(req.query.noteId).success) {
      const { data, error } = await supabase.from('notes').select('id').eq('id', req.query.noteId).eq('user_id', req.userId).maybeSingle()
      if (error) throw error
      if (!data) return res.status(404).json({ error: 'Note not found.' })
      noteId = req.query.noteId
    }
    const { data, error } = await supabase.from('images').insert({ user_id: req.userId, note_id: noteId, mime: mimeByExtension.get(extension), size: req.body.length, data: req.body.toString('base64') }).select('id').single()
    if (error) throw error
    res.status(201).json({ url: `/api/images/${data.id}` })
  } catch (error) { next(error) }
})
app.get('/api/images/:id', requireAuth, async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id)
    const { data, error } = await supabase.from('images').select('mime, data').eq('id', id).eq('user_id', req.userId).single()
    if (error || !data) return res.status(404).json({ error: 'Image not found.' })
    res.setHeader('Content-Type', data.mime)
    res.setHeader('Cache-Control', 'private, max-age=86400')
    res.send(Buffer.from(data.data, 'base64'))
  } catch (error) { next(error) }
})
// Legacy disk uploads are user content too.
app.use('/uploads', requireAuth, express.static(uploadsDirectory))
app.use('/api', router)
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error)
  if (error instanceof ZodError) return res.status(400).json({ error: 'Invalid request', details: error.flatten() })
  const status = typeof (error as any)?.statusCode === 'number' ? (error as any).statusCode : 500
  // PostgREST errors carry table/column/constraint details; log them, don't send them.
  const isDatabaseError = typeof (error as any)?.code === 'string' && 'details' in (error as any) && 'hint' in (error as any)
  if (isDatabaseError) return res.status((error as any).code === 'PGRST116' ? 404 : 500).json({ error: (error as any).code === 'PGRST116' ? 'Not found.' : 'Muse could not complete this request.' })
  let msg = error instanceof Error ? error.message : 'Unexpected server error'
  if (typeof msg === 'string' && msg.startsWith('{') && msg.includes('"error"')) {
    try {
      const parsed = JSON.parse(msg)
      if (parsed.error?.code === 429 || parsed.error?.status === 'RESOURCE_EXHAUSTED') {
        msg = 'AI daily quota has been reached. Please switch models in Settings or try again later.'
      } else if (parsed.error?.message) {
        msg = parsed.error.message
      }
    } catch {}
  }
  res.status(status).json({ error: msg })
})
try { await owner.init() } catch (error) {
  console.error('Could not read the Muse owner record. Apply supabase/migrations/015_security_hardening.sql, then restart.', error)
  process.exit(1)
}
ensureCollection().catch(error => console.error('Qdrant connection unavailable at startup', error))
startAiWorker()
app.listen(env.PORT, () => console.log(`Muse API listening on http://localhost:${env.PORT}`))
