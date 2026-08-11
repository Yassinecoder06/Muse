import type { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { jobs } from '../services/ai-job.service.js'
import { AI_KEY_REQUIRED, fetchAccountUsage, listModels as getModels } from '../services/ai.service.js'
import { settings } from '../services/settings.repository.js'

const model = z.string().min(1).max(100).optional()
const job = z.object({ noteId: z.string().uuid().optional(), type: z.enum(['summary', 'tasks', 'title', 'tags', 'rewrite', 'research']), mode: z.string().optional(), topic: z.string().min(1).max(500).optional(), depth: z.enum(['concise', 'standard', 'in-depth']).optional(), model })
const history = z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().min(1).max(4000) })).max(6).optional()
const user = (req: Request) => req.userId!
async function requireKey(userId: string) { if (!(await settings.hasKey(userId))) { const error = new Error(AI_KEY_REQUIRED); (error as any).statusCode = 400; throw error } }
export async function enqueue(req: Request, res: Response, next: NextFunction) {
  try {
    const body = job.parse(req.body)
    await requireKey(user(req))
    res.status(202).json(await jobs.enqueue(user(req), body.noteId ?? null, body.type, { mode: body.mode, topic: body.topic, depth: body.depth, model: body.model }))
  } catch (error) { next(error) }
}
export async function getJob(req: Request, res: Response, next: NextFunction) { try { res.json(await jobs.get(user(req), z.string().uuid().parse(req.params.id))) } catch (error) { next(error) } }
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