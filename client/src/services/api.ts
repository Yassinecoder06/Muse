import { supabase } from './supabase'
import { chatModel } from './settings'
import type { AiJob, GraphData, Note, NoteInput, Task } from '../types'

const root = import.meta.env.VITE_API_URL || 'http://localhost:3001/api'
function apiOrigin() { return /^https?:\/\//.test(root) ? new URL(root).origin : window.location.origin }
export function resolveApiImageSrc(src: string) { return src.startsWith('/api/images/') ? `${apiOrigin()}${src}` : src }
export function relativizeApiImageSrc(src: string) {
  const origin = apiOrigin()
  return src.startsWith(`${origin}/api/images/`) ? src.slice(origin.length) : src
}
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession()
  const response = await fetch(`${root}${path}`, { headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}), ...(options?.headers || {}) }, ...options })
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || 'Request failed') }
  return response.status === 204 ? undefined as T : response.json()
}
export const api = {
  listNotes: (scope = 'all') => request<Note[]>(`/notes?scope=${scope}`), getNote: (id: string) => request<Note>(`/notes/${id}`),
  createNote: (data: NoteInput) => request<Note>('/notes', { method: 'POST', body: JSON.stringify(data) }), updateNote: (id: string, data: NoteInput) => request<Note>(`/notes/${id}`, { method: 'PUT', body: JSON.stringify(data) }), organizeNote: (id: string) => request<AiJob>(`/notes/${id}/organize`, { method: 'POST' }), deleteNote: (id: string) => request<void>(`/notes/${id}`, { method: 'DELETE' }), restoreNote: (id: string) => request<Note>(`/notes/${id}/restore`, { method: 'POST' }), permanentlyDeleteNote: (id: string) => request<void>(`/notes/${id}/permanent`, { method: 'DELETE' }), clearSummary: (id: string) => request<Note>(`/notes/${id}/summary`, { method: 'DELETE' }), clearTasks: (id: string) => request<Note>(`/notes/${id}/tasks`, { method: 'DELETE' }),
  setTask: (id: string, completed: boolean) => request<Task>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ completed }) }),
  deleteNotes: (ids: string[]) => request<void>('/notes/bulk', { method: 'DELETE', body: JSON.stringify({ ids }) }), restoreNotes: (ids: string[]) => request<void>('/notes/bulk-restore', { method: 'POST', body: JSON.stringify({ ids }) }), emptyTrash: () => request<void>('/notes/trash', { method: 'DELETE' }),
  createAiJob: (noteId: string, type: AiJob['type'], mode?: string) => request<AiJob>('/ai/jobs', { method: 'POST', body: JSON.stringify({ noteId, type, mode, ...(chatModel() && { model: chatModel() }) }) }), createResearch: (input: { topic: string; depth: 'concise' | 'standard' | 'in-depth'; documentIds?: string[]; title?: string; reportType?: string; objective?: string; audience?: string; instructions?: string; outputFormat?: 'html' | 'pdf' | 'docx' }) => request<AiJob>('/ai/jobs', { method: 'POST', body: JSON.stringify({ type: 'research', ...input }) }), getAiJob: (id: string) => request<AiJob>(`/ai/jobs/${id}`), listModels: () => request<string[]>(`/models`),
  async uploadResearchDocument(file: File) { const { data: { session } } = await supabase.auth.getSession(); const response = await fetch(`${root}/research/documents`, { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Research-Filename': encodeURIComponent(file.name), ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) }, body: file }); if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || 'Document upload failed') } return response.json() as Promise<ResearchDocument> },
  async downloadReport(noteId: string, format: 'html' | 'pdf' | 'docx') { const { data: { session } } = await supabase.auth.getSession(); const response = await fetch(`${root}/reports/${noteId}/export?format=${format}`, { headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {} }); if (!response.ok) throw new Error('Report export failed'); const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `muse-report.${format}`; link.click(); URL.revokeObjectURL(url) },
  async uploadImage(file: File, noteId?: string) { const { data: { session } } = await supabase.auth.getSession(); const response = await fetch(`${root}/uploads${noteId ? `?noteId=${noteId}` : ''}`, { method: 'POST', headers: { 'Content-Type': file.type, ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) }, body: file }); if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || 'Image upload failed') } return response.json() as Promise<{ url: string }> },
  askNote: (noteId: string, question: string, history?: { role: 'user' | 'assistant'; text: string }[]) => request<AiJob>('/chat/note', { method: 'POST', body: JSON.stringify({ noteId, question, history, ...(chatModel() && { model: chatModel() }) }) }), askNotes: (question: string, history?: { role: 'user' | 'assistant'; text: string }[]) => request<AiJob>('/chat/search', { method: 'POST', body: JSON.stringify({ question, history, ...(chatModel() && { model: chatModel() }) }) }),
  getSettings: () => request<{ hasApiKey: boolean }>('/settings'), saveApiKey: (apiKey: string) => request<{ hasApiKey: boolean }>('/settings', { method: 'PUT', body: JSON.stringify({ apiKey }) }), deleteApiKey: () => request<{ hasApiKey: boolean }>('/settings', { method: 'DELETE' }),
  getAiUsage: () => request<AiUsage>('/ai/usage'),
  getAiActive: () => request<{ running: boolean; type?: string }>('/ai/active'),
  getGraph: () => request<GraphData>('/graph')
}
export type AiUsage = { configured: boolean; plan?: string | null; session?: { usedPct: number; models: { name: string; requests: number }[] }; weekly?: { usedPct: number; models: { name: string; requests: number }[] } }
export type ResearchDocument = { id: string; filename: string; mime: string; size: number; created_at: string }
