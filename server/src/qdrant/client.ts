import { QdrantClient } from '@qdrant/js-client-rest'
import { env } from '../utils/env.js'
export const qdrant = new QdrantClient({ url: env.QDRANT_URL })
export const COLLECTION = 'notes'
export async function ensureCollection() {
  const collections = await qdrant.getCollections()
  if (!collections.collections.some(c => c.name === COLLECTION)) await qdrant.createCollection(COLLECTION, { vectors: { size: 768, distance: 'Cosine' } })
  await qdrant.createPayloadIndex(COLLECTION, { field_name: 'userId', field_schema: 'keyword', wait: true }).catch(error => { if (!String(error).includes('already exists')) throw error })
}
