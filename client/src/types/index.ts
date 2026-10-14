export type Task = { id: string; note_id: string | null; text: string; completed: boolean; created_at: string; due_date?: string | null; due_time?: string | null; priority?: string }
export type CalendarEvent = { id: string; user_id?: string; note_id?: string | null; title: string; description?: string; start_time: string; end_time?: string | null; all_day: boolean; location?: string; created_at?: string; updated_at?: string }
export type NoteKind = 'note' | 'research' | 'specialized'
export type SpecializedCategory = 'daily' | 'workout' | 'finance' | 'custom'
export type SpecializedNote = { category: SpecializedCategory; templateId?: string; fields: Record<string, unknown>; aiInstruction?: string; color?: string }
export type Note = { id: string; title: string; content: string; summary: string | null; favorite: boolean; archived: boolean; deleted_at: string | null; created_at: string; updated_at: string; kind: NoteKind; tags: string[]; tasks: Task[]; specialized?: SpecializedNote; aiStatus?: 'idle' | 'processing' | 'complete' | 'error' }
export type NoteInput = Partial<Pick<Note, 'title' | 'content' | 'favorite' | 'archived' | 'tags' | 'summary' | 'tasks' | 'specialized'>>
export type AiJob = { id: string; note_id: string | null; type: 'organize' | 'summary' | 'tasks' | 'title' | 'tags' | 'rewrite' | 'ask_note' | 'ask_search' | 'research'; status: 'queued' | 'processing' | 'complete' | 'failed'; attempts: number; error: string | null; result: Record<string, unknown> | null; queuePosition?: number }
export type GraphNode = { id: string; title: string; kind: string; tags: string[]; updated_at: string }
export type GraphEdge = { source: string; target: string; strength: number; reason: 'similar' | 'tag' | 'both' }
export type GraphData = { nodes: GraphNode[]; edges: GraphEdge[] }
export type DetectionResult = {
  events: { title: string; start_time: string; end_time?: string | null; all_day?: boolean; location?: string }[]
  tasks: { text: string; due_date?: string | null; priority?: string }[]
}
