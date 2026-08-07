export type Note = { id: string; user_id: string; title: string; content: string; summary: string | null; favorite: boolean; archived: boolean; deleted_at: string | null; created_at: string; updated_at: string; tags: string[]; tasks?: Task[] }
export type Task = { id: string; user_id: string; note_id: string; text: string; completed: boolean; created_at: string }
export type NoteInput = { title?: string; content?: string; favorite?: boolean; archived?: boolean; tags?: string[] }
export type AiStatus = 'idle' | 'processing' | 'complete' | 'error'
export type AiJobType = 'organize' | 'summary' | 'tasks' | 'title' | 'tags' | 'rewrite' | 'ask_note' | 'ask_search'
export type AiJobStatus = 'queued' | 'processing' | 'complete' | 'failed'
export type AiJob = { id: string; user_id: string; note_id: string | null; type: AiJobType; payload: { mode?: string; question?: string; history?: { role: 'user' | 'assistant'; text: string }[] }; status: AiJobStatus; attempts: number; error: string | null; result: Record<string, unknown> | null; created_at: string; started_at: string | null; finished_at: string | null }
