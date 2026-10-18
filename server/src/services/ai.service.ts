import { GoogleGenAI } from '@google/genai'
import { env } from '../utils/env.js'
import { settings } from './settings.repository.js'

export const OLLAMA_CLOUD_URL = 'https://ollama.com'
export const OLLAMA_LOCAL_URL = (env.OLLAMA_EMBEDDING_BASE_URL || 'http://localhost:11434').replace(/\/$/, '')
export const AI_KEY_REQUIRED = 'Add your Gemini API key (or Ollama API key) in Settings to use AI features.'

export const GEMINI_CHAT_MODEL = 'gemini-3.8-flash'
export const GEMINI_FAST_MODEL = 'gemini-3.5-flash-lite'
export const GEMINI_RESEARCH_MODEL = 'gemini-3.1-pro-preview'
export const geminiModels = [GEMINI_CHAT_MODEL, GEMINI_FAST_MODEL, GEMINI_RESEARCH_MODEL]

export const LOCAL_MODEL = 'gemma4-ab-qat:e4b'
export const curatedModels = ['gpt-oss:120b-cloud', 'nemotron-3-super:cloud', 'gemma4:31b-cloud']
export const ALLOWED_MODELS = [...geminiModels, ...curatedModels]

export const cloudModelName = (name: string) => name?.replace(/-cloud$/, '').replace(/:cloud$/, '') || name

export function isGeminiModel(name: string | undefined): boolean {
  if (!name) return false
  return name.startsWith('gemini-') || geminiModels.includes(name)
}

export function isGeminiKey(key: string | undefined): boolean {
  if (!key) return false
  return key.startsWith('AIzaSy') || (key.length >= 35 && !key.includes(':') && !key.includes('/') && !key.includes(' '))
}

export function isCloudModel(name: string | undefined): boolean {
  if (!name) return false
  return isGeminiModel(name) || curatedModels.includes(name) || name.endsWith('-cloud') || name.endsWith(':cloud')
}

type Message = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string }
export type ToolCall = { id: string; function: { name: string; arguments: string | object } }
export type HistoryItem = { role: 'user' | 'assistant'; text: string }

export type KeyContext = string | {
  geminiKey?: string | null
  ollamaKey?: string | null
  userId?: string
}

export function extractKeys(keyContext?: KeyContext): { geminiKey?: string; ollamaKey?: string; userId?: string } {
  if (!keyContext) return {}
  if (typeof keyContext === 'string') {
    if (isGeminiKey(keyContext)) return { geminiKey: keyContext }
    return { ollamaKey: keyContext }
  }
  return {
    geminiKey: keyContext.geminiKey || undefined,
    ollamaKey: keyContext.ollamaKey || undefined,
    userId: keyContext.userId
  }
}

export async function getDefaultLocalModel(): Promise<string> {
  return LOCAL_MODEL
}

export async function resolveModelAndEndpoint(
  requestedModel: string | undefined,
  apiKey: string | undefined
): Promise<{ modelName: string; isCloud: boolean; apiKey?: string }> {
  let selected = requestedModel
  if (!selected) {
    if (apiKey) {
      selected = env.OLLAMA_CHAT_MODEL || 'gemma4:31b-cloud'
    } else {
      selected = LOCAL_MODEL
    }
  }

  if (isCloudModel(selected)) {
    if (!apiKey) {
      throw new Error('Add your API key in Settings to use cloud AI models.')
    }
    return {
      modelName: cloudModelName(selected),
      isCloud: true,
      apiKey
    }
  }

  return {
    modelName: LOCAL_MODEL,
    isCloud: false,
    apiKey: undefined
  }
}

async function queryOllama(path: string, body: unknown, apiKey?: string, method = 'POST') {
  const isCloud = Boolean(apiKey)
  const baseUrl = isCloud ? OLLAMA_CLOUD_URL : OLLAMA_LOCAL_URL
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (isCloud) {
    headers['Authorization'] = `Bearer ${apiKey}`
  }

  let response: Response
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: method === 'GET' ? undefined : JSON.stringify(body)
    })
  } catch {
    if (!isCloud) {
      throw new Error(`Muse could not reach local Ollama at ${baseUrl}. Ensure Ollama is running.`)
    }
    throw new Error('Muse could not reach Ollama Cloud. Check your internet connection.')
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    let detail = ''
    try {
      const parsed = JSON.parse(text)
      detail = String(parsed.error?.message || parsed.error || '')
    } catch {
      detail = text.slice(0, 120)
    }
    if (response.status === 401) throw new Error('Your Ollama API key is invalid or revoked — update it in Settings.')
    if (response.status === 402) throw new Error(`Your Ollama quota is exhausted (402).${detail ? ` ${detail}` : ''} Check Usage in Settings.`)
    if (response.status === 429) throw new Error('Ollama is rate limiting this account right now (429). Try again in a moment.')
    throw new Error(`Ollama request failed: ${response.status}${detail ? ` ${detail}` : ''}`)
  }

  return response.json() as Promise<any>
}

