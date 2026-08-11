import { supabase } from '../supabase/client.js'

const CACHE_MS = 60_000
const cache = new Map<string, { key: string; at: number }>()

async function rpc<T>(name: string, params: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, params)
  if (error) throw error
  return data as T
}

export const settings = {
  async getKey(userId: string): Promise<string | null> {
    const hit = cache.get(userId)
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.key || null
    const key = await rpc<string | null>('api_key_get', { p_user_id: userId })
    cache.set(userId, { key: key || '', at: Date.now() })
    return key || null
  },
  async hasKey(userId: string) { return rpc<boolean>('api_key_has', { p_user_id: userId }) },
  async saveKey(userId: string, apiKey: string) { cache.delete(userId); await rpc('api_key_save', { p_user_id: userId, p_api_key: apiKey }) },
  async deleteKey(userId: string) { cache.delete(userId); await rpc('api_key_delete', { p_user_id: userId }) }
}