import { env } from '../utils/env.js'

export const OLLAMA_CLOUD_URL = 'https://ollama.com'
export const AI_KEY_REQUIRED = 'Add your Ollama API key in Settings to use AI features.'
export const curatedModels = ['gpt-oss:120b-cloud', 'nemotron-3-super:cloud', 'gemma4:31b-cloud']
export const cloudModelName = (name: string) => name?.replace(/-cloud$/, '').replace(/:cloud$/, '') || name

type Message = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string }
export type ToolCall = { id: string; function: { name: string; arguments: string | object } }
export type HistoryItem = { role: 'user' | 'assistant'; text: string }

async function ollama(path: string, body: unknown, apiKey: string, method = 'POST') {
  let response: Response
  try {
    response = await fetch(`${OLLAMA_CLOUD_URL}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: method === 'GET' ? undefined : JSON.stringify(body) })
  } catch { throw new Error('Muse could not reach Ollama Cloud. Check your internet connection.') }
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    let detail = ''
    try { const parsed = JSON.parse(text); detail = String(parsed.error?.message || parsed.error || '') } catch { detail = text.slice(0, 120) }
    if (response.status === 401) throw new Error('Your Ollama API key is invalid or revoked — update it in Settings.')
    if (response.status === 402) throw new Error(`Your Ollama quota is exhausted (402).${detail ? ` ${detail}` : ''} Check Usage in Settings.`)
    if (response.status === 429) throw new Error('Ollama is rate limiting this account right now (429). Try again in a moment.')
    throw new Error(`Ollama request failed: ${response.status}${detail ? ` ${detail}` : ''}`)
  }
  return response.json() as Promise<any>
}
function requireKey(apiKey?: string) { if (!apiKey) throw new Error(AI_KEY_REQUIRED); return apiKey }
async function chat(messages: Message[], model: string | undefined, apiKey: string | undefined) {
  const key = requireKey(apiKey)
  const data = await ollama('/api/chat', { model: cloudModelName(model || env.OLLAMA_CHAT_MODEL), stream: false, messages, options: { num_ctx: env.OLLAMA_NUM_CTX } }, key)
  return String(data.message?.content || '').trim()
}
export async function complete(system: string, prompt: string, model?: string, apiKey?: string) {
  return chat([{ role: 'system', content: system }, { role: 'user', content: prompt }], model, apiKey)
}
type ToolMessage = { content: string; tool_calls?: ToolCall[] }
export async function chatWithTools(messages: Message[], tools: unknown, model?: string, apiKey?: string): Promise<ToolMessage> {
  const key = requireKey(apiKey)
  const data = await ollama('/api/chat', { model: cloudModelName(model || env.OLLAMA_CHAT_MODEL), stream: false, messages, tools, options: { num_ctx: env.OLLAMA_NUM_CTX } }, key)
  return { content: String(data.message?.content || ''), tool_calls: Array.isArray(data.message?.tool_calls) ? data.message.tool_calls : undefined }
}
function jsonArray(value: string) { try { const parsed = JSON.parse(value.replace(/```json|```/g, '').trim()); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string').slice(0, 6) : [] } catch { return [] } }
export const contextBudgetChars = () => Math.min(120_000, env.OLLAMA_NUM_CTX * 4)
function conversation(system: string, context: string, question: string, history: HistoryItem[] = []) {
  const messages: Message[] = [{ role: 'system', content: system }]
  for (const { role, text } of history.slice(-6)) messages.push({ role, content: text.slice(0, 4000) })
  messages.push({ role: 'user', content: `${context}\n\nQUESTION: ${question}` })
  return messages
}
export function listModels() { return curatedModels }
export async function validateApiKey(apiKey: string) {
  try {
    const data = await ollama('/api/tags', undefined, apiKey, 'GET')
    return Array.isArray(data?.models)
  } catch { return false }
}
export async function fetchAccountUsage(apiKey: string) {
  const data = await ollama('/api/usage', undefined, apiKey, 'GET')
  const limits = data?.limits || {}
  const session = limits.session || {}
  const weekly = limits.weekly || {}
  const toPercent = (value: unknown) => { const n = typeof value === 'number' ? value : Number(value || 0); return Math.round((n > 1 ? n : n * 100) * 10) / 10 }
  const models = (value: unknown) => Array.isArray(value) ? value.map((item: any) => ({ name: String(item?.name || ''), requests: Number(item?.request_count || 0) })).filter(item => item.name) : []
  let plan: string | null = null
  try { const me = await ollama('/api/me', {}, apiKey); plan = String(me?.plan || me?.subscription?.plan || '') || null } catch { }
  return { plan, session: { usedPct: toPercent(session.usage), models: models(session.models) }, weekly: { usedPct: toPercent(weekly.usage), models: models(weekly.models) } }
}
export const ai = {
  generateTitle: (content: string, model: string | undefined, apiKey?: string) => chat([{ role: 'system', content: 'Return only a short, meaningful note title. No punctuation around it.' }, { role: 'user', content }], model, apiKey),
  async generateTags(content: string, model: string | undefined, apiKey?: string) { return jsonArray(await chat([{ role: 'system', content: 'Return exactly a JSON array of 3 to 6 concise lowercase topic tags. No explanation.' }, { role: 'user', content }], model, apiKey)) },
  summarize: (content: string, model: string | undefined, apiKey?: string) => chat([{ role: 'system', content: 'Summarize the note concisely with Markdown headings: Summary, Key points, Important information, Action items.' }, { role: 'user', content }], model, apiKey),
  async extractTasks(content: string, model: string | undefined, apiKey?: string) { return jsonArray(await chat([{ role: 'system', content: 'Extract actionable tasks. Return only a JSON string array. Each item must be a concise imperative task.' }, { role: 'user', content }], model, apiKey)) },
  rewrite: (content: string, mode: string, model: string | undefined, apiKey?: string) => chat([{ role: 'system', content: `Rewrite the text in ${mode} mode. Return only the rewritten text. Preserve meaning. Images inside the note are marked as [IMAGE n], each standing exactly where an image belongs. Keep every [IMAGE n] token exactly where it is: never move, reorder, reword, translate, merge, or drop a marker, and never change its number. The number of markers in your output must equal the number in the input. Rewrite only the words around the markers.` }, { role: 'user', content }], model, apiKey),
  async generateEmbedding(content: string) { const data = await ollamaLocal('/api/embed', { model: env.OLLAMA_EMBEDDING_MODEL, input: content.slice(0, 8000) }); const vector = data.embeddings?.[0] || data.embedding; if (!Array.isArray(vector)) throw new Error('Ollama returned no embedding'); return vector as number[] },
  askCurrentNote: (question: string, note: string, history: HistoryItem[] = [], model?: string, apiKey?: string) => chat(conversation(
    'You are a precise reading assistant. Answer the question using the supplied note as your primary source and reason about it before replying. Use the conversation history to follow up on earlier questions. If the note does not contain enough to answer, state exactly what is missing, then answer from general knowledge — clearly label what comes from the note versus what is inferred. Be direct and structured.',
    `NOTE:\n${note}`, question, history), model, apiKey),
  askMyNotes: (question: string, context: string, history: HistoryItem[] = [], model?: string, apiKey?: string) => chat(conversation(
    'You are a research assistant. Use the retrieved notes below as the primary evidence and reason across them, using the conversation history to continue. Mention the titles of the notes you used. If the notes are insufficient or the question goes beyond them, say so, then fill gaps from general knowledge — always label what comes from your notes versus what is inferred or general. If no notes were retrieved, say so and answer from general knowledge. Be conversational, concise, and precise.',
    `RETRIEVED NOTES:\n${context}`, question, history), model, apiKey)
}

async function ollamaLocal(path: string, body: unknown) {
  const response = await fetch(`${env.OLLAMA_EMBEDDING_BASE_URL.replace(/\/$/, '')}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error(`Ollama embedding request failed: ${response.status}`)
  return response.json() as Promise<any>
}
