export type Task = { id: string; note_id: string | null; text: string; completed: boolean; created_at: string; completed_at?: string | null; due_date?: string | null; due_time?: string | null; priority?: string; reminder_at?: string | null; reminder_minutes_before?: number | null }
export type CalendarEvent = { id: string; user_id?: string; note_id?: string | null; title: string; description?: string; start_time: string; end_time?: string | null; all_day: boolean; location?: string; created_at?: string; updated_at?: string }
export type NoteKind = 'note' | 'research' | 'specialized'
export type SpecializedCategory = 'daily' | 'workout' | 'finance' | 'custom'
export type SpecializedNote = { category: SpecializedCategory; templateId?: string; fields: Record<string, unknown>; aiInstruction?: string; color?: string; syncWithCalendar?: boolean }
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

export interface NoteActionCard {
  type: 'note'
  id: string
  title: string
  contentSnippet: string
  tags?: string[]
}

export interface TaskActionCard {
  type: 'task'
  id: string
  text: string
  completed: boolean
  dueDate?: string | null
  priority?: string
}

export interface EventActionCard {
  type: 'event'
  id: string
  title: string
  startTime: string
  endTime?: string | null
  location?: string
}

export interface MemoryActionCard {
  type: 'memory'
  id: string
  fact: string
  category: string
}

export interface TemplateActionCard {
  type: 'template'
  id: string
  title: string
  contentSnippet?: string
  category?: string
}

export interface SpecializedNoteActionCard {
  type: 'specialized_note'
  id: string
  title: string
  contentSnippet?: string
  tags?: string[]
  category?: string
}

export interface DeletedItemActionCard {
  type: 'item_deleted'
  id?: string
  title: string
  contentSnippet?: string
  category?: string
  itemType?: string
  status?: string
}

// A destructive action Bip proposed; nothing happens until the user confirms.
export interface ConfirmRequiredActionCard {
  type: 'confirm_required'
  id?: string
  title: string
  itemType: string
  status: string
  token: string
}

export interface MusicActionCard {
  type: 'music'
  id?: string
  title: string
  filename?: string
  url?: string
  status?: string
}

export type ActionCard =
  | ConfirmRequiredActionCard
  | NoteActionCard
  | TaskActionCard
  | EventActionCard
  | MemoryActionCard
  | TemplateActionCard
  | SpecializedNoteActionCard
  | DeletedItemActionCard
  | MusicActionCard

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  tool_calls?: any[]
  tool_results?: any[]
  action_cards?: ActionCard[]
  created_at: string
}

export interface ChatSession {
  id: string
  user_id: string
  title: string
  context_type: string
  context_id?: string | null
  created_at: string
  updated_at: string
  messages?: ChatMessage[]
}

export interface UserMemory {
  id: string
  user_id: string
  fact: string
  category: string
  created_at: string
  updated_at: string
}
