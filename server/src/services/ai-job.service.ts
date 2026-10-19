import { supabase } from '../supabase/client.js'
import { ai, contextBudgetChars, type HistoryItem, OLLAMA_LOCAL_URL } from './ai.service.js'
import { notes } from './note.repository.js'
import { vectors } from './vector.service.js'
import { research } from './research.service.js'
import { researchArtifacts, researchDocuments } from './research-document.repository.js'
import { reportRepository } from './reporting/repository.js'
import { settings } from './settings.repository.js'
import { extractImageTags, restoreImages, stripImages } from '../utils/images.js'
import type { AiJob, AiJobType } from '../types/index.js'

export class AiQueueLimitError extends Error {}

export const jobs = {
  async enqueue(userId: string, noteId: string | null, type: AiJobType, payload: any = {}) {
    if (noteId) await notes.get(userId, noteId)
    const { data: active, error: activeError } = await supabase.from('ai_jobs').select('id').eq('user_id', userId).in('status', ['queued', 'processing']).limit(1)
    if (activeError) throw activeError
    if (active?.length) throw new AiQueueLimitError('Muse is already working on one of your requests. Please wait a moment.')
    const { data, error } = await supabase.from('ai_jobs').insert({ user_id: userId, note_id: noteId, type, payload }).select().single()
    // The partial unique index (migration 016) catches the race the check above can't.
    if (error?.code === '23505') throw new AiQueueLimitError('Muse is already working on one of your requests. Please wait a moment.')
    if (error) throw error
    const { count } = await supabase.from('ai_jobs').select('*', { count: 'exact', head: true }).eq('status', 'queued').lte('created_at', data.created_at)
    return { ...data, queuePosition: count || 1 } as AiJob & { queuePosition: number }
  },
  async get(userId: string, id: string) {
    const { data, error } = await supabase.from('ai_jobs').select().eq('id', id).eq('user_id', userId).single()
    if (error) throw error
    return data as AiJob
  },
  async active(userId: string) {
    const { data, error } = await supabase.from('ai_jobs').select('type').eq('user_id', userId).in('status', ['queued', 'processing']).order('created_at', { ascending: true }).limit(1)
    if (error) throw error
    return (data?.[0] as { type: AiJobType } | undefined) ?? null
  },
  async complete(id: string, result: Record<string, unknown>) { const { error } = await supabase.from('ai_jobs').update({ status: 'complete', result, finished_at: new Date().toISOString(), error: null }).eq('id', id); if (error) throw error },
  async progress(id: string, result: Record<string, unknown>) { const { error } = await supabase.from('ai_jobs').update({ result }).eq('id', id); if (error) throw error },
  async fail(id: string, error: unknown) { const message = error instanceof Error ? error.message : 'Muse could not complete this request.'; const { error: updateError } = await supabase.from('ai_jobs').update({ status: 'failed', error: message.slice(0, 500), finished_at: new Date().toISOString() }).eq('id', id); if (updateError) throw updateError },
  async cleanup() { await supabase.from('ai_jobs').delete().eq('status', 'complete').neq('type', 'research').lt('finished_at', new Date(Date.now() - 60 * 60 * 1000).toISOString()); await supabase.from('ai_jobs').delete().eq('status', 'failed').neq('type', 'research').lt('finished_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()) }
}

async function process(job: AiJob) {
  if ((job.type !== 'ask_search' && job.type !== 'research' && !job.note_id) || ((job.type === 'ask_note') && !job.payload?.question)) throw new Error('AI job is missing its required note or question.')
  const { geminiKey, ollamaKey } = await settings.getEffectiveAiKeys(job.user_id)
  if (!geminiKey && !ollamaKey) {
    try {
      const res = await fetch(`${OLLAMA_LOCAL_URL}/api/tags`)
      if (!res.ok) throw new Error()
    } catch {
      throw new Error('Add your Gemini API key (or Ollama API key) in Settings, or ensure local Ollama is running.')
    }
  }
  const keyContext = { geminiKey, ollamaKey, userId: job.user_id }
  const note = job.note_id ? await notes.get(job.user_id, job.note_id) : null
  const model = job.payload?.model || undefined
  let result: Record<string, unknown> = {}
  if (job.type === 'organize') {
    const title = note!.title.trim() || await ai.generateTitle(note!.content, model, keyContext)
    const tags = await ai.generateTags(note!.content, model, keyContext)
    const summary = await ai.summarize(note!.content, model, keyContext)
    await notes.setGenerated(job.user_id, note!.id, { title, tags, summary })
    result = { title, tags, summary }
  } else if (job.type === 'summary') { const summary = await ai.summarize(note!.content, model, keyContext); await notes.setGenerated(job.user_id, note!.id, { summary }); result = { summary } }
  else if (job.type === 'tasks') { const tasks = await ai.extractTasks(note!.content, model, keyContext); await notes.replaceTasks(job.user_id, note!.id, tasks); result = { count: tasks.length } }
  else if (job.type === 'title') { const title = await ai.generateTitle(note!.content, model, keyContext); await notes.setGenerated(job.user_id, note!.id, { title }); result = { title } }
  else if (job.type === 'tags') { const tags = await ai.generateTags(note!.content, model, keyContext); await notes.setGenerated(job.user_id, note!.id, { tags }); result = { tags } } else if (job.type === 'rewrite') {
    const mode = job.payload?.mode; if (!mode) throw new Error('Rewrite mode is missing.')
    const current = await notes.get(job.user_id, note!.id)
    const { text, images } = extractImageTags(current.content)
    if (debugRewrite()) console.log('[rewrite-debug] worker read content:', JSON.stringify(current.content.slice(0, 250)))
    const rewritten = await ai.rewrite(text, mode, model, keyContext)
    if (debugRewrite()) console.log('[rewrite-debug] model output:', rewritten.slice(0, 300))
    const latest = await notes.get(job.user_id, note!.id)
    const lateImages = extractImageTags(latest.content).images.filter(src => !images.includes(src))
    const content = restoreImages(rewritten, [...images, ...lateImages])
    if (debugRewrite()) console.log('[rewrite-debug] final content img count:', (content.match(/<img\b/gi) || []).length)
    await notes.update(job.user_id, note!.id, { content })
    result = { content, images: images.length }
  }
  else if (job.type === 'ask_note') result = { answer: await ai.askCurrentNote(job.payload.question!, `${note!.title}\n${stripImages(note!.content)}`, job.payload?.history, model, keyContext), sources: [{ id: note!.id, title: note!.title }] }
  else if (job.type === 'ask_search') {
    const ids = await vectors.searchSimilarNotes(job.user_id, job.payload.question || '')
    // Trashed notes keep their vectors (so restore is instant) but must not feed answers.
    const found = (await Promise.all(ids.map(id => notes.get(job.user_id, id).catch(() => null)))).filter(note => note && !note.deleted_at)
    const budget = contextBudgetChars()
    const perNote = Math.max(1500, Math.floor(budget / Math.max(found.length, 1)))
    const context = found.map((item: any) => `# ${item.title}\n${stripImages(item.content).slice(0, perNote)}`).join('\n\n')
    result = { answer: await ai.askMyNotes(job.payload.question || '', context, job.payload?.history, model, keyContext), sources: found.map((item: any) => ({ id: item.id, title: item.title })) }
  }
  else if (job.type === 'research') {
    const topic = job.payload?.topic?.trim(); if (!topic) throw new Error('Research topic is missing.')
    const documents = await researchDocuments.getMany(job.user_id, job.payload?.documentIds || [])
    const completedStages: string[] = []
    await jobs.progress(job.id, { stage: 'research', label: 'Preparing web research', completedStages, documentCount: documents.length })
    const started = Date.now()
    const generated = await research({ topic, title: job.payload?.title, depth: job.payload?.depth, reportType: job.payload?.reportType, objective: job.payload?.objective, audience: job.payload?.audience, instructions: job.payload?.instructions, outputFormat: job.payload?.outputFormat, enabledSkills: job.payload?.enabledSkills as any, documentIds: job.payload?.documentIds }, model, keyContext, documents, async (stage, label, artifact, stats) => {
      await researchArtifacts.save(job.id, job.user_id, stage, artifact)
      completedStages.push(stage)
      await jobs.progress(job.id, { stage, label, completedStages: [...completedStages], documentCount: documents.length })
      if (stats) await reportRepository.stage(job.id, job.user_id, stage, started, stats.input, stats.output, stats.status, stats.error)
    })
    const created = await notes.create(job.user_id, { title: generated.title, content: generated.content }, 'research')
    await vectors.upsertVector(created)
    await reportRepository.save(created.id, job.id, job.user_id, { reportType: generated.plan.report_type, objective: generated.plan.objective, audience: generated.plan.target_audience, instructions: job.payload?.instructions || '', outputFormat: generated.outputFormat, plan: generated.plan, quality: generated.quality, revisions: generated.revisions })
    result = { noteId: created.id, title: generated.title, sources: generated.sources.map(({ title: sourceTitle, url }) => ({ title: sourceTitle, url })), stages: completedStages, documentCount: documents.length, quality: generated.quality, outputFormat: generated.outputFormat }
  }
  if (note) await vectors.upsertVector(await notes.get(job.user_id, note.id))
  return result
}

const debugRewrite = () => (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.DEBUG_REWRITE === '1'
// Several loops so one long research report doesn't block everyone else's
// summaries. claim_next_ai_job uses SKIP LOCKED, so loops never grab the same job.
const WORKER_CONCURRENCY = Math.min(8, Math.max(1, Number(globalThis.process?.env?.AI_WORKER_CONCURRENCY) || 2))
let running = false
export function startAiWorker() {
  if (running) return
  running = true
  let lastMaintenance = 0
  for (let worker = 0; worker < WORKER_CONCURRENCY; worker++) void workerLoop(worker === 0)

  async function workerLoop(doesMaintenance: boolean) {
    const loop = async () => {
      try {
        if (doesMaintenance && Date.now() - lastMaintenance > 60_000) { await supabase.rpc('requeue_stuck_ai_jobs'); await jobs.cleanup(); lastMaintenance = Date.now() }
        const { data, error } = await supabase.rpc('claim_next_ai_job')
        if (error) throw error
        const job = (data || [])[0] as AiJob | undefined
        if (job) { try { await jobs.complete(job.id, await process(job)) } catch (error) { await jobs.fail(job.id, error) } }
        setTimeout(loop, job ? 0 : 1000)
      } catch (error) { console.error('AI queue worker error', error); setTimeout(loop, 3000) }
    }
    await loop()
  }
}
