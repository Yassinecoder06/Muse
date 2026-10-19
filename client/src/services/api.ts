import { supabase } from './supabase'
import { chatModel } from './settings'
import type { AiJob, GraphData, Note, NoteInput, Task, CalendarEvent, DetectionResult, ChatSession, ChatMessage, UserMemory } from '../types'
import type { SpecializedCategory } from '../types'
import type { CustomTemplate } from './templates'
import { activeVaultUser, decryptNote, encryptNote, encryptRecord, newSecureNote } from './vault'
import type { VaultRecord, SecureNote } from './vault'
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser'

const root = import.meta.env.VITE_API_URL || '/api'
function apiOrigin() { return /^https?:\/\//.test(root) ? new URL(root).origin : window.location.origin }
export function resolveApiImageSrc(src: string) { return src.startsWith('/api/images/') ? `${apiOrigin()}${src}` : src }
export function relativizeApiImageSrc(src: string) {
  const origin = apiOrigin()
  return src.startsWith(`${origin}/api/images/`) ? src.slice(origin.length) : src
}

// App.tsx listens for this and shows the owner unlock screen.
export const AUTH_REQUIRED_EVENT = 'muse:auth-required'

async function failure(response: Response, fallback: string): Promise<never> {
  const body = await response.json().catch(() => ({}))
  if (response.status === 401 && body.code === 'auth_required') window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT))
  // Gateway errors come from nginx as HTML, so there is no JSON message.
  if (!body.error && (response.status === 502 || response.status === 503)) throw new Error('Muse server is not reachable right now. Is it running?')
  if (!body.error && response.status === 504) throw new Error('Muse took too long to answer (the AI models may be slow or out of quota). Please try again.')
  throw new Error(body.error || fallback)
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const userName = localStorage.getItem('muse-user-name') || 'Local User'
  const { data: { session } } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }))
  const response = await fetch(`${root}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Muse-User-Name': encodeURIComponent(userName),
      // Natural-language dates ("tomorrow at 8pm") resolve in this zone.
      'X-Muse-Timezone': Intl.DateTimeFormat().resolvedOptions().timeZone,
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      ...(options?.headers || {})
    }
  })
  if (!response.ok) await failure(response, 'Request failed')
  return response.status === 204 ? undefined as T : response.json()
}

async function publicRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${root}${path}`, { ...options, credentials: 'include', headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) } })
  if (!response.ok) await failure(response, 'Request failed')
  return response.status === 204 ? undefined as T : response.json()
}

function secureScope(items: Note[], scope: string) {
  if (scope === 'trash') return items.filter(note => !!note.deleted_at)
  const live = items.filter(note => !note.deleted_at)
  if (scope === 'favorites') return live.filter(note => note.favorite)
  if (scope === 'archive') return live.filter(note => note.archived)
  return live.filter(note => !note.archived)
}

async function listSecureNotes(scope = 'all') {
  const userId = activeVaultUser()!
  const records = await request<VaultRecord[]>('/vault/records?type=note')
  const notes = await Promise.all(records.map(record => decryptNote(userId, record)))
  return secureScope(notes, scope).sort((a, b) => b.updated_at.localeCompare(a.updated_at))
}

async function secureNote(id: string) {
  const found = (await request<VaultRecord[]>('/vault/records?type=note')).find(record => record.id === id)
  if (!found) throw new Error('Note not found.')
  return { note: await decryptNote(activeVaultUser()!, found), record: found }
}

async function persistSecureNote(note: SecureNote, revision = 1) {
  const wire = await encryptNote(activeVaultUser()!, { ...note, updated_at: new Date().toISOString() })
  wire.revision = revision
  await request<{ saved: number }>('/vault/records', { method: 'POST', body: JSON.stringify({ records: [wire] }) })
  return { ...note, updated_at: wire.updatedAt || new Date().toISOString() }
}

async function createSecureNote(input: NoteInput) {
  const note = newSecureNote({ ...input, kind: 'note' })
  return persistSecureNote(note)
}

