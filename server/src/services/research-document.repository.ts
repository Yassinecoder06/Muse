import { supabase } from '../supabase/client.js'
import { decrypt, encrypt, isEncrypted } from '../utils/crypto.js'

export type ResearchDocument = { id: string; user_id: string; filename: string; mime: string; size: number; content: string; created_at: string; scan_status?: string; scan_notes?: string }

export const researchDocuments = {
  async create(userId: string, document: Omit<ResearchDocument, 'id' | 'user_id' | 'created_at'>) {
    const { data, error } = await supabase.from('research_documents').insert({ ...document, content: encrypt(userId, document.content), user_id: userId }).select().single()
    if (error) throw error
    return { ...(data as ResearchDocument), content: decrypt(userId, data.content) }
  },
  async getMany(userId: string, ids: string[]) {
    if (!ids.length) return []
    const { data, error } = await supabase.from('research_documents').select().eq('user_id', userId).in('id', ids)
    if (error) throw error
    if ((data || []).length !== ids.length) throw new Error('One or more selected research documents could not be found.')
    const byId = new Map((data || []).map(item => [item.id, { ...(item as ResearchDocument), content: decrypt(userId, item.content) }]))
    return ids.map(id => byId.get(id)!).filter(Boolean)
  }
}

export const researchArtifacts = {
  async save(jobId: string, userId: string, stage: string, content: string) {
    const { error } = await supabase.from('research_artifacts').upsert({ job_id: jobId, user_id: userId, stage, content: encrypt(userId, content.slice(0, 100000)) }, { onConflict: 'job_id,stage' })
    if (error) throw error
  },
  async list(jobId: string, userId: string) {
    const { data, error } = await supabase.from('research_artifacts').select('stage,content,created_at').eq('job_id', jobId).eq('user_id', userId).order('created_at')
    if (error) throw error
    return (data || []).map((item: any) => ({ stage: item.stage, created_at: item.created_at, content: isEncrypted(item.content) ? decrypt(userId, item.content) : item.content }))
  }
}
