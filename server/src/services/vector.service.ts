import { qdrant, COLLECTION } from '../qdrant/client.js'
import { ai } from './ai.service.js'
import { env } from '../utils/env.js'
import { stripImages } from '../utils/images.js'
import type { Note } from '../types/index.js'

function pointId(id: string) { return id }
export const vectors = {
  async upsertVector(note: Note) {
    const vector = await ai.generateEmbedding(`${note.title}\n${note.summary || ''}\n${stripImages(note.content)}`)
    await qdrant.upsert(COLLECTION, { wait: true, points: [{ id: pointId(note.id), vector, payload: { userId: note.user_id, noteId: note.id, title: note.title, summary: note.summary || '', tags: note.tags } }] })
  },
  async deleteVector(noteId: string) { await qdrant.delete(COLLECTION, { wait: true, points: [pointId(noteId)] }) },
  async deleteVectors(noteIds: string[]) { if (!noteIds.length) return; await qdrant.delete(COLLECTION, { wait: true, points: noteIds.map(pointId) }) },
  async searchSimilarNotes(userId: string, question: string, limit = env.RAG_TOP_K) {
    const vector = await ai.generateEmbedding(question)
    const result = await qdrant.search(COLLECTION, { vector, limit, with_payload: true, filter: { must: [{ key: 'userId', match: { value: userId } }] } })
    return result.map(point => String((point.payload as Record<string, unknown>)?.noteId || '')).filter(Boolean)
  }
}
