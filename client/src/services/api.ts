import { supabase } from './supabase'
import type { AiJob, Note, NoteInput, Task } from '../types'

const root = import.meta.env.VITE_API_URL || 'http://localhost:3001/api'
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
  createAiJob: (noteId: string, type: AiJob['type'], mode?: string) => request<AiJob>('/ai/jobs', { method: 'POST', body: JSON.stringify({ noteId, type, mode }) }), getAiJob: (id: string) => request<AiJob>(`/ai/jobs/${id}`),
  async uploadImage(file: File) { const { data: { session } } = await supabase.auth.getSession(); const response = await fetch(`${root}/uploads`, { method: 'POST', headers: { 'Content-Type': file.type, ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) }, body: file }); if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || 'Image upload failed') } return response.json() as Promise<{ url: string }> },
  askNote: (noteId: string, question: string) => request<AiJob>('/chat/note', { method: 'POST', body: JSON.stringify({ noteId, question }) }), askNotes: (question: string) => request<AiJob>('/chat/search', { method: 'POST', body: JSON.stringify({ question }) })
}
