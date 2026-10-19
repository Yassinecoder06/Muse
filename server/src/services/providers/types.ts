// Bring-your-own AI providers: shared types.

export const PROVIDER_KINDS = ['gemini', 'openai', 'anthropic', 'ollama_cloud', 'ollama_local', 'openai_compatible', 'anthropic_compatible'] as const
export type ProviderKind = (typeof PROVIDER_KINDS)[number]

export type Capability = 'chat' | 'embedding' | 'tts' | 'stt'

export type ModelInfo = { id: string; label?: string; capabilities: Capability[] }

export type Provider = {
  id: string
  user_id: string
  kind: ProviderKind
  name: string
  base_url: string | null
  enabled: boolean
  models: ModelInfo[]
  last_fetched_at: string | null
  last_error: string | null
  key_hint: string | null
}

export type Preferences = {
  chat: string[] // model refs, first = default, rest = fallbacks in order
  embedding: string | null
  tts: string | null
  tts_voice: string | null
  stt: string | null
}

/** A provider plus its decrypted key, ready to call. */
export type ResolvedProvider = Provider & { apiKey: string | null }

/** "<provider id>:<model id>" or "builtin:<name>". Model ids may contain ':'. */
export function parseRef(ref: string): { providerId: string; model: string } | null {
  const index = ref.indexOf(':')
  if (index <= 0 || index === ref.length - 1) return null
  return { providerId: ref.slice(0, index), model: ref.slice(index + 1) }
}

export const makeRef = (providerId: string, model: string) => `${providerId}:${model}`

export const NEEDS_KEY: Record<ProviderKind, boolean> = {
  gemini: true, openai: true, anthropic: true, ollama_cloud: true, ollama_local: false, openai_compatible: true, anthropic_compatible: true
}

export const DEFAULT_BASE_URL: Partial<Record<ProviderKind, string>> = {
  gemini: 'https://generativelanguage.googleapis.com',
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  ollama_cloud: 'https://ollama.com'
}

export const KIND_LABEL: Record<ProviderKind, string> = {
  gemini: 'Google Gemini',
  openai: 'OpenAI',
  anthropic: 'Anthropic (Claude)',
  ollama_cloud: 'Ollama Cloud',
  ollama_local: 'Ollama (Local)',
  openai_compatible: 'OpenAI-compatible',
  anthropic_compatible: 'Anthropic-compatible'
}
