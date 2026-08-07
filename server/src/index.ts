import express from 'express'
import cors from 'cors'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ZodError, z } from 'zod'
import { env } from './utils/env.js'
import { ensureCollection } from './qdrant/client.js'
import { supabase, authClient } from './supabase/client.js'
import { router } from './routes/index.js'
import { startAiWorker } from './services/ai-job.service.js'
import { requireAuth } from './middleware/auth.js'
const app = express()
const uploadsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../uploads')
const imageTypes = new Map([
  ['image/jpeg', '.jpg'], ['image/png', '.png'], ['image/gif', '.gif'], ['image/webp', '.webp'], ['image/avif', '.avif']
])
const mimeByExtension = new Map([['.jpg', 'image/jpeg'], ['.png', 'image/png'], ['.gif', 'image/gif'], ['.webp', 'image/webp'], ['.avif', 'image/avif']])
await mkdir(uploadsDirectory, { recursive: true })
app.use(cors({ origin: 'http://localhost:5173' })); app.use(express.json({ limit: '2mb' }))
app.set('trust proxy', true)
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
app.get('/api/images/:id', async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id)
    const token = req.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1] || String(req.query.token || '')
    if (token) {
      const { error } = await authClient.auth.getUser(token)
      if (error) return res.status(401).json({ error: 'Your session is invalid or expired.' })
    }
    const { data, error } = await supabase.from('images').select('mime, data').eq('id', id).single()
    if (error || !data) return res.status(404).json({ error: 'Image not found.' })
    res.setHeader('Content-Type', data.mime)
    res.setHeader('Cache-Control', 'private, max-age=86400')
    res.send(Buffer.from(data.data, 'base64'))
  } catch (error) { next(error) }
})
app.use('/uploads', express.static(uploadsDirectory))
app.use('/api', router)
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { console.error(error); if (error instanceof ZodError) return res.status(400).json({ error: 'Invalid request', details: error.flatten() }); res.status(500).json({ error: error instanceof Error ? error.message : 'Unexpected server error' }) })
ensureCollection().catch(error => console.error('Qdrant connection unavailable at startup', error))
startAiWorker()
app.listen(env.PORT, () => console.log(`Muse API listening on http://localhost:${env.PORT}`))
