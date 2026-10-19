import { QdrantClient } from '@qdrant/js-client-rest'
import { env } from '../utils/env.js'
export const qdrant = new QdrantClient({ url: env.QDRANT_URL })
export const COLLECTION = 'notes'
// Vector reads/writes call this on every request; after the first success for
// a collection + dimension it is a no-op instead of 2-3 extra round-trips.
// Each embedding model has its own collection (vectors from different models
// are not comparable); 'notes' is Muse's original one.
const ready = new Map<string, number>()
export async function ensureCollection(dim = 1024, name = COLLECTION) {
  if (ready.get(name) === dim) return
  const collections = await qdrant.getCollections()
  const exists = collections.collections.some(c => c.name === name)
  if (exists) {
    const info = await qdrant.getCollection(name).catch(() => null)
    const existingSize = (info?.config?.params?.vectors as any)?.size
    if (existingSize && existingSize !== dim && (info?.points_count ?? 0) === 0) {
      await qdrant.deleteCollection(name).catch(() => {})
      await qdrant.createCollection(name, { vectors: { size: dim, distance: 'Cosine' } })
    }
  } else {
    await qdrant.createCollection(name, { vectors: { size: dim, distance: 'Cosine' } })
  }
  await qdrant.createPayloadIndex(name, { field_name: 'userId', field_schema: 'keyword', wait: true }).catch(error => { if (!String(error).includes('already exists')) throw error })
  ready.set(name, dim)
}
