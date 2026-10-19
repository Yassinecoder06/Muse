import Anthropic from '@anthropic-ai/sdk'
import { env } from '../../utils/env.js'
import { DEFAULT_BASE_URL, type Capability, type ModelInfo, type ProviderKind, type ResolvedProvider } from './types.js'

// Asks each provider which models this key can use, and sorts them into
// chat / embedding / text-to-speech / speech-to-text.

const TIMEOUT_MS = 15_000

export class DiscoveryError extends Error {}

/** Local Ollama as seen from wherever this server runs (localhost in dev, host.docker.internal in Docker). */
export const localOllamaUrl = () => (env.OLLAMA_EMBEDDING_BASE_URL || 'http://localhost:11434').replace(/\/$/, '')

// An empty base URL means "the default for this kind". For local Ollama that
// default is resolved at call time, never stored, so the same provider works
// from the Docker server and from `npm run dev`.
export const baseUrl = (p: { kind: ProviderKind; base_url: string | null }) =>
  (p.base_url || (p.kind === 'ollama_local' ? localOllamaUrl() : DEFAULT_BASE_URL[p.kind]) || '').replace(/\/+$/, '')

async function getJson(url: string, headers: Record<string, string>) {
  let response: Response
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (error) {
    throw new DiscoveryError(`Could not reach ${new URL(url).host}: ${(error as Error).name === 'TimeoutError' ? 'timed out' : 'network error'}.`)
  }
  if (response.status === 401 || response.status === 403) throw new DiscoveryError('The API key was rejected (check it is correct and active).')
  if (!response.ok) throw new DiscoveryError(`${new URL(url).host} answered ${response.status} ${response.statusText}.`)
  return response.json() as Promise<any>
}

/** OpenAI-style model ids → what they do. Unknown ids are treated as chat. */
export function classifyOpenAiModel(id: string): Capability[] {
  const name = id.toLowerCase()
  if (/(dall-e|gpt-image|imagen|image-|moderation|davinci|babbage|realtime|search-preview|sora|computer-use|instruct)/.test(name)) return []
  if (/embed/.test(name)) return ['embedding']
  if (/tts|text-to-speech|speech-/.test(name) && !/speech-to-text/.test(name)) return ['tts']
  if (/whisper|transcribe|speech-to-text|asr/.test(name)) return ['stt']
  if (/audio-preview/.test(name)) return []
  return ['chat']
}