async function callGemini(
  model: string,
  messages: Message[],
  apiKey: string,
  userId?: string,
  taskType = 'general'
): Promise<string> {
  const client = new GoogleGenAI({ apiKey })

  const systemMsg = messages.find(m => m.role === 'system')?.content
  const nonSystem = messages.filter(m => m.role !== 'system')

  const contents = nonSystem.length > 0
    ? nonSystem.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }))
    : [{ role: 'user', parts: [{ text: '' }] }]

  const response = await client.models.generateContent({
    model,
    contents,
    config: systemMsg ? { systemInstruction: systemMsg } : undefined
  })

  const usage = response.usageMetadata
  if (userId && usage) {
    void settings.logAiUsage({
      userId,
      provider: 'gemini',
      model,
      taskType,
      promptTokens: usage.promptTokenCount || 0,
      candidateTokens: usage.candidatesTokenCount || 0,
      totalTokens: usage.totalTokenCount || 0
    })
  }

  return String(response.text || '').trim()
}

export type TaskType = 'lightweight' | 'chat' | 'rewrite' | 'report' | 'general'

export function getAutoRoutedGeminiModel(taskType: TaskType, requestedModel?: string): string {
  if (requestedModel && isGeminiModel(requestedModel)) {
    return requestedModel
  }
  switch (taskType) {
    case 'lightweight':
      return GEMINI_FAST_MODEL // gemini-3.5-flash-lite: highest RPM/RPD on free tier
    case 'report':
      return GEMINI_CHAT_MODEL // gemini-3.8-flash: intelligent and balanced
    case 'chat':
    case 'rewrite':
    default:
      return GEMINI_CHAT_MODEL // gemini-3.8-flash: premier conversational model
  }
}

async function chat(
  messages: Message[],
  model: string | undefined,
  keyContext: KeyContext | undefined,
  taskType: TaskType = 'general'
): Promise<string> {
  const { geminiKey, ollamaKey, userId } = extractKeys(keyContext)

  // 1. Try Gemini first if key is present (Gemini Priority)
  if (geminiKey) {
    const targetGeminiModel = getAutoRoutedGeminiModel(taskType, model)
    try {
      return await callGemini(targetGeminiModel, messages, geminiKey, userId, taskType)
    } catch (err: any) {
      console.warn(`[AI Engine] Gemini API (${targetGeminiModel}) call failed, falling back to Ollama:`, err?.message || err)
      // Fallback below
    }
  }

  // 2. Fallback to Ollama (cloud or local)
  const fallbackModel = isGeminiModel(model) ? undefined : model
  const { modelName, isCloud, apiKey: resolvedOllamaKey } = await resolveModelAndEndpoint(fallbackModel, ollamaKey)

  const data = await queryOllama(
    '/api/chat',
    {
      model: modelName,
      stream: false,
      messages,
      options: { num_ctx: env.OLLAMA_NUM_CTX }
    },
    isCloud ? resolvedOllamaKey : undefined
  )
  return String(data.message?.content || '').trim()
}

export async function complete(
  system: string,
  prompt: string,
  model?: string,
  keyContext?: KeyContext,
  taskType: TaskType = 'general'
): Promise<string> {
  return chat([{ role: 'system', content: system }, { role: 'user', content: prompt }], model, keyContext, taskType)
}

