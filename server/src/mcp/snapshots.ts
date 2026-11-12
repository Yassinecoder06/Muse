import { supabase } from '../supabase/client.js'
import type { UndoSnapshot } from './ports.js'

// Raw rows are captured exactly as stored (encrypted columns stay encrypted),
// so an undo can upsert them back unchanged.

type Loader = (userId: string, id: string | null) => Promise<UndoSnapshot[]>

async function rows(table: string, query: (q: any) => any): Promise<Record<string, unknown>[]> {
  const { data, error } = await query(supabase.from(table).select('*'))
  if (error) throw error
  return (data ?? []) as Record<string, unknown>[]
}

function byId(table: string): Loader {
  return async (userId, id) => {
    if (!id) return []
    return [{ table, rows: await rows(table, q => q.eq('user_id', userId).eq('id', id)) }]
  }
}

const loaders: Record<string, Loader> = {
  Note: byId('notes'),
  Task: byId('tasks'),
  'Calendar Event': byId('events'),
  Memory: byId('user_memories'),
  'Specialized Template': byId('specialized_templates'),
  Trash: async userId => [{ table: 'notes', rows: await rows('notes', q => q.eq('user_id', userId).not('deleted_at', 'is', null)) }],
  // A conversation is restored session first, then its messages.
  Conversation: async (userId, id) => {
    if (!id) return []
    return [
      { table: 'chat_sessions', rows: await rows('chat_sessions', q => q.eq('user_id', userId).eq('id', id)) },
      { table: 'chat_messages', rows: await rows('chat_messages', q => q.eq('session_id', id)) }
    ]
  }
}

/** Returns the snapshots to save before a destructive action, in restore order. */
export async function captureSnapshots(userId: string, itemType: string, id: string | null): Promise<UndoSnapshot[]> {
  const load = loaders[itemType]
  if (!load) return []
  return (await load(userId, id)).filter(snapshot => snapshot.rows.length > 0)
}

export async function captureNote(userId: string, id: string): Promise<UndoSnapshot[]> {
  return captureSnapshots(userId, 'Note', id)
}
