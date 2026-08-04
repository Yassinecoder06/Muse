import type { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { jobs } from '../services/ai-job.service.js'

const job = z.object({ noteId: z.string().uuid(), type: z.enum(['summary', 'tasks', 'title', 'tags', 'rewrite']), mode: z.string().optional() })
const user = (req: Request) => req.userId!
export async function enqueue(req: Request, res: Response, next: NextFunction) { try { const body = job.parse(req.body); res.status(202).json(await jobs.enqueue(user(req), body.noteId, body.type, { mode: body.mode })) } catch (error) { next(error) } }
export async function getJob(req: Request, res: Response, next: NextFunction) { try { res.json(await jobs.get(user(req), z.string().uuid().parse(req.params.id))) } catch (error) { next(error) } }
export async function askNote(req: Request, res: Response, next: NextFunction) { try { const body = z.object({ noteId: z.string().uuid(), question: z.string().min(1).max(2000) }).parse(req.body); res.status(202).json(await jobs.enqueue(user(req), body.noteId, 'ask_note', { question: body.question })) } catch (error) { next(error) } }
export async function askSearch(req: Request, res: Response, next: NextFunction) { try { const { question } = z.object({ question: z.string().min(1).max(2000) }).parse(req.body); res.status(202).json(await jobs.enqueue(user(req), null, 'ask_search', { question })) } catch (error) { next(error) } }
