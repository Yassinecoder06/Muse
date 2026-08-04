import { Router } from 'express'
import * as notes from '../controllers/notes.controller.js'
import * as ai from '../controllers/ai.controller.js'
import { requireAuth } from '../middleware/auth.js'
export const router = Router()
router.use(requireAuth)
router.get('/notes', notes.listNotes).post('/notes', notes.createNote)
router.get('/notes/:id', notes.getNote).put('/notes/:id', notes.updateNote).delete('/notes/:id', notes.deleteNote)
router.post('/notes/:id/restore', notes.restoreNote).delete('/notes/:id/permanent', notes.deleteNotePermanently)
router.delete('/notes/:id/summary', notes.clearSummary).delete('/notes/:id/tasks', notes.clearTasks)
router.post('/notes/:id/organize', notes.organizeNote)
router.patch('/tasks/:taskId', notes.updateTask)
router.post('/ai/jobs', ai.enqueue).get('/ai/jobs/:id', ai.getJob)
router.post('/chat/note', ai.askNote).post('/chat/search', ai.askSearch)
