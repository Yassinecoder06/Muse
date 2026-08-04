import { supabase } from '../supabase/client.js'
import type { Note, NoteInput, Task } from '../types/index.js'

const select = 'id,user_id,title,content,summary,favorite,archived,deleted_at,created_at,updated_at,note_tags(tags(id,name)),tasks(id,user_id,note_id,text,completed,created_at)'
function normalize(row: any): Note { return { ...row, tags: (row.note_tags || []).map((item: any) => item.tags?.name).filter(Boolean), tasks: row.tasks || [] } }

async function tagsFor(userId: string, noteId: string, names: string[]) {
  const cleaned = [...new Set(names.map(name => name.trim().toLowerCase()).filter(Boolean))].slice(0, 6)
  const { error: removeError } = await supabase.from('note_tags').delete().eq('note_id', noteId)
  if (removeError) throw removeError
  if (!cleaned.length) return
  const { data, error } = await supabase.from('tags').upsert(cleaned.map(name => ({ user_id: userId, name })), { onConflict: 'user_id,name' }).select('id,name')
  if (error) throw error
  const { error: linkError } = await supabase.from('note_tags').insert((data || []).map(tag => ({ note_id: noteId, tag_id: tag.id })))
  if (linkError) throw linkError
}

export const notes = {
  async list(userId: string, scope = 'all') {
    let query = supabase.from('notes').select(select).eq('user_id', userId).order('updated_at', { ascending: false })
    if (scope === 'trash') query = query.not('deleted_at', 'is', null)
    else {
      query = query.is('deleted_at', null)
      if (scope === 'favorites') query = query.eq('favorite', true)
      if (scope === 'archive') query = query.eq('archived', true)
      else query = query.eq('archived', false)
    }
    const { data, error } = await query
    if (error) throw error
    return (data || []).map(normalize)
  },
  async get(userId: string, id: string) {
    const { data, error } = await supabase.from('notes').select(select).eq('id', id).eq('user_id', userId).single()
    if (error) throw error
    return normalize(data)
  },
  async create(userId: string, input: NoteInput) {
    const { tags = [], ...data } = input
    const { data: note, error } = await supabase.from('notes').insert({ ...data, user_id: userId, title: data.title || '', content: data.content || '', favorite: data.favorite || false, archived: data.archived || false }).select().single()
    if (error) throw error
    await tagsFor(userId, note.id, tags)
    return this.get(userId, note.id)
  },
  async update(userId: string, id: string, input: NoteInput) {
    const { tags, ...data } = input
    const { error } = await supabase.from('notes').update(data).eq('id', id).eq('user_id', userId)
    if (error) throw error
    if (tags) await tagsFor(userId, id, tags)
    return this.get(userId, id)
  },
  async setGenerated(userId: string, id: string, values: { title?: string; summary?: string | null; tags?: string[] }) {
    const { tags, ...data } = values
    if (Object.keys(data).length) { const { error } = await supabase.from('notes').update(data).eq('id', id).eq('user_id', userId); if (error) throw error }
    if (tags) await tagsFor(userId, id, tags)
    return this.get(userId, id)
  },
  async trash(userId: string, id: string) { const { error } = await supabase.from('notes').update({ deleted_at: new Date().toISOString() }).eq('id', id).eq('user_id', userId); if (error) throw error },
  async restore(userId: string, id: string) { const { error } = await supabase.from('notes').update({ deleted_at: null }).eq('id', id).eq('user_id', userId); if (error) throw error; return this.get(userId, id) },
  async deletePermanently(userId: string, id: string) { const { error } = await supabase.from('notes').delete().eq('id', id).eq('user_id', userId); if (error) throw error },
  async replaceTasks(userId: string, noteId: string, values: string[]) {
    const { error: removeError } = await supabase.from('tasks').delete().eq('note_id', noteId).eq('user_id', userId)
    if (removeError) throw removeError
    if (values.length) { const { error } = await supabase.from('tasks').insert(values.map(text => ({ user_id: userId, note_id: noteId, text }))); if (error) throw error }
  },
  async setTask(userId: string, id: string, completed: boolean): Promise<Task> { const { data, error } = await supabase.from('tasks').update({ completed }).eq('id', id).eq('user_id', userId).select().single(); if (error) throw error; return data }
}
