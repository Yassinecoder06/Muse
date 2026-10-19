import { qdrant, ensureCollection } from '../qdrant/client.js'
import { ai } from './ai.service.js'
import { env } from '../utils/env.js'
import { encrypt } from '../utils/crypto.js'
import { stripImages } from '../utils/images.js'
import { collectionName, embeddingIdentity, embedFor } from './providers/router.js'
import { notes } from './note.repository.js'
import type { Note } from '../types/index.js'

function pointId(id: string) { return id }

// A chosen embedding model is used strictly: if it fails we report it rather
// than fall back, because mixing two models' vectors in one index silently
// breaks search. With no choice, Muse's original local-Ollama model is used.
async function embedding(userId: string, text: string) {
  return (await embedFor(userId, text)) ?? ai.generateEmbedding(text)
}

const userFilter = (userId: string) => ({ must: [{ key: 'userId', match: { value: userId } }] })

export type ReindexStatus = { running: boolean; total: number; done: number; failed: number; collection: string; error?: string }
const reindexStatus = new Map<string, ReindexStatus>()

export const vectors = {
  /** The Qdrant collection for this user's current embedding model. */
  async collectionFor(userId: string) { return collectionName(await embeddingIdentity(userId)) },

  async upsertVector(note: Note) {
    const collection = await this.collectionFor(note.user_id)
    const vector = await embedding(note.user_id, `${note.title}\n${note.summary || ''}\n${stripImages(note.content)}`)
    await ensureCollection(vector.length, collection)
    await qdrant.upsert(collection, { wait: true, points: [{ id: pointId(note.id), vector, payload: { userId: note.user_id, noteId: note.id, title: encrypt(note.user_id, note.title), summary: encrypt(note.user_id, note.summary || ''), tags: note.tags } }] })
  },

  async deleteVectors(noteIds: string[], userId: string) {
    if (!noteIds.length) return
    // Current collection plus the original one, so switching back finds no ghosts.
    const collections = new Set([await this.collectionFor(userId), 'notes'])
    await Promise.all([...collections].map(c => qdrant.delete(c, { wait: true, points: noteIds.map(pointId) }).catch(() => {})))
  },

  async deleteVector(noteId: string, userId: string) { await this.deleteVectors([noteId], userId) },

  async searchSimilarNotes(userId: string, question: string, limit = env.RAG_TOP_K) {
    const collection = await this.collectionFor(userId)
    const vector = await embedding(userId, question)
    await ensureCollection(vector.length, collection)
    const result = await qdrant.search(collection, { vector, limit, with_payload: true, filter: userFilter(userId) })
    return result.map(point => String((point.payload as Record<string, unknown>)?.noteId || '')).filter(Boolean)
  },

  reindexStatus(userId: string) { return reindexStatus.get(userId) ?? null },

  /**
   * Rebuilds the user's index with their current embedding model (after they
   * change it). Runs in the background; progress via reindexStatus().
   */
  async reindexUser(userId: string) {
    if (reindexStatus.get(userId)?.running) return
    const collection = await this.collectionFor(userId)
    const status: ReindexStatus = { running: true, total: 0, done: 0, failed: 0, collection }
    reindexStatus.set(userId, status)
    try {
      // Clear this user's old points in the target collection (notes deleted
      // since it was last used), then embed everything again.
      await qdrant.delete(collection, { wait: true, filter: userFilter(userId) }).catch(() => {})
      const all = [...await notes.list(userId, 'all'), ...await notes.list(userId, 'archive')]
      status.total = all.length
      for (const note of all) {
        try { await this.upsertVector(note) } catch (error) {
          status.failed++
          status.error = (error as Error).message
        }
        status.done++
      }
    } catch (error) {
      status.error = (error as Error).message
    } finally {
      status.running = false
    }
  }
}
