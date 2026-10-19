import { supabase } from '../supabase/client.js'
import type { SpecializedTemplate } from '../types/index.js'

export const templates = {
  async list(userId: string): Promise<SpecializedTemplate[]> {
    const { data, error } = await supabase
      .from('specialized_templates')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
    if (error) throw error
    return (data || []).map(row => ({
      ...row,
      fields: Array.isArray(row.fields) ? row.fields : []
    }))
  },

  async get(userId: string, id: string): Promise<SpecializedTemplate> {
    const { data, error } = await supabase
      .from('specialized_templates')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single()
    if (error) throw error
    return {
      ...data,
      fields: Array.isArray(data.fields) ? data.fields : []
    }
  },

  async create(
    userId: string,
    input: {
      title: string
      description?: string | null
      fields: { name: string; defaultValue?: string }[]
      ai_instruction?: string | null
      color?: string
      sync_with_calendar?: boolean
    }
  ): Promise<SpecializedTemplate> {
    const { data, error } = await supabase
      .from('specialized_templates')
      .insert({
        user_id: userId,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        fields: input.fields || [],
        ai_instruction: input.ai_instruction?.trim() || null,
        color: input.color || 'blue',
        sync_with_calendar: input.sync_with_calendar ?? false
      })
      .select()
      .single()
    if (error) throw error
    return {
      ...data,
      fields: Array.isArray(data.fields) ? data.fields : []
    }
  },

  async update(
    userId: string,
    id: string,
    input: Partial<{
      title: string
      description?: string | null
      fields: { name: string; defaultValue?: string }[]
      ai_instruction?: string | null
      color?: string
      sync_with_calendar?: boolean
    }>
  ): Promise<SpecializedTemplate> {
    const payload: Record<string, unknown> = {}
    if (input.title !== undefined) payload.title = input.title.trim()
    if (input.description !== undefined) payload.description = input.description?.trim() || null
    if (input.fields !== undefined) payload.fields = input.fields
    if (input.ai_instruction !== undefined) payload.ai_instruction = input.ai_instruction?.trim() || null
    if (input.color !== undefined) payload.color = input.color
    if (input.sync_with_calendar !== undefined) payload.sync_with_calendar = input.sync_with_calendar

    const { data, error } = await supabase
      .from('specialized_templates')
      .update(payload)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single()
    if (error) throw error
    return {
      ...data,
      fields: Array.isArray(data.fields) ? data.fields : []
    }
  },

  async delete(userId: string, id: string): Promise<void> {
    const { error } = await supabase
      .from('specialized_templates')
      .delete()
      .eq('id', id)
      .eq('user_id', userId)
    if (error) throw error
  }
}
