import { env } from '../utils/env.js'

type Message = { role: 'system' | 'user'; content: string }
async function ollama(baseUrl: string, path: string, body: unknown, apiKey?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
  if (!response.ok) throw new Error(`Ollama request failed: ${response.status}`)
  return response.json() as Promise<any>
}
async function chat(messages: Message[]) {
  const apiKey = new URL(env.OLLAMA_BASE_URL).hostname.endsWith('ollama.com') ? env.OLLAMA_API_KEY : undefined
  const data = await ollama(env.OLLAMA_BASE_URL, '/api/chat', { model: env.OLLAMA_CHAT_MODEL, stream: false, messages }, apiKey)
  return String(data.message?.content || '').trim()
}
function jsonArray(value: string) { try { const parsed = JSON.parse(value.replace(/```json|```/g, '').trim()); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string').slice(0, 6) : [] } catch { return [] } }
export const ai = {
  generateTitle: (content: string) => chat([{ role: 'system', content: 'Return only a short, meaningful note title. No punctuation around it.' }, { role: 'user', content }]),
  async generateTags(content: string) { return jsonArray(await chat([{ role: 'system', content: 'Return exactly a JSON array of 3 to 6 concise lowercase topic tags. No explanation.' }, { role: 'user', content }])) },
  summarize: (content: string) => chat([{ role: 'system', content: 'Summarize the note concisely with Markdown headings: Summary, Key points, Important information, Action items.' }, { role: 'user', content }]),
  extractTasks: async (content: string) => jsonArray(await chat([{ role: 'system', content: 'Extract actionable tasks. Return only a JSON string array. Each item must be a concise imperative task.' }, { role: 'user', content }])),
  rewrite: (content: string, mode: string) => chat([{ role: 'system', content: `Rewrite the text in ${mode} mode. Return only the rewritten text. Preserve meaning.` }, { role: 'user', content }]),
  async generateEmbedding(content: string) { const data = await ollama(env.OLLAMA_EMBEDDING_BASE_URL, '/api/embed', { model: env.OLLAMA_EMBEDDING_MODEL, input: content.slice(0, 8000) }); const vector = data.embeddings?.[0] || data.embedding; if (!Array.isArray(vector)) throw new Error('Ollama returned no embedding'); return vector as number[] },
  askCurrentNote: (question: string, note: string) => chat([{ role: 'system', content: 'Answer only from the supplied note. If the answer is not in it, say so plainly.' }, { role: 'user', content: `NOTE:\n${note}\n\nQUESTION: ${question}` }]),
  askMyNotes: (question: string, context: string) => chat([{ role: 'system', content: 'Answer only from the retrieved notes below. Mention the titles of notes you used. Do not claim knowledge outside this context.' }, { role: 'user', content: `RETRIEVED NOTES:\n${context}\n\nQUESTION: ${question}` }])
}