type ToolMessage = { content: string; tool_calls?: ToolCall[] }
export async function chatWithTools(
  messages: Message[],
  tools: unknown,
  model?: string,
  keyContext?: KeyContext
): Promise<ToolMessage> {
  const { geminiKey, ollamaKey, userId } = extractKeys(keyContext)

  // Try Gemini if configured
  if (geminiKey) {
    const targetModel = getAutoRoutedGeminiModel('chat', model)
    try {
      const content = await callGemini(targetModel, messages, geminiKey, userId, 'chat')
      return { content }
    } catch (err) {
      console.warn('[AI Engine] Gemini chatWithTools fallback to Ollama:', err)
    }
  }

  const fallbackModel = isGeminiModel(model) ? undefined : model
  const { modelName, isCloud, apiKey: resolvedKey } = await resolveModelAndEndpoint(fallbackModel, ollamaKey)

  const data = await queryOllama(
    '/api/chat',
    {
      model: modelName,
      stream: false,
      messages,
      tools,
      options: { num_ctx: env.OLLAMA_NUM_CTX }
    },
    isCloud ? resolvedKey : undefined
  )
  return {
    content: String(data.message?.content || ''),
    tool_calls: Array.isArray(data.message?.tool_calls) ? data.message.tool_calls : undefined
  }
}

function jsonArray(value: string) {
  try {
    const parsed = JSON.parse(value.replace(/```json|```/g, '').trim())
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string').slice(0, 6) : []
  } catch {
    return []
  }
}

export const contextBudgetChars = () => Math.min(120_000, env.OLLAMA_NUM_CTX * 4)

function conversation(system: string, context: string, question: string, history: HistoryItem[] = []) {
  const messages: Message[] = [{ role: 'system', content: system }]
  for (const { role, text } of history.slice(-6)) messages.push({ role, content: text.slice(0, 4000) })
  messages.push({ role: 'user', content: `${context}\n\nQUESTION: ${question}` })
  return messages
}

export async function listModels(): Promise<string[]> {
  return ALLOWED_MODELS
}

export async function validateGeminiApiKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const client = new GoogleGenAI({ apiKey })
    await client.models.generateContent({
      model: GEMINI_FAST_MODEL,
      contents: 'ping'
    })
    return { valid: true }
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('API_KEY_INVALID') || msg.includes('400') || msg.includes('401') || msg.includes('403')) {
      return { valid: false, error: 'That Gemini API key was rejected by Google. Verify it at aistudio.google.com/apikey.' }
    }
    return { valid: false, error: msg || 'Could not validate Gemini API key.' }
  }
}

export async function validateApiKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
  if (isGeminiKey(apiKey)) {
    return validateGeminiApiKey(apiKey)
  }

  try {
    await queryOllama('/api/usage', undefined, apiKey, 'GET')
    return { valid: true }
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('invalid or revoked') || msg.includes('401') || msg.includes('invalid credentials')) {
      return { valid: false, error: 'That API key was rejected by Ollama Cloud (401). Verify it at ollama.com/settings/keys.' }
    }
    try {
      const data = await queryOllama('/api/tags', undefined, apiKey, 'GET')
      if (Array.isArray(data?.models)) {
        return { valid: true }
      }
    } catch {}
    return { valid: false, error: msg || 'Could not validate Ollama API key.' }
  }
}

export async function fetchAccountUsage(apiKey: string) {
  const data = await queryOllama('/api/usage', undefined, apiKey, 'GET')
  const limits = data?.limits || {}
  const session = limits.session || {}
  const weekly = limits.weekly || {}
  const toPercent = (value: unknown) => { const n = typeof value === 'number' ? value : Number(value || 0); return Math.round((n > 1 ? n : n * 100) * 10) / 10 }
  const models = (value: unknown) => Array.isArray(value) ? value.map((item: any) => ({ name: String(item?.name || ''), requests: Number(item?.request_count || 0) })).filter(item => item.name) : []
  let plan: string | null = null
  try { const me = await queryOllama('/api/me', {}, apiKey); plan = String(me?.plan || me?.subscription?.plan || '') || null } catch {}
  return { plan, session: { usedPct: toPercent(session.usage), models: models(session.models) }, weekly: { usedPct: toPercent(weekly.usage), models: models(weekly.models) } }
}

let cachedEmbeddingModel: string | null = null
let lastEmbeddingCheck = 0

