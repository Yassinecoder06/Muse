import { qdrant } from '../qdrant/client.js'
import { vectors } from './vector.service.js'
import { notes } from './note.repository.js'

export type GraphNode = { id: string; title: string; kind: string; tags: string[]; updated_at: string }
export type GraphEdge = { source: string; target: string; strength: number; reason: 'similar' | 'tag' | 'both' }
export type GraphData = { nodes: GraphNode[]; edges: GraphEdge[] }

// The graph is derived, never stored: edges come from the note embeddings that
// already live in Qdrant (cosine similarity between points) plus shared tags.
// This keeps it in sync with the RAG pipeline — the same vectors that power
// "Ask my notes" define which dots connect here.
const SIMILARITY_THRESHOLD = 0.72
const MAX_NODES = 200
const MAX_SIMILAR_EDGES_PER_NODE = 5
const MAX_EDGES = 400
const CACHE_TTL_MS = 30_000
const cache = new Map<string, { at: number; data: GraphData }>()

function cosine(a: number[], b: number[]) {
  let dot = 0; let na = 0; let nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  if (!na || !nb) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

async function userVectors(userId: string) {
  const found = new Map<string, number[]>()
  const collection = await vectors.collectionFor(userId)
  let offset: string | number | undefined
  do {
    // A new embedding model's collection may not exist until its first re-index.
    const page = await qdrant.scroll(collection, { filter: { must: [{ key: 'userId', match: { value: userId } }] }, with_vector: true, limit: 100, ...(offset !== undefined ? { offset } : {}) }).catch(() => null)
    if (!page) return found
    for (const point of page.points) {
      const noteId = String((point.payload as Record<string, unknown>)?.noteId || point.id || '')
      const vector = Array.isArray(point.vector) ? point.vector as number[] : []
      if (noteId && vector.length) found.set(noteId, vector)
    }
    const next = page.next_page_offset
    offset = typeof next === 'string' || typeof next === 'number' ? next : undefined
  } while (offset !== undefined)
  return found
}

export async function graph(userId: string): Promise<GraphData> {
  const cached = cache.get(userId)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data
  const list = await notes.list(userId, 'all')
  const selected = list.slice(0, MAX_NODES)
  const nodes: GraphNode[] = selected.map(note => ({ id: note.id, title: note.title || 'Untitled note', kind: note.kind, tags: note.tags, updated_at: note.updated_at }))
  const edges = new Map<string, GraphEdge>()
  if (nodes.length > 1) {
    const vectors = await userVectors(userId)
    const pairKey = (a: string, b: string) => a < b ? `${a}|${b}` : `${b}|${a}`
    // Similarity edges from the stored Qdrant points.
    for (let i = 0; i < nodes.length; i++) {
      const a = vectors.get(nodes[i].id)
      if (!a) continue
      const candidates: { other: GraphNode; score: number }[] = []
      for (let j = i + 1; j < nodes.length; j++) {
        const b = vectors.get(nodes[j].id)
        if (!b) continue
        const score = cosine(a, b)
        if (score >= SIMILARITY_THRESHOLD) candidates.push({ other: nodes[j], score })
      }
      candidates.sort((x, y) => y.score - x.score)
      for (const { other, score } of candidates.slice(0, MAX_SIMILAR_EDGES_PER_NODE)) {
        const source = nodes[i]; const target = other; const key = pairKey(source.id, target.id)
        if (edges.size >= MAX_EDGES) break
        const existing = edges.get(key)
        edges.set(key, existing ? { ...existing, strength: Math.max(existing.strength, score), reason: 'both' } : { source: source.id, target: target.id, strength: score, reason: 'similar' })
      }
    }
    // Tag edges: notes in the same collection are conceptually linked.
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const shared = nodes[i].tags.filter(tag => nodes[j].tags.includes(tag)).length
        if (!shared || edges.size >= MAX_EDGES) continue
        const key = pairKey(nodes[i].id, nodes[j].id)
        const strength = Math.min(0.6, 0.25 * shared)
        const existing = edges.get(key)
        edges.set(key, existing ? { ...existing, strength: Math.max(existing.strength, Math.min(1, existing.strength + 0.15)), reason: 'both' } : { source: nodes[i].id, target: nodes[j].id, strength, reason: 'tag' })
      }
    }
  }
  const data = { nodes, edges: [...edges.values()] }
  cache.set(userId, { at: Date.now(), data })
  return data
}
