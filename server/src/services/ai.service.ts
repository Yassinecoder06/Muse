import { env } from '../utils/env.js'

type Message = { role: 'system' | 'user' | 'assistant'; content: string }
export type HistoryItem = { role: 'user' | 'assistant'; text: string }
async function ollama(baseUrl: string, path: string, body: unknown, apiKey?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
  if (!response.ok) throw new Error(`Ollama request failed: ${response.status}`)
  return response.json() as Promise<any>
}
async function chat(messages: Message[]) {
  const apiKey = new URL(env.OLLAMA_BASE_URL).hostname.endsWith('ollama.com') ? env.OLLAMA_API_KEY : undefined
  const data = await ollama(env.OLLAMA_BASE_URL, '/api/chat', { model: env.OLLAMA_CHAT_MODEL, stream: false, messages, options: { num_ctx: env.OLLAMA_NUM_CTX } }, apiKey)
  return String(data.message?.content || '').trim()
}
function jsonArray(value: string) { try { const parsed = JSON.parse(value.replace(/```json|```/g, '').trim()); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string').slice(0, 6) : [] } catch { return [] } }
export const contextBudgetChars = () => Math.min(120_000, env.OLLAMA_NUM_CTX * 4)
function conversation(system: string, context: string, question: string, history: HistoryItem[] = []) {
  const messages: Message[] = [{ role: 'system', content: system }]
  for (const { role, text } of history.slice(-6)) messages.push({ role, content: text.slice(0, 4000) })
  messages.push({ role: 'user', content: `${context}\n\nQUESTION: ${question}` })
  return messages
}
export const ai = {
  generateTitle: (content: string) => chat([{ role: 'system', content: 'Return only a short, meaningful note title. No punctuation around it.' }, { role: 'user', content }]),
  async generateTags(content: string) { return jsonArray(await chat([{ role: 'system', content: 'Return exactly a JSON array of 3 to 6 concise lowercase topic tags. No explanation.' }, { role: 'user', content }])) },
  summarize: (content: string) => chat([{ role: 'system', content: 'Summarize the note concisely with Markdown headings: Summary, Key points, Important information, Action items.' }, { role: 'user', content }]),
  extractTasks: async (content: string) => jsonArray(await chat([{ role: 'system', content: 'Extract actionable tasks. Return only a JSON string array. Each item must be a concise imperative task.' }, { role: 'user', content }])),
  rewrite: (content: string, mode: string) => chat([{ role: 'system', content: `Rewrite the text in ${mode} mode. Return only the rewritten text. Preserve meaning. Images inside the note are marked as [IMAGE n]. Keep every image marker verbatim in the rewritten text, in the position where the image belongs. Never invent, drop, merge, or duplicate image markers.` }, { role: 'user', content }]),
  async generateEmbedding(content: string) { const data = await ollama(env.OLLAMA_EMBEDDING_BASE_URL, '/api/embed', { model: env.OLLAMA_EMBEDDING_MODEL, input: content.slice(0, 8000) }); const vector = data.embeddings?.[0] || data.embedding; if (!Array.isArray(vector)) throw new Error('Ollama returned no embedding'); return vector as number[] },
  askCurrentNote: (question: string, note: string, history: HistoryItem[] = []) => chat(conversation(
    'You are a precise reading assistant. Answer the question using the supplied note as your primary source and reason about it before replying. Use the conversation history to follow up on earlier questions. If the note does not contain enough to answer, state exactly what is missing, then answer from general knowledge — clearly label what comes from the note versus what is inferred. Be direct and structured.',
    `NOTE:\n${note}`, question, history)),
  askMyNotes: (question: string, context: string, history: HistoryItem[] = []) => chat(conversation(
    'You are a research assistant. Use the retrieved notes below as the primary evidence and reason across them, using the conversation history to continue. Mention the titles of the notes you used. If the notes are insufficient or the question goes beyond them, say so, then fill gaps from general knowledge — always label what comes from your notes versus what is inferred or general. If no notes were retrieved, say so and answer from general knowledge. Be conversational, concise, and precise.',
    `RETRIEVED NOTES:\n${context}`, question, history))
}
