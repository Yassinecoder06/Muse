import { QdrantClient } from '@qdrant/js-client-rest'
import { env } from '../utils/env.js'
export const qdrant = new QdrantClient({ url: env.QDRANT_URL })
export const COLLECTION = 'notes'
// Vector reads/writes call this on every request; after the first success for
// a dimension it is a no-op instead of 2-3 extra Qdrant round-trips.
let readyDimension: number | null = null
export async function ensureCollection(dim = 1024) {
  if (readyDimension === dim) return
  const collections = await qdrant.getCollections()
  const exists = collections.collections.some(c => c.name === COLLECTION)
  if (exists) {
    const info = await qdrant.getCollection(COLLECTION).catch(() => null)
    const existingSize = (info?.config?.params?.vectors as any)?.size
    if (existingSize && existingSize !== dim && (info?.points_count ?? 0) === 0) {
      await qdrant.deleteCollection(COLLECTION).catch(() => {})
      await qdrant.createCollection(COLLECTION, { vectors: { size: dim, distance: 'Cosine' } })
    }
  } else {
    await qdrant.createCollection(COLLECTION, { vectors: { size: dim, distance: 'Cosine' } })
  }
  await qdrant.createPayloadIndex(COLLECTION, { field_name: 'userId', field_schema: 'keyword', wait: true }).catch(error => { if (!String(error).includes('already exists')) throw error })
  readyDimension = dim
}
