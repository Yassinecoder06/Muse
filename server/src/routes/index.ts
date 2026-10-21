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
import * as templates from '../controllers/templates.controller.js'
import * as providers from '../controllers/ai-providers.controller.js'
import * as ownerAuth from '../controllers/owner.controller.js'
import * as analytics from '../controllers/analytics.controller.js'
import * as music from '../controllers/music.controller.js'
import { requireAuth } from '../middleware/auth.js'
import { apiLimiter, loginLimiter, pairingLimiter } from '../middleware/rate-limit.js'
import { graph } from '../services/graph.service.js'

export const router = Router()

// Public: owner unlock, passkey sign-in, logout, claiming a pairing code, and music streaming
router.get('/auth/owner', ownerAuth.ownerStatus)
router.post('/auth/owner/setup', loginLimiter, ownerAuth.setupOwner)
router.post('/auth/owner/login', loginLimiter, ownerAuth.loginOwner)
router.post('/auth/passkeys/authentication/options', loginLimiter, vault.authenticationOptions)
router.post('/auth/passkeys/authentication/verify', loginLimiter, vault.verifyAuthentication)
router.delete('/auth/session', vault.logout)
router.post('/remote/pairing/claim', pairingLimiter, remote.claimPairingSession)
router.get('/music/stream/:filename', music.streamSong)
router.get('/music/songs', music.listSongs)
router.get('/music/cover/search', music.searchCoverArt)
router.get('/music/cover/:filename', music.getCoverArt)
router.post('/music/cover/:filename', music.saveCoverArt)

router.use(requireAuth)
router.use(apiLimiter)

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
router.get('/analytics/activity', analytics.activity)
router.get('/graph', async (req, res, next) => { try { res.json(await graph(req.userId!)) } catch (error) { next(error) } })
router.delete('/notes/bulk', notes.bulkDeleteNotes).post('/notes/bulk-restore', notes.bulkRestoreNotes).post('/notes/bulk-trash', notes.bulkTrashNotes)
router.delete('/notes/trash', notes.emptyTrash)
router.get('/notes/search', notes.searchNotes)
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
// Bring-your-own AI providers and per-job model choices
router.get('/ai/providers', providers.getProviders).post('/ai/providers', providers.createProvider)
router.post('/ai/providers/fetch', providers.fetchModels)
router.patch('/ai/providers/:id', providers.updateProvider).delete('/ai/providers/:id', providers.deleteProvider)
router.put('/ai/preferences', providers.savePreferences)
router.post('/ai/test', providers.testModel)
router.get('/ai/reindex', providers.reindexStatus)
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
router.post('/ai/chat', chat.directChat)
router.post('/agent/confirm', chat.confirmAgentAction)

// Voice Transcribe Fallback & Neural Speech Synthesis
router.post('/voice/transcribe', express.raw({ type: () => true, limit: '15mb' }), voice.transcribeAudio)
router.post('/voice/speak', voice.synthesizeSpeech)

// Memories
router.get('/chat/memories', chat.listMemories)
router.post('/chat/memories', chat.createMemory)
router.delete('/chat/memories/:id', chat.deleteMemory)

// Remote Mobile Companion
router.get('/remote/network-info', remote.getNetworkInfo)
router.post('/remote/pairing/create', remote.createPairingSession)
router.get('/remote/pairing/status', remote.checkPairingStatus)
router.get('/remote/devices', remote.listDevices)
router.delete('/remote/devices/:id', remote.revokeDevice)

// Specialized Templates
router.get('/templates', templates.listTemplates)
router.get('/templates/:id', templates.getTemplate)
router.post('/templates', templates.createTemplate)
router.put('/templates/:id', templates.updateTemplate)
router.delete('/templates/:id', templates.deleteTemplate)

// Music Downloader & Management
router.post('/music/download', music.downloadBatch)
router.get('/music/tasks', music.getTasks)
router.get('/music/tasks/:id', music.getTask)
router.delete('/music/tasks/:id', music.deleteTask)
router.get('/music/analytics', music.getAnalytics)
router.delete('/music/songs/:filename', music.deleteSong)
router.post('/music/songs/batch-delete', music.deleteSongsBatch)

// Music Playlists
router.get('/music/playlists', music.listPlaylists)
router.post('/music/playlists', music.createPlaylist)
router.get('/music/playlists/:id', music.getPlaylist)
router.put('/music/playlists/:id', music.updatePlaylist)
router.delete('/music/playlists/:id', music.deletePlaylist)


