import type { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { jobs } from '../services/ai-job.service.js'
import { AI_KEY_REQUIRED, fetchAccountUsage, listModels as getModels } from '../services/ai.service.js'
import { settings } from '../services/settings.repository.js'
import { supabase } from '../supabase/client.js'
import { researchArtifacts, researchDocuments } from '../services/research-document.repository.js'
import { extractResearchDocument } from '../services/research-document.service.js'
import { notes } from '../services/note.repository.js'
import { exports as reportExports } from '../services/reporting/export.service.js'

const model = z.string().min(1).max(100).optional()
const reportType = z.enum(['business', 'technical', 'financial', 'research', 'management', 'project']).optional()
const outputFormat = z.enum(['html', 'pdf', 'docx']).optional()
const skill = z.enum(['research','information_extraction','data_analysis','critical_reasoning','financial_analysis','recommendation','visualization','report_structure','professional_writing','citation_management','quality_control'])
const job = z.object({ noteId: z.string().uuid().optional(), type: z.enum(['summary', 'tasks', 'title', 'tags', 'rewrite', 'research']), mode: z.string().optional(), topic: z.string().min(1).max(500).optional(), title: z.string().max(300).optional(), objective: z.string().max(2000).optional(), audience: z.string().max(300).optional(), instructions: z.string().max(4000).optional(), reportType, outputFormat, enabledSkills: z.array(skill).min(1).max(11).optional(), depth: z.enum(['concise', 'standard', 'in-depth']).optional(), documentIds: z.array(z.string().uuid()).max(5).optional(), model })
const history = z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().min(1).max(4000) })).max(6).optional()
const user = (req: Request) => req.userId!
async function requireKey(userId: string) { if (!(await settings.hasKey(userId))) { const error = new Error(AI_KEY_REQUIRED); (error as any).statusCode = 400; throw error } }
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
export async function listModels(_req: Request, res: Response, next: NextFunction) { try { res.json(getModels()) } catch (error) { next(error) } }
export async function askNote(req: Request, res: Response, next: NextFunction) { try { const body = z.object({ noteId: z.string().uuid(), question: z.string().min(1).max(2000), history, model }).parse(req.body); await requireKey(user(req)); res.status(202).json(await jobs.enqueue(user(req), body.noteId, 'ask_note', { question: body.question, history: body.history, model: body.model })) } catch (error) { next(error) } }
export async function askSearch(req: Request, res: Response, next: NextFunction) { try { const { question, history: turns, model: chatModel } = z.object({ question: z.string().min(1).max(2000), history, model }).parse(req.body); await requireKey(user(req)); res.status(202).json(await jobs.enqueue(user(req), null, 'ask_search', { question, history: turns, model: chatModel })) } catch (error) { next(error) } }
export async function usage(_req: Request, res: Response, next: NextFunction) {
  try {
    const key = await settings.getKey(user(_req))
    if (!key) { res.json({ configured: false }); return }
    res.json({ configured: true, ...(await fetchAccountUsage(key)) })
  } catch (error) { next(error) }
}
