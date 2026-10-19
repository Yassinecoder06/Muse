import type { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { jobs } from '../services/ai-job.service.js'
import { AI_KEY_REQUIRED, ai, fetchAccountUsage, listModels as getModels, OLLAMA_LOCAL_URL, isCloudModel, isGeminiModel } from '../services/ai.service.js'
import { settings } from '../services/settings.repository.js'
import { supabase } from '../supabase/client.js'
import { researchArtifacts, researchDocuments } from '../services/research-document.repository.js'
import { extractResearchDocument } from '../services/research-document.service.js'
import { notes } from '../services/note.repository.js'
import { exports as reportExports } from '../services/reporting/export.service.js'
import { stripImages } from '../utils/images.js'

const model = z.string().min(1).max(100).optional()
const reportType = z.enum(['business', 'technical', 'financial', 'research', 'management', 'project']).optional()
const outputFormat = z.enum(['html', 'pdf', 'docx']).optional()
const skill = z.enum(['research','information_extraction','data_analysis','critical_reasoning','financial_analysis','recommendation','visualization','report_structure','professional_writing','citation_management','quality_control'])
const job = z.object({ noteId: z.string().uuid().optional(), type: z.enum(['summary', 'tasks', 'title', 'tags', 'rewrite', 'research']), mode: z.string().optional(), topic: z.string().min(1).max(500).optional(), title: z.string().max(300).optional(), objective: z.string().max(2000).optional(), audience: z.string().max(300).optional(), instructions: z.string().max(4000).optional(), reportType, outputFormat, enabledSkills: z.array(skill).min(1).max(11).optional(), depth: z.enum(['concise', 'standard', 'in-depth']).optional(), documentIds: z.array(z.string().uuid()).max(5).optional(), model })
const history = z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().min(1).max(4000) })).max(6).optional()
const secureAction = z.enum(['summary', 'tasks', 'title', 'tags', 'rewrite', 'organize'])
const secureRun = z.object({
  action: secureAction,
  mode: z.enum(['improve', 'professional', 'friendly', 'shorter', 'longer', 'grammar']).optional(),
  note: z.object({ title: z.string().max(500), content: z.string().min(1).max(250_000), specialized: z.object({ category: z.string().max(40), aiInstruction: z.string().max(2000).optional() }).optional() }),
  model
})
const user = (req: Request) => req.userId!
async function requireKey(userId: string) {
  if (await settings.hasGeminiKey(userId)) return
  if (await settings.hasKey(userId)) return
  try {
    const res = await fetch(`${OLLAMA_LOCAL_URL}/api/tags`, { method: 'GET' })
    if (res.ok) return
  } catch {}
  const error = new Error('No Gemini or Ollama API key configured in Settings, and no local Ollama found on port 11434.')
  ;(error as any).statusCode = 400
  throw error
}
export async function enqueue(req: Request, res: Response, next: NextFunction) {
  try {
    const body = job.parse(req.body)
    await requireKey(user(req))
    res.status(202).json(await jobs.enqueue(user(req), body.noteId ?? null, body.type, body))
  } catch (error) { next(error) }
}
export async function getJob(req: Request, res: Response, next: NextFunction) { try { res.json(await jobs.get(user(req), z.string().uuid().parse(req.params.id))) } catch (error) { next(error) } }
export async function getArtifacts(req: Request, res: Response, next: NextFunction) {
  try {
    const jobId = z.string().uuid().parse(req.params.id)
    await jobs.get(user(req), jobId)
    res.json(await researchArtifacts.list(jobId, user(req)))
  } catch (error) { next(error) }
}
export async function exportReport(req: Request, res: Response, next: NextFunction) {
  try {
    const note = await notes.get(user(req), z.string().uuid().parse(req.params.noteId))
    if (note.kind !== 'research') { res.status(400).json({ error: 'Only research reports can be exported.' }); return }
    const format = z.enum(['html', 'pdf', 'docx']).parse(req.query.format || 'html'); const name = (note.title || 'muse-report').replace(/[^a-z0-9-_]+/gi, '-').slice(0, 80)
    if (format === 'html') { res.type('html').attachment(`${name}.html`).send(reportExports.html(note.title, note.content)); return }
    if (format === 'docx') { res.type('application/vnd.openxmlformats-officedocument.wordprocessingml.document').attachment(`${name}.docx`).send(await reportExports.docx(note.title, note.content)); return }
    res.type('application/pdf').attachment(`${name}.pdf`); reportExports.pdf(note.title, note.content).pipe(res)
  } catch (error) { next(error) }
}
export async function uploadResearchDocument(req: Request, res: Response, next: NextFunction) {
  try {
    const header = req.get('x-research-filename') || ''
    let filename = header
    try { filename = decodeURIComponent(header) } catch { /* use the literal header */ }
    const document = await extractResearchDocument(filename, req.get('content-type'), Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0))
    const saved = await researchDocuments.create(user(req), document)
    res.status(201).json({ id: saved.id, filename: saved.filename, mime: saved.mime, size: saved.size, created_at: saved.created_at })
  } catch (error) { next(error) }
}
export async function active(req: Request, res: Response, next: NextFunction) { try { const job = await jobs.active(user(req)); res.json(job ? { running: true, type: job.type } : { running: false }) } catch (error) { next(error) } }

