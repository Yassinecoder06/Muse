import { supabase } from '../../supabase/client.js'
import { settings } from '../settings.repository.js'
import type { ModelInfo, Preferences, Provider, ProviderKind, ResolvedProvider } from './types.js'

const COLUMNS = 'id,user_id,kind,name,base_url,enabled,models,last_fetched_at,last_error,key_hint'
const CACHE_MS = 30_000
const cache = new Map<string, { at: number; providers: ResolvedProvider[]; prefs: Preferences }>()

const emptyPrefs = (): Preferences => ({ chat: [], embedding: null, tts: null, tts_voice: null, stt: null })

function row(data: any): Provider {
  return { ...data, models: Array.isArray(data.models) ? data.models : [] }
}

async function rpc<T>(name: string, params: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, params)
  if (error) throw error
  return data as T
}

export const keyHint = (key: string) => (key.length > 8 ? `…${key.slice(-4)}` : '…')

export const providerRepository = {
  invalidate(userId: string) { cache.delete(userId) },

  async list(userId: string): Promise<Provider[]> {
    const { data, error } = await supabase.from('ai_providers').select(COLUMNS).eq('user_id', userId).order('created_at')
    if (error) throw error
    return (data || []).map(row)
  },

  async get(userId: string, id: string): Promise<Provider> {
    const { data, error } = await supabase.from('ai_providers').select(COLUMNS).eq('id', id).eq('user_id', userId).single()
    if (error) throw error
    return row(data)
  },

  async create(userId: string, input: { kind: ProviderKind; name: string; base_url: string | null; apiKey: string | null }): Promise<Provider> {
    const { data, error } = await supabase.from('ai_providers').insert({
      user_id: userId, kind: input.kind, name: input.name, base_url: input.base_url, key_hint: input.apiKey ? keyHint(input.apiKey) : null
    }).select(COLUMNS).single()
    if (error) throw error
    if (input.apiKey) await rpc('ai_provider_secret_save', { p_provider_id: data.id, p_api_key: input.apiKey })
    this.invalidate(userId)
    return row(data)
  },

  async update(userId: string, id: string, patch: { name?: string; base_url?: string | null; enabled?: boolean; apiKey?: string }): Promise<Provider> {
    const { apiKey, ...fields } = patch
    const values: Record<string, unknown> = { ...fields }
    if (apiKey) values.key_hint = keyHint(apiKey)
    const { data, error } = await supabase.from('ai_providers').update(values).eq('id', id).eq('user_id', userId).select(COLUMNS).single()
    if (error) throw error
    if (apiKey) await rpc('ai_provider_secret_save', { p_provider_id: id, p_api_key: apiKey })
    this.invalidate(userId)
    return row(data)
  },

  async saveModels(userId: string, id: string, models: ModelInfo[], lastError: string | null) {
    const values: Record<string, unknown> = { last_error: lastError, last_fetched_at: new Date().toISOString() }
    if (!lastError) values.models = models // keep the previous list when a fetch fails
    const { error } = await supabase.from('ai_providers').update(values).eq('id', id).eq('user_id', userId)
    if (error) throw error
    this.invalidate(userId)
  },

  async remove(userId: string, id: string) {
    await this.get(userId, id) // ownership
    await rpc('ai_provider_secret_delete', { p_provider_id: id })
    const { error } = await supabase.from('ai_providers').delete().eq('id', id).eq('user_id', userId)
    if (error) throw error
    // Drop references to the removed provider from the defaults.
    const prefs = await this.preferences(userId)
    const keep = (ref: string | null) => (ref && !ref.startsWith(`${id}:`) ? ref : null)
    await this.savePreferences(userId, { chat: prefs.chat.filter(ref => !ref.startsWith(`${id}:`)), embedding: keep(prefs.embedding), tts: keep(prefs.tts), tts_voice: prefs.tts?.startsWith(`${id}:`) ? null : prefs.tts_voice, stt: keep(prefs.stt) })
    this.invalidate(userId)
  },

  async apiKey(providerId: string): Promise<string | null> {
    return (await rpc<string | null>('ai_provider_secret_get', { p_provider_id: providerId })) || null
  },

  async preferences(userId: string): Promise<Preferences> {
    const { data, error } = await supabase.from('ai_preferences').select('chat,embedding,tts,tts_voice,stt').eq('user_id', userId).maybeSingle()
    if (error) throw error
    if (!data) return emptyPrefs()
    return { ...emptyPrefs(), ...data, chat: Array.isArray(data.chat) ? data.chat : [] }
  },

  async savePreferences(userId: string, prefs: Preferences) {
    const { error } = await supabase.from('ai_preferences').upsert({ user_id: userId, ...prefs, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    if (error) throw error
    this.invalidate(userId)
  },

  /** Enabled providers with keys + preferences, cached briefly (hot path). */
  async resolved(userId: string): Promise<{ providers: ResolvedProvider[]; prefs: Preferences }> {
    const hit = cache.get(userId)
    if (hit && Date.now() - hit.at < CACHE_MS) return hit
    const [list, prefs] = await Promise.all([this.list(userId), this.preferences(userId)])
    const providers = await Promise.all(list.filter(p => p.enabled).map(async p => ({ ...p, apiKey: await this.apiKey(p.id).catch(() => null) })))
    const entry = { at: Date.now(), providers, prefs }
    cache.set(userId, entry)
    return entry
  },

  /**
   * First visit after the upgrade: turn the old single Gemini / Ollama Cloud
   * keys into providers so nothing stops working. Runs once (only when the
   * user has no providers yet).
   */
  async importLegacy(userId: string): Promise<boolean> {
    const existing = await this.list(userId)
    if (existing.length) return false
    const [gemini, ollama] = await Promise.all([settings.getGeminiKey(userId).catch(() => null), settings.getKey(userId).catch(() => null)])
    if (gemini) await this.create(userId, { kind: 'gemini', name: 'Google Gemini', base_url: null, apiKey: gemini })
    if (ollama) await this.create(userId, { kind: 'ollama_cloud', name: 'Ollama Cloud', base_url: null, apiKey: ollama })
    // Local Ollama needs no key; add it so its models show up after Fetch.
    await this.create(userId, { kind: 'ollama_local', name: 'Ollama (Local)', base_url: null, apiKey: null })
    return true
  }
}