/** Gemini model metadata → what it does. */
export function classifyGeminiModel(model: { name: string; supportedGenerationMethods?: string[] }): Capability[] {
  const id = model.name.replace(/^models\//, '').toLowerCase()
  const methods = model.supportedGenerationMethods || []
  if (methods.includes('embedContent') || methods.includes('embedText')) return ['embedding']
  if (!methods.includes('generateContent')) return [] // live/bidi-only, image-only, etc.
  if (/tts/.test(id)) return ['tts']
  if (/transcribe/.test(id)) return ['stt']
  // Image/music generators, agent products and special-purpose models are not chat models.
  if (/(imagen|image|nano-banana|veo|lyria|aqa|robotics|native-audio|computer-use|antigravity|deep-research)/.test(id)) return []
  // Gemini chat models also accept audio, so they can transcribe; Gemma is text-only.
  return /gemma/.test(id) ? ['chat'] : ['chat', 'stt']
}

const byId = (a: ModelInfo, b: ModelInfo) => a.id.localeCompare(b.id)

async function geminiModels(p: ResolvedProvider): Promise<ModelInfo[]> {
  const out: ModelInfo[] = []
  let pageToken = ''
  do {
    const data = await getJson(`${baseUrl(p)}/v1beta/models?pageSize=1000${pageToken ? `&pageToken=${pageToken}` : ''}`, { 'x-goog-api-key': p.apiKey || '' })
    for (const m of data.models || []) {
      const capabilities = classifyGeminiModel(m)
      if (capabilities.length) out.push({ id: String(m.name).replace(/^models\//, ''), label: m.displayName, capabilities })
    }
    pageToken = data.nextPageToken || ''
  } while (pageToken)
  return out.sort(byId)
}

async function openAiModels(p: ResolvedProvider): Promise<ModelInfo[]> {
  const data = await getJson(`${baseUrl(p)}/models`, p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {})
  const list: any[] = Array.isArray(data.data) ? data.data : Array.isArray(data) ? data : []
  return list
    .map(m => ({ id: String(m.id), capabilities: classifyOpenAiModel(String(m.id)) }))
    .filter(m => m.capabilities.length)
    .sort(byId)
}

async function anthropicModels(p: ResolvedProvider): Promise<ModelInfo[]> {
  const client = new Anthropic({ apiKey: p.apiKey || '', baseURL: baseUrl(p), timeout: TIMEOUT_MS, maxRetries: 0 })
  const out: ModelInfo[] = []
  try {
    for await (const m of client.models.list()) out.push({ id: m.id, label: m.display_name, capabilities: ['chat'] })
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) throw new DiscoveryError('The API key was rejected (check it is correct and active).')
    if (error instanceof Anthropic.APIConnectionError) throw new DiscoveryError(`Could not reach ${new URL(baseUrl(p)).host}.`)
    if (error instanceof Anthropic.APIError) throw new DiscoveryError(`${new URL(baseUrl(p)).host} answered ${error.status}: ${error.message}`)
    throw error
  }
  return out.sort(byId)
}

async function ollamaModels(p: ResolvedProvider): Promise<ModelInfo[]> {
  const headers: Record<string, string> = p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {}
  const data = await getJson(`${baseUrl(p)}/api/tags`, headers)
  const names: string[] = (data.models || []).map((m: any) => String(m.name || m.model)).filter(Boolean)
  // Local Ollama reports real capabilities per model; fall back to the name.
  const capabilitiesOf = async (name: string): Promise<Capability[]> => {
    if (p.kind === 'ollama_local') {
      try {
        const response = await fetch(`${baseUrl(p)}/api/show`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: name }), signal: AbortSignal.timeout(TIMEOUT_MS) })
        const info: any = response.ok ? await response.json() : null
        const caps: string[] = Array.isArray(info?.capabilities) ? info.capabilities : []
        if (caps.length) return caps.includes('embedding') ? ['embedding'] : caps.includes('completion') ? ['chat'] : []
      } catch { /* use the name */ }
    }
    return /embed/i.test(name) ? ['embedding'] : ['chat']
  }
  const models = await Promise.all(names.map(async id => ({ id, capabilities: await capabilitiesOf(id) })))
  return models.filter(m => m.capabilities.length).sort(byId)
}

export async function discoverModels(p: ResolvedProvider): Promise<ModelInfo[]> {
  if (p.kind !== 'ollama_local' && !p.apiKey) throw new DiscoveryError('No API key saved for this provider.')
  switch (p.kind) {
    case 'gemini': return geminiModels(p)
    case 'openai':
    case 'openai_compatible': return openAiModels(p)
    case 'anthropic':
    case 'anthropic_compatible': return anthropicModels(p)
    case 'ollama_cloud':
    case 'ollama_local': return ollamaModels(p)
  }
}

/** Options that need no provider: they run on the Muse server or in the browser/phone. */
export const BUILTIN_MODELS: { ref: string; label: string; capability: Capability; description: string }[] = [
  { ref: 'builtin:edge', label: 'Edge neural voices (free)', capability: 'tts', description: 'Microsoft Edge online voices, synthesized by the Muse server' },
  { ref: 'builtin:browser', label: 'Browser / phone voice', capability: 'tts', description: 'Speech built into your browser or phone, works offline' },
  { ref: 'builtin:browser', label: 'Browser / phone dictation', capability: 'stt', description: 'Speech recognition built into your browser or phone' },
  { ref: 'builtin:default', label: 'Local Ollama (automatic)', capability: 'embedding', description: 'The embedding model Muse finds on local Ollama' }
]