// A foreground SSE route for client-encrypted notes. Decrypted content exists
// only in the request/response lifetime: it is never put in ai_jobs, report
// tables, logs, or the vector index. Closing the tab aborts the HTTP request.
export async function secureStream(req: Request, res: Response, next: NextFunction) {
  try {
    const body = secureRun.parse(req.body)
    const { geminiKey, ollamaKey } = await settings.getEffectiveAiKeys(user(req))
    if (!geminiKey && !ollamaKey) {
      try {
        const res = await fetch(`${OLLAMA_LOCAL_URL}/api/tags`, { method: 'GET' })
        if (!res.ok) throw new Error()
      } catch {
        res.status(400).json({ error: AI_KEY_REQUIRED }); return
      }
    }
    const keyContext = { geminiKey, ollamaKey, userId: user(req) }
    res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
    res.flushHeaders()
    // Closing the tab ends the request; stop before starting the next model
    // call instead of finishing work nobody will receive.
    let clientGone = false
    res.on('close', () => { if (!res.writableEnded) clientGone = true })
    const stillWanted = () => { if (clientGone) throw Object.assign(new Error('Client disconnected.'), { clientGone: true }) }
    const emit = (event: 'progress' | 'result' | 'error', value: unknown) => { stillWanted(); res.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`) }
    const source = stripImages(body.note.content)
    const specialty = body.note.specialized?.aiInstruction ? ` Follow this specialized-note instruction: ${body.note.specialized.aiInstruction}` : ''
    const patch: Record<string, unknown> = {}
    emit('progress', { message: 'Muse is thinking' })
    if (body.action === 'summary') { patch.summary = await ai.summarize(`${source}${specialty}`, body.model, keyContext) }
    else if (body.action === 'tasks') { patch.tasks = await ai.extractTasks(`${source}${specialty}`, body.model, keyContext) }
    else if (body.action === 'title') { patch.title = await ai.generateTitle(`${source}${specialty}`, body.model, keyContext) }
    else if (body.action === 'tags') { patch.tags = await ai.generateTags(`${source}${specialty}`, body.model, keyContext) }
    else if (body.action === 'rewrite') {
      if (!body.mode) throw new Error('Choose a rewrite mode.')
      // The browser replaces image tags with [IMAGE n] markers before this
      // request and restores them after the stream. This keeps both inline
      // attachment bytes and their URLs out of the AI request.
      patch.content = await ai.rewrite(body.note.content, body.mode, body.model, keyContext)
    } else {
      emit('progress', { message: 'Creating a title' })
      patch.title = body.note.title.trim() || await ai.generateTitle(`${source}${specialty}`, body.model, keyContext)
      stillWanted()
      emit('progress', { message: 'Finding key themes' })
      patch.tags = await ai.generateTags(`${source}${specialty}`, body.model, keyContext)
      emit('progress', { message: 'Writing a summary' })
      patch.summary = await ai.summarize(`${source}${specialty}`, body.model, keyContext)
    }
    emit('result', { patch })
    res.end()
  } catch (error) {
    if ((error as { clientGone?: boolean })?.clientGone) return
    if (res.headersSent) { res.write(`event: error\ndata: ${JSON.stringify({ error: error instanceof Error ? error.message : 'Muse could not complete this request.' })}\n\n`); res.end(); return }
    next(error)
  }
}
export async function listModels(_req: Request, res: Response, next: NextFunction) { try { res.json(await getModels()) } catch (error) { next(error) } }
export async function askNote(req: Request, res: Response, next: NextFunction) { try { const body = z.object({ noteId: z.string().uuid(), question: z.string().min(1).max(2000), history, model }).parse(req.body); await requireKey(user(req)); res.status(202).json(await jobs.enqueue(user(req), body.noteId, 'ask_note', { question: body.question, history: body.history, model: body.model })) } catch (error) { next(error) } }
export async function askSearch(req: Request, res: Response, next: NextFunction) { try { const { question, history: turns, model: chatModel } = z.object({ question: z.string().min(1).max(2000), history, model }).parse(req.body); await requireKey(user(req)); res.status(202).json(await jobs.enqueue(user(req), null, 'ask_search', { question, history: turns, model: chatModel })) } catch (error) { next(error) } }
export async function usage(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = user(req)
    const [geminiKey, ollamaKey] = await Promise.all([
      settings.getGeminiKey(userId),
      settings.getKey(userId)
    ])

    const requestedModel = typeof req.query.model === 'string' ? req.query.model : undefined
    const requestedProvider = typeof req.query.provider === 'string' ? req.query.provider : undefined

    let targetProvider: 'gemini' | 'ollama'
    if (requestedProvider === 'ollama') {
      targetProvider = 'ollama'
    } else if (requestedProvider === 'gemini') {
      targetProvider = 'gemini'
    } else if (requestedModel) {
      if (isGeminiModel(requestedModel)) {
        targetProvider = 'gemini'
      } else if (isCloudModel(requestedModel) || requestedModel.includes('ollama')) {
        targetProvider = 'ollama'
      } else {
        targetProvider = geminiKey ? 'gemini' : (ollamaKey ? 'ollama' : 'gemini')
      }
    } else {
      targetProvider = geminiKey ? 'gemini' : (ollamaKey ? 'ollama' : 'gemini')
    }

    if (targetProvider === 'ollama') {
      if (!ollamaKey) {
        res.json({ configured: false, provider: 'ollama' })
        return
      }
      res.json({ configured: true, provider: 'ollama', ...(await fetchAccountUsage(ollamaKey)) })
      return
    }

    if (!geminiKey) {
      if (ollamaKey && !requestedProvider && !requestedModel) {
        res.json({ configured: true, provider: 'ollama', ...(await fetchAccountUsage(ollamaKey)) })
        return
      }
      res.json({ configured: false, provider: 'gemini' })
      return
    }

    const dailyStats = await settings.getAiDailyUsage(userId, 'gemini')
    const dailyLimit = dailyStats.dailyLimit || 1500
    const requestsToday = dailyStats.requestsToday || 0
    const usedPct = Math.min(100, Math.round((requestsToday / dailyLimit) * 1000) / 10)
    const totalTokens = dailyStats.totalTokens || 0
    const tokenPct = Math.min(100, Math.round((totalTokens / 1_000_000) * 1000) / 10)

    res.json({
      configured: true,
      provider: 'gemini',
      plan: 'Google AI Studio · Free Tier',
      dailyLimit,
      requestsToday,
      totalTokens,
      session: {
        usedPct,
        models: (dailyStats.models || []).map(m => ({
          name: m.name,
          requests: m.requests,
          tokens: m.tokens
        }))
      },
      weekly: {
        usedPct: tokenPct,
        models: (dailyStats.models || []).map(m => ({
          name: m.name,
          requests: m.requests
        }))
      }
    })
  } catch (error) { next(error) }
}