export async function getEmbeddingModel(): Promise<string> {
  const now = Date.now()
  if (cachedEmbeddingModel && now - lastEmbeddingCheck < 60_000) {
    return cachedEmbeddingModel
  }
  try {
    const res = await fetch(`${OLLAMA_LOCAL_URL}/api/tags`, { method: 'GET' })
    if (res.ok) {
      const data: any = await res.json()
      if (Array.isArray(data.models)) {
        const envMatch = data.models.find((m: any) =>
          m.name === env.OLLAMA_EMBEDDING_MODEL || m.name.startsWith(env.OLLAMA_EMBEDDING_MODEL + ':')
        )
        if (envMatch) {
          cachedEmbeddingModel = envMatch.name
          lastEmbeddingCheck = now
          return envMatch.name
        }
        const embedModel = data.models.find((m: any) =>
          (Array.isArray(m.capabilities) && m.capabilities.includes('embedding')) ||
          m.name.includes('embed')
        )
        if (embedModel) {
          cachedEmbeddingModel = embedModel.name
          lastEmbeddingCheck = now
          return embedModel.name
        }
      }
    }
  } catch {}
  return env.OLLAMA_EMBEDDING_MODEL || 'mxbai-embed-large:latest'
}

export const ai = {
  generateTitle: (content: string, model: string | undefined, keyContext?: KeyContext) =>
    chat([{ role: 'system', content: 'Return only a short, meaningful note title. No punctuation around it.' }, { role: 'user', content }], model, keyContext, 'lightweight'),
  
  async generateTags(content: string, model: string | undefined, keyContext?: KeyContext) {
    return jsonArray(await chat([{ role: 'system', content: 'Return exactly a JSON array of 3 to 6 concise lowercase topic tags. No explanation.' }, { role: 'user', content }], model, keyContext, 'lightweight'))
  },
  
  summarize: (content: string, model: string | undefined, keyContext?: KeyContext) =>
    chat([{ role: 'system', content: 'Summarize the note concisely with Markdown headings: Summary, Key points, Important information, Action items.' }, { role: 'user', content }], model, keyContext, 'lightweight'),
  
  async extractTasks(content: string, model: string | undefined, keyContext?: KeyContext) {
    return jsonArray(await chat([{ role: 'system', content: 'Extract actionable tasks. Return only a JSON string array. Each item must be a concise imperative task.' }, { role: 'user', content }], model, keyContext, 'lightweight'))
  },
  
  rewrite: (content: string, mode: string, model: string | undefined, keyContext?: KeyContext) =>
    chat([{ role: 'system', content: `Rewrite the text in ${mode} mode. Return only the rewritten text. Preserve meaning. Images inside the note are marked as [IMAGE n], each standing exactly where an image belongs. Keep every [IMAGE n] token exactly where it is: never move, reorder, reword, translate, merge, or drop a marker, and never change its number. The number of markers in your output must equal the number in the input. Rewrite only the words around the markers.` }, { role: 'user', content }], model, keyContext, 'rewrite'),
  
  async generateEmbedding(content: string) {
    const model = await getEmbeddingModel()
    const data = await ollamaLocal('/api/embed', { model, input: content.slice(0, 8000) })
    const vector = data.embeddings?.[0] || data.embedding
    if (!Array.isArray(vector)) throw new Error('Ollama returned no embedding')
    return vector as number[]
  },
  
  askCurrentNote: (question: string, note: string, history: HistoryItem[] = [], model?: string, keyContext?: KeyContext) =>
    chat(conversation(
      'You are a precise reading assistant. Answer the question using the supplied note as your primary source and reason about it before replying. Use the conversation history to follow up on earlier questions. If the note does not contain enough to answer, state what is missing in one brief sentence, then answer from general knowledge. Format your response cleanly using concise Markdown with clear section headers (###), bold key terms, and compact bullet lists.',
      `NOTE:\n${note}`, question, history), model, keyContext, 'chat'),
  
  askMyNotes: (question: string, context: string, history: HistoryItem[] = [], model?: string, keyContext?: KeyContext) =>
    chat(conversation(
      'You are an intelligent, articulate research assistant. Use the retrieved notes below as primary evidence. If the retrieved notes are insufficient or do not contain information to answer the question, state that briefly in one friendly sentence (mentioning which notes were checked), then provide a well-structured, comprehensive answer from general knowledge. Format your response cleanly using modern Markdown: use clear section headers (###), compact bullet lists with bold label prefixes (e.g. * **Key:** Details), and highlight key facts. Keep it readable, elegant, and informative.',
      `RETRIEVED NOTES:\n${context}`, question, history), model, keyContext, 'chat')
}

async function ollamaLocal(path: string, body: unknown) {
  const response = await fetch(`${OLLAMA_LOCAL_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Ollama embedding request failed: ${response.status}${text ? ` - ${text}` : ''}`)
  }
  return response.json() as Promise<any>
}
