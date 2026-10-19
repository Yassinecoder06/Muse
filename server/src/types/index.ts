export type NoteKind = 'note' | 'research' | 'specialized'
export type Note = { id: string; user_id: string; title: string; content: string; summary: string | null; favorite: boolean; archived: boolean; deleted_at: string | null; created_at: string; updated_at: string; kind: NoteKind; tags: string[]; tasks?: Task[]; specialized?: Record<string, unknown> }
export type Task = { id: string; user_id: string; note_id: string | null; text: string; completed: boolean; created_at: string; due_date?: string | null; due_time?: string | null; priority?: string }
export type CalendarEvent = { id: string; user_id: string; note_id?: string | null; title: string; description?: string; start_time: string; end_time?: string | null; all_day: boolean; location?: string; created_at: string; updated_at: string }
export type NoteInput = { title?: string; content?: string; favorite?: boolean; archived?: boolean; tags?: string[]; kind?: NoteKind; specialized?: Record<string, unknown> }
export type AiStatus = 'idle' | 'processing' | 'complete' | 'error'
export type AiJobType = 'organize' | 'summary' | 'tasks' | 'title' | 'tags' | 'rewrite' | 'ask_note' | 'ask_search' | 'research'
export type AiJobStatus = 'queued' | 'processing' | 'complete' | 'failed'
export type AiJob = { id: string; user_id: string; note_id: string | null; type: AiJobType; payload: { mode?: string; question?: string; history?: { role: 'user' | 'assistant'; text: string }[]; model?: string; topic?: string; title?: string; objective?: string; audience?: string; instructions?: string; reportType?: 'business' | 'technical' | 'financial' | 'research' | 'management' | 'project'; outputFormat?: 'html' | 'pdf' | 'docx'; enabledSkills?: string[]; depth?: 'concise' | 'standard' | 'in-depth'; documentIds?: string[] }; status: AiJobStatus; attempts: number; error: string | null; result: Record<string, unknown> | null; created_at: string; started_at: string | null; finished_at: string | null }
export type ScheduleDetectionResult = {
  events: { title: string; start_time: string; end_time?: string; all_day?: boolean; location?: string }[]
  tasks: { text: string; due_date?: string; priority?: string }[]
}

export type SpecializedTemplate = {
  id: string
  user_id: string
  title: string
  description?: string | null
  fields: { name: string; defaultValue?: string }[]
  ai_instruction?: string | null
  color?: string
  sync_with_calendar?: boolean
  created_at: string
  updated_at: string
}