const specializedDefaults: Record<SpecializedCategory, { title: string; fields: Record<string, unknown>; aiInstruction: string }> = {
  daily: { title: 'Daily plan', fields: { date: new Date().toISOString().slice(0, 10), feedback: '', wins: '', blockers: '', nextFocus: '' }, aiInstruction: 'Help plan tasks and provide concise daily feedback.' },
  workout: { title: 'Gym Workout', fields: { date: new Date().toISOString().slice(0, 10), time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }), name: 'Gym Workout', exerciseCount: '4' }, aiInstruction: 'Help structure workouts, track exercises, sets, and analyze progress without medical claims.' },
  finance: { title: 'Financial decision', fields: { date: new Date().toISOString().slice(0, 10), amount: '', currency: 'USD', category: '', merchant: '', decision: '', rationale: '', outcome: '' }, aiInstruction: 'Help categorize expenses and compare financial decisions; state assumptions clearly.' },
  custom: { title: 'Custom note', fields: { 'Field 1': '' }, aiInstruction: 'Follow this template’s fields and propose only supported updates.' }
}

async function createSpecializedSecureNote(category: SpecializedCategory, customTemplate?: { title?: string; fields?: Record<string, unknown>; aiInstruction?: string; color?: string; syncWithCalendar?: boolean }) {
  if (!activeVaultUser()) throw new Error('Unlock your Secure Vault before creating a specialized note.')
  const defaults = specializedDefaults[category]
  const title = customTemplate?.title || defaults.title
  const fields = customTemplate?.fields ? { ...customTemplate.fields } : { ...defaults.fields }
  const aiInstruction = customTemplate?.aiInstruction || defaults.aiInstruction
  const color = customTemplate?.color || 'blue'
  const note = newSecureNote({
    title,
    kind: 'specialized',
    specialized: {
      category,
      templateId: customTemplate?.title,
      fields,
      aiInstruction,
      color,
      syncWithCalendar: customTemplate?.syncWithCalendar
    }
  })
  return persistSecureNote(note)
}

async function updateSecureNote(id: string, input: NoteInput) {
  const { note, record } = await secureNote(id)
  return persistSecureNote({ ...note, ...input }, (record.revision || 1) + 1)
}

async function findSecureTask(id: string) {
  const notes = await listSecureNotes('all')
  for (const note of notes) { const task = note.tasks.find(item => item.id === id); if (task) return { note, task } }
  throw new Error('Task not found.')
}

async function secureGraph(): Promise<GraphData> {
  const notes = await listSecureNotes('all')
  const nodes: GraphData['nodes'] = notes.map(note => ({ id: note.id, title: note.title, kind: note.kind, tags: note.tags, updated_at: note.updated_at }))
  const edges: GraphData['edges'] = []
  for (let left = 0; left < notes.length; left += 1) {
    for (let right = left + 1; right < notes.length; right += 1) {
      const shared = notes[left].tags.filter(tag => notes[right].tags.includes(tag))
      if (shared.length) edges.push({ source: notes[left].id, target: notes[right].id, strength: Math.min(1, shared.length / 3), reason: 'tag' })
    }
  }
  return { nodes, edges }
}

async function secureUploadImage(file: File, noteId?: string) {
  const userId = activeVaultUser()
  if (!userId) throw new Error('Unlock your Secure Vault before adding an image.')
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Muse could not read this image.'))
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Muse could not read this image.'))
    reader.readAsDataURL(file)
  })
  const id = crypto.randomUUID()
  const record = await encryptRecord(userId, {
    id, recordType: 'attachment', revision: 1,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), deletedAt: null
  }, { id, noteId: noteId || null, name: file.name, mime: file.type, size: file.size, data })
  await request<{ saved: number }>('/vault/records', { method: 'POST', body: JSON.stringify({ records: [record] }) })
  return { url: data }
}

export type SecureAiPatch = Partial<Pick<Note, 'title' | 'content' | 'summary' | 'tags'>> & { tasks?: string[] }
async function runSecureAi(input: { action: 'summary' | 'tasks' | 'title' | 'tags' | 'rewrite' | 'organize'; mode?: string; note: Pick<Note, 'title' | 'content' | 'specialized'> }, onProgress?: (message: string) => void): Promise<SecureAiPatch> {
  const { data: { session } } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }))
  const response = await fetch(`${root}/ai/stream`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
    body: JSON.stringify({ ...input, ...(chatModel() ? { model: chatModel() } : {}) })
  })
  if (!response.ok || !response.body) await failure(response, 'Muse AI is unavailable right now.')
  if (!response.body) throw new Error('Muse AI is unavailable right now.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result: SecureAiPatch | undefined
  while (true) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2)
      const event = frame.match(/^event:\s*(.+)$/m)?.[1]
      const raw = frame.match(/^data:\s*(.+)$/m)?.[1]
      if (raw) {
        const data = JSON.parse(raw) as { message?: string; patch?: SecureAiPatch; error?: string }
        if (event === 'progress' && data.message) onProgress?.(data.message)
        if (event === 'result' && data.patch) result = data.patch
        if (event === 'error') throw new Error(data.error || 'Muse could not complete this request.')
      }
      boundary = buffer.indexOf('\n\n')
    }
    if (done) break
  }
  if (!result) throw new Error('Muse did not return a result.')
  return result
}

