import type { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { notes } from '../services/note.repository.js'
import { jobs } from '../services/ai-job.service.js'
import { vectors } from '../services/vector.service.js'

const noteSchema = z.object({ title: z.string().max(300).optional(), content: z.string().max(100000).optional(), favorite: z.boolean().optional(), archived: z.boolean().optional(), tags: z.array(z.string().max(50)).max(6).optional() })
const id = (value: unknown) => z.string().uuid().parse(value)
const user = (req: Request) => req.userId!
export async function listNotes(req: Request, res: Response, next: NextFunction) { try { res.json(await notes.list(user(req), z.enum(['all', 'favorites', 'archive', 'trash']).catch('all').parse(req.query.scope))) } catch (error) { next(error) } }
export async function getNote(req: Request, res: Response, next: NextFunction) { try { res.json(await notes.get(user(req), id(req.params.id))) } catch (error) { next(error) } }
export async function createNote(req: Request, res: Response, next: NextFunction) { try { res.status(201).json(await notes.create(user(req), noteSchema.parse(req.body))) } catch (error) { next(error) } }
export async function updateNote(req: Request, res: Response, next: NextFunction) { try { res.json(await notes.update(user(req), id(req.params.id), noteSchema.parse(req.body))) } catch (error) { next(error) } }
export async function organizeNote(req: Request, res: Response, next: NextFunction) { try { const job = await jobs.enqueue(user(req), id(req.params.id), 'organize'); res.status(202).json(job) } catch (error) { next(error) } }
export async function deleteNote(req: Request, res: Response, next: NextFunction) { try { await notes.trash(user(req), id(req.params.id)); res.status(204).end() } catch (error) { next(error) } }
export async function restoreNote(req: Request, res: Response, next: NextFunction) { try { res.json(await notes.restore(user(req), id(req.params.id))) } catch (error) { next(error) } }
export async function deleteNotePermanently(req: Request, res: Response, next: NextFunction) { try { const noteId = id(req.params.id); await notes.deletePermanently(user(req), noteId); void vectors.deleteVector(noteId); res.status(204).end() } catch (error) { next(error) } }
export async function clearSummary(req: Request, res: Response, next: NextFunction) { try { res.json(await notes.setGenerated(user(req), id(req.params.id), { summary: null })) } catch (error) { next(error) } }
export async function clearTasks(req: Request, res: Response, next: NextFunction) { try { const noteId = id(req.params.id); await notes.replaceTasks(user(req), noteId, []); res.json(await notes.get(user(req), noteId)) } catch (error) { next(error) } }
export async function updateTask(req: Request, res: Response, next: NextFunction) { try { res.json(await notes.setTask(user(req), id(req.params.taskId), z.object({ completed: z.boolean() }).parse(req.body).completed)) } catch (error) { next(error) } }
