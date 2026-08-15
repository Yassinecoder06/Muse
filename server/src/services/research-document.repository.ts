import { supabase } from '../supabase/client.js'

export type ResearchDocument = { id: string; user_id: string; filename: string; mime: string; size: number; content: string; created_at: string }

export const researchDocuments = {
  async create(userId: string, document: Omit<ResearchDocument, 'id' | 'user_id' | 'created_at'>) {
    const { data, error } = await supabase.from('research_documents').insert({ ...document, user_id: userId }).select().single()
    if (error) throw error
    return data as ResearchDocument
  },
  async getMany(userId: string, ids: string[]) {
    if (!ids.length) return []
    const { data, error } = await supabase.from('research_documents').select().eq('user_id', userId).in('id', ids)
    if (error) throw error
    if ((data || []).length !== ids.length) throw new Error('One or more selected research documents could not be found.')
    const byId = new Map((data || []).map(item => [item.id, item as ResearchDocument]))
    return ids.map(id => byId.get(id)!).filter(Boolean)
  }
}

export const researchArtifacts = {
  async save(jobId: string, userId: string, stage: string, content: string) {
    const { error } = await supabase.from('research_artifacts').upsert({ job_id: jobId, user_id: userId, stage, content: content.slice(0, 100000) }, { onConflict: 'job_id,stage' })
    if (error) throw error
  }
}
