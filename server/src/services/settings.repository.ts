import { supabase } from '../supabase/client.js'

const CACHE_MS = 60_000
const cache = new Map<string, { key: string; at: number }>()
const geminiCache = new Map<string, { key: string; at: number }>()

async function rpc<T>(name: string, params: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, params)
  if (error) throw error
  return data as T
}

export type AiUsageRecord = {
  userId: string
  provider: string
  model: string
  taskType?: string
  promptTokens: number
  candidateTokens: number
  totalTokens: number
}

export type GeminiDailyUsage = {
  provider: string
  requestsToday: number
  dailyLimit: number
  promptTokens: number
  candidateTokens: number
  totalTokens: number
  models: { name: string; requests: number; tokens: number }[]
  resetUtc: string
}

export const settings = {
  // --- Ollama Key ---
  async getKey(userId: string): Promise<string | null> {
    const hit = cache.get(userId)
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.key || null
    const key = await rpc<string | null>('api_key_get', { p_user_id: userId })
    cache.set(userId, { key: key || '', at: Date.now() })
    return key || null
  },
  async hasKey(userId: string) { return rpc<boolean>('api_key_has', { p_user_id: userId }) },
  async saveKey(userId: string, apiKey: string) { cache.delete(userId); await rpc('api_key_save', { p_user_id: userId, p_api_key: apiKey }) },
  async deleteKey(userId: string) { cache.delete(userId); await rpc('api_key_delete', { p_user_id: userId }) },

  // --- Gemini Key ---
  async getGeminiKey(userId: string): Promise<string | null> {
    const hit = geminiCache.get(userId)
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.key || null
    let key = await rpc<string | null>('gemini_api_key_get', { p_user_id: userId }).catch(() => null)
    if (!key) {
      try {
        const { data } = await supabase
          .from('ai_providers')
          .select('id')
          .eq('user_id', userId)
          .eq('kind', 'gemini')
          .eq('enabled', true)
          .limit(1)
          .maybeSingle()
        if (data?.id) {
          key = (await rpc<string | null>('ai_provider_secret_get', { p_provider_id: data.id }).catch(() => null)) || null
        }
      } catch {}
    }
    geminiCache.set(userId, { key: key || '', at: Date.now() })
    return key || null
  },
  async hasGeminiKey(userId: string) {
    const key = await this.getGeminiKey(userId)
    return Boolean(key)
  },
  async saveGeminiKey(userId: string, apiKey: string) { geminiCache.delete(userId); await rpc('gemini_api_key_save', { p_user_id: userId, p_api_key: apiKey }) },
  async deleteGeminiKey(userId: string) { geminiCache.delete(userId); await rpc('gemini_api_key_delete', { p_user_id: userId }) },

  // --- Provider resolution ---
  async getEffectiveAiKeys(userId: string): Promise<{ geminiKey: string | null; ollamaKey: string | null }> {
    const [geminiKey, ollamaKey] = await Promise.all([
      this.getGeminiKey(userId).catch(() => null),
      this.getKey(userId).catch(() => null)
    ])
    return { geminiKey, ollamaKey }
  },

  // --- Usage Logging & Retrieval ---
  async logAiUsage(data: AiUsageRecord): Promise<void> {
    try {
      await supabase.from('ai_usage_logs').insert({
        user_id: data.userId,
        provider: data.provider,
        model: data.model,
        task_type: data.taskType || 'general',
        prompt_tokens: data.promptTokens,
        candidate_tokens: data.candidateTokens,
        total_tokens: data.totalTokens
      })
    } catch (err) {
      console.error('Failed to log AI usage:', err)
    }
  },

  async getAiDailyUsage(userId: string, provider = 'gemini'): Promise<GeminiDailyUsage> {
    return rpc<GeminiDailyUsage>('get_ai_daily_usage', { p_user_id: userId, p_provider: provider })
  }
}