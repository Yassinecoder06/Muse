import express from 'express'
import cors from 'cors'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { ZodError } from 'zod'
import { env } from './utils/env.js'
import { ensureCollection } from './qdrant/client.js'
import { router } from './routes/index.js'
import { startAiWorker } from './services/ai-job.service.js'
import { requireAuth } from './middleware/auth.js'
const app = express()
const uploadsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../uploads')
const imageTypes = new Map([
  ['image/jpeg', '.jpg'], ['image/png', '.png'], ['image/gif', '.gif'], ['image/webp', '.webp'], ['image/avif', '.avif']
])
await mkdir(uploadsDirectory, { recursive: true })
app.use(cors({ origin: 'http://localhost:5173' })); app.use(express.json({ limit: '2mb' }))
app.get('/health', (_req, res) => res.json({ ok: true }))
app.post('/api/uploads', requireAuth, express.raw({ type: 'image/*', limit: '5mb' }), async (req, res, next) => {
  try {
    const extension = imageTypes.get(req.headers['content-type']?.split(';')[0].toLowerCase() || '')
    if (!extension || !Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Choose a JPEG, PNG, GIF, WebP, or AVIF image up to 5 MB.' })
    const name = `${randomUUID()}${extension}`
    const userDirectory = resolve(uploadsDirectory, req.userId!)
    await mkdir(userDirectory, { recursive: true })
    await writeFile(resolve(userDirectory, name), req.body)
    res.status(201).json({ url: `${req.protocol}://${req.get('host')}/uploads/${req.userId}/${name}` })
  } catch (error) { next(error) }
})
app.use('/uploads', express.static(uploadsDirectory))
app.use('/api', router)
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { console.error(error); if (error instanceof ZodError) return res.status(400).json({ error: 'Invalid request', details: error.flatten() }); res.status(500).json({ error: error instanceof Error ? error.message : 'Unexpected server error' }) })
ensureCollection().catch(error => console.error('Qdrant connection unavailable at startup', error))
startAiWorker()
app.listen(env.PORT, () => console.log(`Muse API listening on http://localhost:${env.PORT}`))