export const api = {
  listNotes: (scope = 'all') => activeVaultUser() ? listSecureNotes(scope) : request<Note[]>(`/notes?scope=${scope}`),
  getNote: (id: string) => activeVaultUser() ? secureNote(id).then(value => value.note) : request<Note>(`/notes/${id}`),
  createNote: (data: NoteInput) => activeVaultUser() ? createSecureNote(data) : request<Note>('/notes', { method: 'POST', body: JSON.stringify(data) }),
  updateNote: (id: string, data: NoteInput) => activeVaultUser() ? updateSecureNote(id, data) : request<Note>(`/notes/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  organizeNote: (id: string) => activeVaultUser() ? Promise.reject(new Error('Use the Secure Vault AI actions for encrypted notes.')) : request<AiJob>(`/notes/${id}/organize`, { method: 'POST' }),
  deleteNote: async (id: string) => { if (activeVaultUser()) { const { note, record } = await secureNote(id); await persistSecureNote({ ...note, deleted_at: new Date().toISOString() }, (record.revision || 1) + 1); return } return request<void>(`/notes/${id}`, { method: 'DELETE' }) },
  restoreNote: async (id: string) => { if (activeVaultUser()) { const { note, record } = await secureNote(id); return persistSecureNote({ ...note, deleted_at: null }, (record.revision || 1) + 1) } return request<Note>(`/notes/${id}/restore`, { method: 'POST' }) },
  permanentlyDeleteNote: async (id: string) => { if (activeVaultUser()) { const { note, record } = await secureNote(id); await persistSecureNote({ ...note, deleted_at: new Date().toISOString() }, (record.revision || 1) + 1); return } return request<void>(`/notes/${id}/permanent`, { method: 'DELETE' }) },
  clearSummary: (id: string) => activeVaultUser() ? secureNote(id).then(({ note, record }) => persistSecureNote({ ...note, summary: null }, (record.revision || 1) + 1)) : request<Note>(`/notes/${id}/summary`, { method: 'DELETE' }),
  clearTasks: (id: string) => activeVaultUser() ? secureNote(id).then(({ note, record }) => persistSecureNote({ ...note, tasks: [] }, (record.revision || 1) + 1)) : request<Note>(`/notes/${id}/tasks`, { method: 'DELETE' }),
  createSpecializedNote: async (category: SpecializedCategory, customTemplate?: { title?: string; fields?: Record<string, unknown>; aiInstruction?: string; color?: string; syncWithCalendar?: boolean }) => {
    if (activeVaultUser()) return createSpecializedSecureNote(category, customTemplate)
    const defaults = specializedDefaults[category]
    const title = customTemplate?.title || defaults.title
    const fields = customTemplate?.fields ? { ...customTemplate.fields } : { ...defaults.fields }
    const aiInstruction = customTemplate?.aiInstruction || defaults.aiInstruction
    const color = customTemplate?.color || 'blue'
    const syncWithCalendar = Boolean(customTemplate?.syncWithCalendar || category === 'workout' || category === 'daily')
    const initialContent = category === 'workout'
      ? '<h3>Workout Log</h3><p><strong>Exercises & Sets:</strong></p><p>• </p>'
      : ''
    const created = await request<Note>('/notes', {
      method: 'POST',
      body: JSON.stringify({
        title,
        content: initialContent,
        kind: 'specialized',
        specialized: {
          category,
          templateId: customTemplate?.title,
          fields,
          aiInstruction,
          color,
          syncWithCalendar
        }
      })
    })

    if (syncWithCalendar) {
      try {
        if (category === 'workout') {
          await api.syncWorkoutToCalendar(created.id, fields)
        } else if (category === 'daily') {
          await api.syncDailyToCalendar(created.id, fields)
        } else {
          await api.syncSpecializedToCalendar(created.id, title, fields)
        }
      } catch (syncErr) {
        console.warn('[api] Auto calendar sync error:', syncErr)
      }
    }

    return created
  },
  runSecureAi,
  setTask: async (id: string, completed: boolean) => {
    if (activeVaultUser()) {
      const { note, task } = await findSecureTask(id)
      const { record } = await secureNote(note.id)
      const tasks = note.tasks.map(item => item.id === id ? { ...item, completed } : item)
      await persistSecureNote({ ...note, tasks }, (record.revision || 1) + 1)
      return { ...task, completed }
    }
    return request<Task>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ completed }) })
  },
  trashNotes: async (ids: string[]) => { if (activeVaultUser()) { await Promise.all(ids.map(id => api.deleteNote(id))); return } return request<void>('/notes/bulk-trash', { method: 'POST', body: JSON.stringify({ ids }) }) },
  deleteNotes: async (ids: string[]) => { if (activeVaultUser()) { await Promise.all(ids.map(id => api.deleteNote(id))); return } return request<void>('/notes/bulk', { method: 'DELETE', body: JSON.stringify({ ids }) }) },
  restoreNotes: async (ids: string[]) => { if (activeVaultUser()) { await Promise.all(ids.map(id => api.restoreNote(id))); return } return request<void>('/notes/bulk-restore', { method: 'POST', body: JSON.stringify({ ids }) }) },
  emptyTrash: async () => { if (activeVaultUser()) return; return request<void>('/notes/trash', { method: 'DELETE' }) },
  createAiJob: (noteId: string, type: AiJob['type'], mode?: string) => request<AiJob>('/ai/jobs', { method: 'POST', body: JSON.stringify({ noteId, type, mode, ...(chatModel() && { model: chatModel() }) }) }),
  createResearch: (input: { topic: string; depth: 'concise' | 'standard' | 'in-depth'; documentIds?: string[]; title?: string; reportType?: string; objective?: string; audience?: string; instructions?: string; outputFormat?: 'html' | 'pdf' | 'docx' }) => request<AiJob>('/ai/jobs', { method: 'POST', body: JSON.stringify({ type: 'research', ...input }) }),
  getAiJob: (id: string) => request<AiJob>(`/ai/jobs/${id}`),
  listModels: () => request<string[]>(`/models`),

  // Bring-your-own AI providers
  aiProviders: () => request<AiProvidersState>('/ai/providers'),
  addAiProvider: (body: { kind: string; name?: string; baseUrl?: string | null; apiKey?: string | null }) => request<AiProvidersState>('/ai/providers', { method: 'POST', body: JSON.stringify(body) }),
  updateAiProvider: (id: string, body: { name?: string; baseUrl?: string | null; apiKey?: string; enabled?: boolean }) => request<AiProvidersState>(`/ai/providers/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteAiProvider: (id: string) => request<AiProvidersState>(`/ai/providers/${id}`, { method: 'DELETE' }),
  fetchAiModels: (providerId?: string) => request<AiProvidersState>('/ai/providers/fetch', { method: 'POST', body: JSON.stringify(providerId ? { providerId } : {}) }),
  saveAiPreferences: (preferences: AiPreferences) => request<AiProvidersState>('/ai/preferences', { method: 'PUT', body: JSON.stringify(preferences) }),
  testAiModel: (ref: string, capability: AiCapability, voice?: string | null) => request<{ ok: boolean; detail?: string; error?: string; ms: number }>('/ai/test', { method: 'POST', body: JSON.stringify({ ref, capability, voice }) }),
  aiReindexStatus: () => request<AiReindexStatus | null>('/ai/reindex'),
  async uploadResearchDocument(file: File) { const response = await fetch(`${root}/research/documents`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Research-Filename': encodeURIComponent(file.name) }, body: file }); if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || 'Document upload failed') } return response.json() as Promise<ResearchDocument> },
  async downloadReport(noteId: string, format: 'html' | 'pdf' | 'docx') { const response = await fetch(`${root}/reports/${noteId}/export?format=${format}`, { credentials: 'include' }); if (!response.ok) throw new Error('Report export failed'); const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `muse-report.${format}`; link.click(); URL.revokeObjectURL(url) },
  async uploadImage(file: File, noteId?: string) { if (activeVaultUser()) return secureUploadImage(file, noteId); const response = await fetch(`${root}/uploads${noteId ? `?noteId=${noteId}` : ''}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': file.type }, body: file }); if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || 'Image upload failed') } return response.json() as Promise<{ url: string }> },
  askNote: (noteId: string, question: string, history?: { role: 'user' | 'assistant'; text: string }[]) => request<AiJob>('/chat/note', { method: 'POST', body: JSON.stringify({ noteId, question, history, ...(chatModel() && { model: chatModel() }) }) }),
  askNotes: (question: string, history?: { role: 'user' | 'assistant'; text: string }[]) => request<AiJob>('/chat/search', { method: 'POST', body: JSON.stringify({ question, history, ...(chatModel() && { model: chatModel() }) }) }),
  getSettings: () => request<SettingsResponse>('/settings'),
  saveApiKey: (apiKey: string, provider?: 'gemini' | 'ollama') => request<SettingsResponse>('/settings', { method: 'PUT', body: JSON.stringify({ apiKey, provider }) }),
  deleteApiKey: (provider?: 'gemini' | 'ollama') => request<SettingsResponse>(`/settings${provider ? `?provider=${provider}` : ''}`, { method: 'DELETE' }),
  getAiUsage: (opts?: { model?: string; provider?: 'gemini' | 'ollama' }) => {
    const params = new URLSearchParams()
    if (opts?.model) params.set('model', opts.model)
    if (opts?.provider) params.set('provider', opts.provider)
    const qs = params.toString()
    return request<AiUsage>(`/ai/usage${qs ? `?${qs}` : ''}`)
  },
  getAiActive: () => request<{ running: boolean; type?: string }>('/ai/active'),
  getGraph: () => activeVaultUser() ? secureGraph() : request<GraphData>('/graph'),

  // Calendar
  listEvents: (from?: string, to?: string) => {
    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    const qs = params.toString()
    return request<CalendarEvent[]>(`/calendar/events${qs ? `?${qs}` : ''}`)
  },
  createEvent: (data: Partial<CalendarEvent>) => request<CalendarEvent>('/calendar/events', { method: 'POST', body: JSON.stringify(data) }),
  quickAddEvent: (prompt: string, clientDate?: string, noteId?: string) => request<CalendarEvent>('/calendar/events/quick-add', { method: 'POST', body: JSON.stringify({ prompt, clientDate, note_id: noteId }) }),
  updateEvent: (id: string, data: Partial<CalendarEvent>) => request<CalendarEvent>(`/calendar/events/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteEvent: (id: string) => request<void>(`/calendar/events/${id}`, { method: 'DELETE' }),
  syncWorkoutToCalendar: async (noteId: string, fields: Record<string, unknown>, currentEventId?: string | null) => {
    const rawDate = String(fields.date || fields.Date || new Date().toISOString().slice(0, 10))
    const rawTime = String(fields.time || fields.Time || '10:00')
    const rawName = String(fields.name || fields.Name || 'Gym Workout')
    const exerciseCount = String(fields.exerciseCount || fields['N exercises'] || fields['n exercises'] || '')

    const [hours, minutes] = rawTime.split(':').map(Number)
    const start = new Date(rawDate)
    start.setHours(isNaN(hours) ? 10 : hours, isNaN(minutes) ? 0 : minutes, 0, 0)
    const end = new Date(start.getTime() + 60 * 60 * 1000)

    const payload = {
      title: rawName.trim() || 'Gym Workout',
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      all_day: !rawTime,
      note_id: noteId,
      description: exerciseCount ? `Workout session (${exerciseCount} exercises)` : 'Gym workout session'
    }

    if (currentEventId) {
      return request<CalendarEvent>(`/calendar/events/${currentEventId}`, { method: 'PUT', body: JSON.stringify(payload) })
    }

    const existingEvents = await request<CalendarEvent[]>('/calendar/events')
    const existing = existingEvents.find(e => e.note_id === noteId)
    if (existing) {
      return request<CalendarEvent>(`/calendar/events/${existing.id}`, { method: 'PUT', body: JSON.stringify(payload) })
    }

    return request<CalendarEvent>('/calendar/events', { method: 'POST', body: JSON.stringify(payload) })
  },
  syncDailyToCalendar: async (noteId: string, fields: Record<string, unknown>, currentEventId?: string | null) => {
    const rawDate = String(fields.date || fields.Date || new Date().toISOString().slice(0, 10))
    const start = new Date(rawDate)
    start.setHours(9, 0, 0, 0)
    const end = new Date(start.getTime() + 60 * 60 * 1000)

    const payload = {
      title: 'Daily Plan & Reflection',
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      all_day: true,
      note_id: noteId,
      description: String(fields.feedback || fields.nextFocus || 'Daily reflection and tasks')
    }

    if (currentEventId) {
      return request<CalendarEvent>(`/calendar/events/${currentEventId}`, { method: 'PUT', body: JSON.stringify(payload) })
    }

    const existingEvents = await request<CalendarEvent[]>('/calendar/events')
    const existing = existingEvents.find(e => e.note_id === noteId)
    if (existing) {
      return request<CalendarEvent>(`/calendar/events/${existing.id}`, { method: 'PUT', body: JSON.stringify(payload) })
    }

    return request<CalendarEvent>('/calendar/events', { method: 'POST', body: JSON.stringify(payload) })
  },
  syncSpecializedToCalendar: async (noteId: string, noteTitle: string, fields: Record<string, unknown>, currentEventId?: string | null) => {
    let rawDate: string | undefined
    let rawTime: string | undefined
    for (const [key, val] of Object.entries(fields)) {
      const lower = key.toLowerCase()
      if (!rawDate && (lower.includes('date') || lower.includes('day'))) {
        rawDate = String(val || '')
      }
      if (!rawTime && (lower.includes('time') || lower.includes('hour'))) {
        rawTime = String(val || '')
      }
    }
    const finalDate = (rawDate && rawDate.trim()) || new Date().toISOString().slice(0, 10)
    const start = new Date(finalDate)
    if (isNaN(start.getTime())) {
      start.setTime(Date.now())
    }
    if (rawTime && rawTime.includes(':')) {
      const [hours, minutes] = rawTime.split(':').map(Number)
      start.setHours(isNaN(hours) ? 9 : hours, isNaN(minutes) ? 0 : minutes, 0, 0)
    } else {
      start.setHours(9, 0, 0, 0)
    }
    const end = new Date(start.getTime() + 60 * 60 * 1000)

    const descParts = Object.entries(fields)
      .filter(([k]) => !k.toLowerCase().includes('date') && !k.toLowerCase().includes('time'))
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n')

    const payload = {
      title: noteTitle.trim() || 'Specialized Event',
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      all_day: !rawTime,
      note_id: noteId,
      description: descParts || 'Specialized note event'
    }

    if (currentEventId) {
      return request<CalendarEvent>(`/calendar/events/${currentEventId}`, { method: 'PUT', body: JSON.stringify(payload) })
    }

    const existingEvents = await request<CalendarEvent[]>('/calendar/events')
    const existing = existingEvents.find(e => e.note_id === noteId)
    if (existing) {
      return request<CalendarEvent>(`/calendar/events/${existing.id}`, { method: 'PUT', body: JSON.stringify(payload) })
    }

    return request<CalendarEvent>('/calendar/events', { method: 'POST', body: JSON.stringify(payload) })
  },

  // Tasks
  listTasks: (dueDate?: string) => request<Task[]>(`/tasks${dueDate ? `?due_date=${dueDate}` : ''}`),
  createTask: (data: { text: string; due_date?: string | null; due_time?: string | null; priority?: string; note_id?: string | null; reminder_minutes_before?: number | null; reminder_at?: string | null }) => request<Task>('/tasks', { method: 'POST', body: JSON.stringify(data) }),
  updateTask: (id: string, data: Partial<Task>) => request<Task>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteTask: (id: string) => request<void>(`/tasks/${id}`, { method: 'DELETE' }),

  // Schedule & Task Detection
  detectSchedule: (noteId?: string, raw?: { title: string; content: string }) => request<DetectionResult>(noteId ? `/notes/${noteId}/detect` : '/notes/detect', { method: 'POST', body: JSON.stringify({ ...raw, ...(chatModel() ? { model: chatModel() } : {}) }) }),
  applyDetections: (noteId: string | null, payload: { events: any[]; tasks: any[] }) => request<{ success: boolean; addedEvents: number; addedTasks: number }>(noteId ? `/notes/${noteId}/apply-detections` : '/notes/apply-detections', { method: 'POST', body: JSON.stringify(payload) }),

  ownerStatus: () => publicRequest<{ configured: boolean; authenticated: boolean }>('/auth/owner'),
  setupOwner: (passphrase: string, setupCode: string) => publicRequest<{ authenticated: boolean }>('/auth/owner/setup', { method: 'POST', body: JSON.stringify({ passphrase, setupCode }) }),
  loginOwner: (passphrase: string) => publicRequest<{ authenticated: boolean }>('/auth/owner/login', { method: 'POST', body: JSON.stringify({ passphrase }) }),
  confirmAgentAction: (token: string) => request<{ result: Record<string, unknown>; actionCard?: unknown }>('/agent/confirm', { method: 'POST', body: JSON.stringify({ token }) }),
  createAppSession: () => request<{ authenticated: boolean; userId: string; email: string | null }>('/auth/session', { method: 'POST' }),
  getAppSession: () => request<{ authenticated: boolean; userId: string; email: string | null; method: string }>('/auth/session'),
  deleteAppSession: () => publicRequest<void>('/auth/session', { method: 'DELETE' }),
  getVault: () => request<VaultStatus>('/vault'),
  setupVault: (vaultCheck: string) => request<{ configured: boolean }>('/vault', { method: 'PUT', body: JSON.stringify({ vaultCheck }) }),
  listVaultRecords: (recordType?: VaultRecord['recordType']) => request<VaultRecord[]>(`/vault/records${recordType ? `?type=${recordType}` : ''}`),
  saveVaultRecords: (records: VaultRecord[]) => request<{ saved: number }>('/vault/records', { method: 'POST', body: JSON.stringify({ records }) }),
  setVaultMigration: (status: 'copying' | 'verified' | 'failed') => request<{ status: string }>('/vault/migration', { method: 'POST', body: JSON.stringify({ status }) }),
  legacyVaultExport: () => request<LegacyVaultExport>('/vault/legacy-export'),
  registrationOptions: () => request<{ options: PublicKeyCredentialCreationOptionsJSON; challengeId: string }>('/auth/passkeys/registration/options', { method: 'POST' }),
  verifyRegistration: (challengeId: string, response: unknown, name?: string) => request<{ verified: boolean }>('/auth/passkeys/registration/verify', { method: 'POST', body: JSON.stringify({ challengeId, response, name }) }),
  authenticationOptions: () => publicRequest<{ options: PublicKeyCredentialRequestOptionsJSON; challengeId: string }>('/auth/passkeys/authentication/options', { method: 'POST' }),
  verifyAuthentication: (challengeId: string, response: unknown) => publicRequest<{ authenticated: boolean; userId: string; email: string | null }>('/auth/passkeys/authentication/verify', { method: 'POST', body: JSON.stringify({ challengeId, response }) }),
  listPasskeys: () => request<Passkey[]>('/auth/passkeys'),
  revokePasskey: (id: string) => request<void>(`/auth/passkeys/${id}`, { method: 'DELETE' }),

  // Chat Sessions & Bip Autonomous Agent
  listChatSessions: () => request<ChatSession[]>('/chat/sessions'),
  createChatSession: (data?: { title?: string; context_type?: string; context_id?: string | null }) =>
    request<ChatSession>('/chat/sessions', { method: 'POST', body: JSON.stringify(data || {}) }),
  getChatSession: (id: string) => request<ChatSession & { messages: ChatMessage[] }>(`/chat/sessions/${id}`),
  updateChatSession: (id: string, data: { title: string }) =>
    request<ChatSession>(`/chat/sessions/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteChatSession: (id: string) => request<void>(`/chat/sessions/${id}`, { method: 'DELETE' }),
  sendChatMessage: (sessionId: string, data: { message: string; model?: string }) =>
    request<{
      userMessage: ChatMessage
      assistantMessage: ChatMessage
      sessionTitle?: string
    }>(`/chat/sessions/${sessionId}/messages`, { method: 'POST', body: JSON.stringify(data) }),
  updateChatMessage: (id: string, data: { content: string }) =>
    request<ChatMessage>(`/chat/messages/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteChatMessage: (id: string) => request<void>(`/chat/messages/${id}`, { method: 'DELETE' }),

  // User Memories
  listMemories: () => request<UserMemory[]>('/chat/memories'),
  createMemory: (data: { fact: string; category?: string }) =>
    request<UserMemory>('/chat/memories', { method: 'POST', body: JSON.stringify(data) }),
  deleteMemory: (id: string) => request<void>(`/chat/memories/${id}`, { method: 'DELETE' }),

  // Voice Transcribe Fallback
  transcribeAudio: async (audioBlob: Blob): Promise<{ text: string }> => {
    const userName = localStorage.getItem('muse-user-name') || 'Local User'
    const { data: { session } } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }))
    const response = await fetch(`${root}/voice/transcribe`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': audioBlob.type || 'audio/webm',
        'X-Muse-User-Name': encodeURIComponent(userName),
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
      },
      body: audioBlob
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new Error(body.error || 'Audio transcription failed')
    }
    return response.json()
  },

  // Neural Speech Synthesis
  synthesizeSpeech: async (text: string, voice = 'en-US-JennyNeural'): Promise<Blob> => {
    const userName = localStorage.getItem('muse-user-name') || 'Local User'
    const { data: { session } } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }))
    const response = await fetch(`${root}/voice/speak`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Muse-User-Name': encodeURIComponent(userName),
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
      },
      body: JSON.stringify({ text, voice })
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new Error(body.error || 'Speech synthesis failed')
    }
    return response.blob()
  },

  // Remote Mobile Companion
  getNetworkInfo: () => request<NetworkInfo>('/remote/network-info'),
  createPairingSession: (serverUrl?: string) =>
    request<PairingSession>('/remote/pairing/create', { method: 'POST', body: JSON.stringify({ serverUrl }) }),
  checkPairingStatus: (token: string) =>
    request<{ claimed: boolean; device?: { name: string; model: string; platform: string } }>(`/remote/pairing/status?token=${encodeURIComponent(token)}`),
  listRemoteDevices: () => request<RemoteDevice[]>('/remote/devices'),
  revokeRemoteDevice: (id: string) => request<{ success: boolean }>(`/remote/devices/${id}`, { method: 'DELETE' }),

  // Specialized Templates
  listTemplates: () => request<CustomTemplate[]>('/templates'),
  createTemplate: (data: Partial<CustomTemplate>) =>
    request<CustomTemplate>('/templates', { method: 'POST', body: JSON.stringify(data) }),
  updateTemplate: (id: string, data: Partial<CustomTemplate>) =>
    request<CustomTemplate>(`/templates/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteTemplate: (id: string) => request<void>(`/templates/${id}`, { method: 'DELETE' })
}

export type AiCapability = 'chat' | 'embedding' | 'tts' | 'stt'
export type AiCatalogModel = { ref: string; providerId: string; providerName: string; kind: string; model: string; label: string; capabilities: AiCapability[]; description?: string }
export type AiProvider = {
  id: string; kind: string; kindLabel: string; name: string; baseUrl: string | null; enabled: boolean
  hasKey: boolean; keyHint: string | null; needsKey: boolean
  models: { id: string; label?: string; capabilities: AiCapability[] }[]; lastFetchedAt: string | null; lastError: string | null
}
export type AiPreferences = { chat: string[]; embedding: string | null; tts: string | null; ttsVoice: string | null; stt: string | null }
export type AiReindexStatus = { running: boolean; total: number; done: number; failed: number; error?: string }
export type AiProvidersState = {
  providers: AiProvider[]
  preferences: AiPreferences
  catalog: AiCatalogModel[]
  kinds: { kind: string; label: string; needsKey: boolean; needsBaseUrl: boolean; defaultBaseUrl: string | null }[]
  voices: Record<string, string[]>
  reindex: AiReindexStatus | null
}

export type SettingsResponse = {
  hasApiKey: boolean
  hasGeminiKey: boolean
  hasOllamaKey: boolean
  activeProvider?: 'gemini' | 'ollama' | 'local' | null
}
export type AiUsage = {
  configured: boolean
  provider?: 'gemini' | 'ollama'
  plan?: string | null
  dailyLimit?: number
  requestsToday?: number
  totalTokens?: number
  session?: {
    usedPct: number
    models: { name: string; requests: number; tokens?: number }[]
  }
  weekly?: {
    usedPct: number
    models: { name: string; requests: number; tokens?: number }[]
  }
}
export type ResearchDocument = { id: string; filename: string; mime: string; size: number; created_at: string }
export type VaultStatus = { userId: string; email: string | null; configured: boolean; vaultCheck: string | null; encryptionVersion: number; migrationStatus: 'legacy' | 'copying' | 'verified' | 'failed'; migrationVerifiedAt: string | null; passkeyCount: number }
export type Passkey = { id: string; name: string; device_type: string | null; backed_up: boolean; created_at: string; last_used_at: string | null; revoked_at: string | null }
export type LegacyVaultExport = { notes: Note[]; documents: Record<string, unknown>[]; artifacts: Record<string, unknown>[]; reports: Record<string, unknown>[]; attachments: Record<string, unknown>[] }

export type NetworkInfo = {
  localIp: string
  tailscaleIp: string | null
  port: number
  localUrl: string
  tailscaleUrl: string | null
  currentOriginUrl: string
  hostname: string
}

export type PairingSession = {
  token: string
  pinCode: string
  serverUrl: string
  expiresAt: string
  qrData: string
}

export type RemoteDevice = {
  id: string
  device_name: string
  device_model?: string | null
  platform: 'android' | 'ios'
  last_seen_at: string
  created_at: string
}

