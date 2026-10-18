import { Router } from 'express'
import express from 'express'
import * as notes from '../controllers/notes.controller.js'
import * as ai from '../controllers/ai.controller.js'
import * as settings from '../controllers/settings.controller.js'
import * as vault from '../controllers/vault.controller.js'
import * as calendar from '../controllers/calendar.controller.js'
import * as tasks from '../controllers/tasks.controller.js'
import * as detection from '../controllers/detection.controller.js'
import * as chat from '../controllers/chat.controller.js'
import * as voice from '../controllers/voice.controller.js'
import * as remote from '../controllers/remote.controller.js'
import { requireAuth } from '../middleware/auth.js'
import { graph } from '../services/graph.service.js'

export const router = Router()

// Passkey endpoints retained for backward compatibility (no-op / open in local mode)
router.post('/auth/passkeys/authentication/options', vault.authenticationOptions)
router.post('/auth/passkeys/authentication/verify', vault.verifyAuthentication)
router.delete('/auth/session', vault.logout)

router.use(requireAuth)

// Session & Vault
router.post('/auth/session', vault.createFallbackSession)
router.get('/auth/session', vault.sessionStatus)
router.get('/vault', vault.vaultStatus).put('/vault', vault.setupVault)
router.get('/vault/records', vault.listVaultRecords).post('/vault/records', vault.upsertVaultRecords)
router.post('/vault/migration', vault.setMigrationStatus)
router.get('/vault/legacy-export', vault.legacyExport)
router.get('/auth/passkeys', vault.listPasskeys)
router.post('/auth/passkeys/registration/options', vault.registrationOptions)
router.post('/auth/passkeys/registration/verify', vault.verifyRegistration)
router.delete('/auth/passkeys/:id', vault.revokePasskey)

// Graph & Notes
router.get('/graph', async (req, res, next) => { try { res.json(await graph(req.userId!)) } catch (error) { next(error) } })
router.delete('/notes/bulk', notes.bulkDeleteNotes).post('/notes/bulk-restore', notes.bulkRestoreNotes).post('/notes/bulk-trash', notes.bulkTrashNotes)
router.delete('/notes/trash', notes.emptyTrash)
router.get('/notes', notes.listNotes).post('/notes', notes.createNote)
router.get('/notes/:id', notes.getNote).put('/notes/:id', notes.updateNote).delete('/notes/:id', notes.deleteNote)
router.post('/notes/:id/restore', notes.restoreNote).delete('/notes/:id/permanent', notes.deleteNotePermanently)
router.delete('/notes/:id/summary', notes.clearSummary).delete('/notes/:id/tasks', notes.clearTasks)
router.post('/notes/:id/organize', notes.organizeNote)

// Calendar routes
router.get('/calendar/events', calendar.listEvents)
router.post('/calendar/events', calendar.createEvent)
router.post('/calendar/events/quick-add', calendar.quickAddEvent)
router.put('/calendar/events/:id', calendar.updateEvent)
router.delete('/calendar/events/:id', calendar.deleteEvent)

// Tasks routes (standalone + scheduled by day)
router.get('/tasks', tasks.listTasks)
router.post('/tasks', tasks.createTask)
router.patch('/tasks/:id', tasks.updateTask)
router.delete('/tasks/:id', tasks.deleteTask)

// Smart note schedule & task detection
router.post('/notes/:id/detect', detection.detectFromNote)
router.post('/notes/detect', detection.detectFromNote)
router.post('/notes/:id/apply-detections', detection.applyDetections)
router.post('/notes/apply-detections', detection.applyDetections)

// Research & AI
router.post('/research/documents', express.raw({ type: () => true, limit: '10mb' }), ai.uploadResearchDocument)
router.get('/reports/:noteId/export', ai.exportReport)
router.post('/ai/stream', ai.secureStream)
router.post('/ai/jobs', ai.enqueue).get('/ai/jobs/:id', ai.getJob).get('/ai/jobs/:id/artifacts', ai.getArtifacts).get('/ai/active', ai.active).get('/models', ai.listModels).get('/ai/usage', ai.usage)
router.post('/chat/note', ai.askNote).post('/chat/search', ai.askSearch)
router.get('/settings', settings.getSettings).put('/settings', settings.saveApiKey).delete('/settings', settings.deleteApiKey)

// Chat Sessions & Bip Agent
router.get('/chat/sessions', chat.listSessions)
router.post('/chat/sessions', chat.createSession)
router.get('/chat/sessions/:id', chat.getSession)
router.patch('/chat/sessions/:id', chat.updateSession)
router.delete('/chat/sessions/:id', chat.deleteSession)
router.post('/chat/sessions/:id/messages', chat.sendMessage)
router.patch('/chat/messages/:id', chat.updateMessage)
router.delete('/chat/messages/:id', chat.deleteMessage)

// Voice Transcribe Fallback
router.post('/voice/transcribe', express.raw({ type: () => true, limit: '15mb' }), voice.transcribeAudio)

// Memories
router.get('/chat/memories', chat.listMemories)
router.post('/chat/memories', chat.createMemory)
router.delete('/chat/memories/:id', chat.deleteMemory)

// Remote Mobile Companion
router.get('/remote/network-info', remote.getNetworkInfo)
router.post('/remote/pairing/create', remote.createPairingSession)
router.post('/remote/pairing/claim', remote.claimPairingSession)
router.get('/remote/pairing/status', remote.checkPairingStatus)
router.get('/remote/devices', remote.listDevices)
router.delete('/remote/devices/:id', remote.revokeDevice)

