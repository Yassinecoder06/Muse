import { supabase } from '../supabase/client.js'
import { ai, contextBudgetChars, type HistoryItem } from './ai.service.js'
import { notes } from './note.repository.js'
import { vectors } from './vector.service.js'
import type { AiJob, AiJobType } from '../types/index.js'

export class AiQueueLimitError extends Error {}

export const jobs = {
  async enqueue(userId: string, noteId: string | null, type: AiJobType, payload: { mode?: string; question?: string; history?: HistoryItem[] } = {}) {
    if (noteId) await notes.get(userId, noteId)
    const { data: active, error: activeError } = await supabase.from('ai_jobs').select('id').eq('user_id', userId).in('status', ['queued', 'processing']).limit(1)
    if (activeError) throw activeError
    if (active?.length) throw new AiQueueLimitError('Muse is already working on one of your requests. Please wait a moment.')
    const { data, error } = await supabase.from('ai_jobs').insert({ user_id: userId, note_id: noteId, type, payload }).select().single()
    if (error) throw error
    const { count } = await supabase.from('ai_jobs').select('*', { count: 'exact', head: true }).eq('status', 'queued').lte('created_at', data.created_at)
    return { ...data, queuePosition: count || 1 } as AiJob & { queuePosition: number }
  },
  async get(userId: string, id: string) {
    const { data, error } = await supabase.from('ai_jobs').select().eq('id', id).eq('user_id', userId).single()
    if (error) throw error
    return data as AiJob
  },
  async complete(id: string, result: Record<string, unknown>) { const { error } = await supabase.from('ai_jobs').update({ status: 'complete', result, finished_at: new Date().toISOString(), error: null }).eq('id', id); if (error) throw error },
  async fail(id: string, error: unknown) { const message = error instanceof Error ? error.message : 'Muse could not complete this request.'; const { error: updateError } = await supabase.from('ai_jobs').update({ status: 'failed', error: message.slice(0, 500), finished_at: new Date().toISOString() }).eq('id', id); if (updateError) throw updateError },
  async cleanup() { await supabase.from('ai_jobs').delete().eq('status', 'complete').lt('finished_at', new Date(Date.now() - 60 * 60 * 1000).toISOString()); await supabase.from('ai_jobs').delete().eq('status', 'failed').lt('finished_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()) }
}

async function process(job: AiJob) {
  if ((job.type !== 'ask_search' && !job.note_id) || ((job.type === 'ask_note') && !job.payload?.question)) throw new Error('AI job is missing its required note or question.')
  const note = job.note_id ? await notes.get(job.user_id, job.note_id) : null
  let result: Record<string, unknown> = {}
  if (job.type === 'organize') {
    const title = note!.title.trim() || await ai.generateTitle(note!.content)
    const tags = await ai.generateTags(note!.content)
    const summary = await ai.summarize(note!.content)
    await notes.setGenerated(job.user_id, note!.id, { title, tags, summary })
    result = { title, tags, summary }
  } else if (job.type === 'summary') { const summary = await ai.summarize(note!.content); await notes.setGenerated(job.user_id, note!.id, { summary }); result = { summary } }
  else if (job.type === 'tasks') { const tasks = await ai.extractTasks(note!.content); await notes.replaceTasks(job.user_id, note!.id, tasks); result = { count: tasks.length } }
  else if (job.type === 'title') { const title = await ai.generateTitle(note!.content); await notes.setGenerated(job.user_id, note!.id, { title }); result = { title } }
  else if (job.type === 'tags') { const tags = await ai.generateTags(note!.content); await notes.setGenerated(job.user_id, note!.id, { tags }); result = { tags } }
  else if (job.type === 'rewrite') { const mode = job.payload?.mode; if (!mode) throw new Error('Rewrite mode is missing.'); const content = await ai.rewrite(note!.content, mode); await notes.update(job.user_id, note!.id, { content }); result = { content } }
  else if (job.type === 'ask_note') result = { answer: await ai.askCurrentNote(job.payload.question!, `${note!.title}\n${note!.content}`, job.payload?.history), sources: [{ id: note!.id, title: note!.title }] }
  else if (job.type === 'ask_search') {
    const ids = await vectors.searchSimilarNotes(job.user_id, job.payload.question || '')
    const found = (await Promise.all(ids.map(id => notes.get(job.user_id, id).catch(() => null)))).filter(Boolean)
    const budget = contextBudgetChars()
    const perNote = Math.max(1500, Math.floor(budget / Math.max(found.length, 1)))
    const context = found.map((item: any) => `# ${item.title}\n${item.content.slice(0, perNote)}`).join('\n\n')
    result = { answer: await ai.askMyNotes(job.payload.question || '', context, job.payload.history), sources: found.map((item: any) => ({ id: item.id, title: item.title })) }
  }
  if (note) await vectors.upsertVector(await notes.get(job.user_id, note.id))
  return result
}

let running = false
export function startAiWorker() {
  if (running) return
  running = true
  let lastMaintenance = 0
  const loop = async () => {
    try {
      if (Date.now() - lastMaintenance > 60_000) { await supabase.rpc('requeue_stuck_ai_jobs'); await jobs.cleanup(); lastMaintenance = Date.now() }
      const { data, error } = await supabase.rpc('claim_next_ai_job')
      if (error) throw error
      const job = (data || [])[0] as AiJob | undefined
      if (job) { try { await jobs.complete(job.id, await process(job)) } catch (error) { await jobs.fail(job.id, error) } }
      setTimeout(loop, job ? 0 : 1000)
    } catch (error) { console.error('AI queue worker error', error); setTimeout(loop, 3000) }
  }
  void loop()
}
