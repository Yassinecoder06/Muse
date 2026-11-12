import type { GraphData, GraphEdge, GraphNode } from '../types'

export type NodeKindFilter = 'note' | 'specialized' | 'research'
export type UpdatedRangeFilter = '7d' | '30d' | '90d' | 'all' | 'custom'
export type EdgeTypeFilter = 'similar' | 'tag'
export type ColorByOption = 'kind' | 'tag' | 'age'
export type SizeByOption = 'connections' | 'length'
export type LabelsModeOption = 'always' | 'hover' | 'off'

export interface GraphFiltersState {
  kinds: NodeKindFilter[]
  tags: string[]
  tagMatchMode: 'any' | 'all'
  updatedRange: UpdatedRangeFilter
  customDateStart?: string
  customDateEnd?: string
  edgeTypes: EdgeTypeFilter[]
  minSimilarity: number
  hideOrphans: boolean
  minConnections: number
  favoritesOnly: boolean
  includeArchived: boolean
  colorBy: ColorByOption
  sizeBy: SizeByOption
  labelsMode: LabelsModeOption
}

export const DEFAULT_GRAPH_FILTERS: GraphFiltersState = {
  kinds: ['note', 'specialized', 'research'],
  tags: [],
  tagMatchMode: 'any',
  updatedRange: 'all',
  edgeTypes: ['similar', 'tag'],
  minSimilarity: 0.72,
  hideOrphans: false,
  minConnections: 0,
  favoritesOnly: false,
  includeArchived: false,
  colorBy: 'kind',
  sizeBy: 'connections',
  labelsMode: 'hover'
}

const STORAGE_KEY = 'muse-graph-filters'

export function getDefaultFilters(): GraphFiltersState {
  return { ...DEFAULT_GRAPH_FILTERS, kinds: [...DEFAULT_GRAPH_FILTERS.kinds], tags: [], edgeTypes: [...DEFAULT_GRAPH_FILTERS.edgeTypes] }
}

export function loadFiltersFromStorage(): GraphFiltersState {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
    if (!raw) return getDefaultFilters()
    const parsed = JSON.parse(raw) as Partial<GraphFiltersState>
    return {
      ...getDefaultFilters(),
      ...parsed,
      kinds: Array.isArray(parsed.kinds) && parsed.kinds.length > 0 ? (parsed.kinds as NodeKindFilter[]) : DEFAULT_GRAPH_FILTERS.kinds,
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      edgeTypes: Array.isArray(parsed.edgeTypes) && parsed.edgeTypes.length > 0 ? (parsed.edgeTypes as EdgeTypeFilter[]) : DEFAULT_GRAPH_FILTERS.edgeTypes,
      minSimilarity: typeof parsed.minSimilarity === 'number' && !isNaN(parsed.minSimilarity) ? Math.max(0.55, Math.min(1, parsed.minSimilarity)) : DEFAULT_GRAPH_FILTERS.minSimilarity
    }
  } catch {
    return getDefaultFilters()
  }
}

export function saveFiltersToStorage(filters: GraphFiltersState): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(filters))
    }
  } catch {
    // Ignore storage write errors (e.g. quota or incognito)
  }
}

export function countActiveFilters(filters: GraphFiltersState): number {
  let count = 0
  if (filters.kinds.length < 3) count++
  if (filters.tags.length > 0) count++
  if (filters.updatedRange !== 'all') count++
  if (filters.edgeTypes.length < 2) count++
  if (Math.abs(filters.minSimilarity - DEFAULT_GRAPH_FILTERS.minSimilarity) > 0.01) count++
  if (filters.hideOrphans) count++
  if (filters.minConnections > 0) count++
  if (filters.favoritesOnly) count++
  if (filters.includeArchived) count++
  return count
}

/**
 * Case-insensitive fuzzy matching.
 * Matches exact substring with highest score; matches character subsequences with score scaled by continuity.
 */
export function fuzzyMatch(needle: string, target: string): { matched: boolean; score: number } {
  const n = needle.trim().toLowerCase()
  const t = target.toLowerCase()
  if (!n) return { matched: true, score: 1 }
  if (!t) return { matched: false, score: 0 }

  // Exact match
  if (t === n) return { matched: true, score: 100 }

  // Substring match
  const subIndex = t.indexOf(n)
  if (subIndex !== -1) {
    const score = 80 - subIndex * 2 + (n.length / t.length) * 10
    return { matched: true, score: Math.max(50, score) }
  }

  // Subsequence match
  let nIdx = 0
  let tIdx = 0
  let matches = 0
  let consecutive = 0
  let maxConsecutive = 0

  while (nIdx < n.length && tIdx < t.length) {
    if (n[nIdx] === t[tIdx]) {
      matches++
      consecutive++
      if (consecutive > maxConsecutive) maxConsecutive = consecutive
      nIdx++
    } else {
      consecutive = 0
    }
    tIdx++
  }

  if (matches === n.length) {
    const score = 20 + maxConsecutive * 5 - (t.length - n.length) * 0.5
    return { matched: true, score: Math.max(10, score) }
  }

  return { matched: false, score: 0 }
}

export function searchGraphNodes(
  nodes: GraphNode[],
  query: string
): { node: GraphNode; score: number; matchField: 'title' | 'tag'; matchedTag?: string }[] {
  const trimmed = query.trim()
  if (!trimmed) return []

  const results: { node: GraphNode; score: number; matchField: 'title' | 'tag'; matchedTag?: string }[] = []

  for (const node of nodes) {
    const titleMatch = fuzzyMatch(trimmed, node.title)
    let bestScore = titleMatch.matched ? titleMatch.score : 0
    let matchField: 'title' | 'tag' = 'title'
    let matchedTag: string | undefined

    for (const tag of node.tags) {
      const tagMatch = fuzzyMatch(trimmed, tag)
      if (tagMatch.matched && tagMatch.score > bestScore) {
        bestScore = tagMatch.score
        matchField = 'tag'
        matchedTag = tag
      }
    }

    if (bestScore > 0) {
      results.push({ node, score: bestScore, matchField, matchedTag })
    }
  }

  return results.sort((a, b) => b.score - a.score)
}

/**
 * Computes undirected adjacency map for fast degree and neighborhood traversal.
 */
export function computeAdjacency(edges: GraphEdge[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()
  for (const edge of edges) {
    const s = typeof edge.source === 'object' ? (edge.source as any).id : edge.source
    const t = typeof edge.target === 'object' ? (edge.target as any).id : edge.target
    if (!s || !t) continue
    if (!map.has(s)) map.set(s, new Set())
    if (!map.has(t)) map.set(t, new Set())
    map.get(s)!.add(t)
    map.get(t)!.add(s)
  }
  return map
}

/**
 * Focus mode: extracts the 1-, 2-, or 3-hop neighborhood of a given node.
 */
export function getFocusNeighbourhood(nodeId: string, edges: GraphEdge[], depth = 1): Set<string> {
  const adjacency = computeAdjacency(edges)
  const visited = new Set<string>([nodeId])
  let currentLevel = new Set<string>([nodeId])

  const maxHops = Math.max(1, Math.min(3, depth))
  for (let hop = 0; hop < maxHops; hop++) {
    const nextLevel = new Set<string>()
    for (const current of currentLevel) {
      const neighbors = adjacency.get(current)
      if (neighbors) {
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor)
            nextLevel.add(neighbor)
          }
        }
      }
    }
    if (nextLevel.size === 0) break
    currentLevel = nextLevel
  }

  return visited
}

/**
 * Filters nodes based on kind, tags, date range, favorites, and archived state.
 */
export function filterGraphNodes(nodes: GraphNode[], filters: GraphFiltersState, now = new Date()): GraphNode[] {
  const nowMs = now.getTime()
  const DAY_MS = 86_400_000

  return nodes.filter(node => {
    // Kind filter
    if (filters.kinds.length > 0 && !filters.kinds.includes(node.kind as NodeKindFilter)) {
      return false
    }

    // Archived filter
    if (!filters.includeArchived && node.archived) {
      return false
    }

    // Favorites filter
    if (filters.favoritesOnly && !node.favorite) {
      return false
    }

    // Tags filter
    if (filters.tags.length > 0) {
      if (filters.tagMatchMode === 'all') {
        const hasAll = filters.tags.every(tag => node.tags.includes(tag))
        if (!hasAll) return false
      } else {
        const hasAny = filters.tags.some(tag => node.tags.includes(tag))
        if (!hasAny) return false
      }
    }

    // Updated range filter
    if (filters.updatedRange !== 'all') {
      const nodeTime = new Date(node.updated_at).getTime()
      if (isNaN(nodeTime)) return true

      if (filters.updatedRange === '7d') {
        if (nowMs - nodeTime > 7 * DAY_MS) return false
      } else if (filters.updatedRange === '30d') {
        if (nowMs - nodeTime > 30 * DAY_MS) return false
      } else if (filters.updatedRange === '90d') {
        if (nowMs - nodeTime > 90 * DAY_MS) return false
      } else if (filters.updatedRange === 'custom') {
        if (filters.customDateStart) {
          const startTime = new Date(filters.customDateStart).getTime()
          if (!isNaN(startTime) && nodeTime < startTime) return false
        }
        if (filters.customDateEnd) {
          // End of the day for customDateEnd
          const endTime = new Date(filters.customDateEnd).getTime() + DAY_MS
          if (!isNaN(endTime) && nodeTime > endTime) return false
        }
      }
    }

    return true
  })
}

/**
 * Filters edges to ensure both endpoints exist in validNodeIds and match edgeTypes & similarity threshold.
 */
export function filterGraphEdges(edges: GraphEdge[], validNodeIds: Set<string>, filters: GraphFiltersState): GraphEdge[] {
  return edges.filter(edge => {
    const sourceId = typeof edge.source === 'object' ? (edge.source as any).id : edge.source
    const targetId = typeof edge.target === 'object' ? (edge.target as any).id : edge.target

    if (!validNodeIds.has(sourceId) || !validNodeIds.has(targetId)) {
      return false
    }

    // Edge type filter
    const allowSimilar = filters.edgeTypes.includes('similar')
    const allowTag = filters.edgeTypes.includes('tag')

    if (edge.reason === 'similar' && !allowSimilar) return false
    if (edge.reason === 'tag' && !allowTag) return false
    if (edge.reason === 'both' && !allowSimilar && !allowTag) return false

    // Similarity threshold filter (client-side slider on strength)
    if (edge.reason === 'similar' || edge.reason === 'both') {
      if (edge.strength < filters.minSimilarity) return false
    }

    return true
  })
}

/**
 * High-level pure function to filter the entire GraphData.
 */
export function filterGraph(
  data: GraphData,
  filters: GraphFiltersState,
  focus?: { nodeId: string; depth: number } | null,
  now = new Date()
): GraphData {
  if (!data || !data.nodes) return { nodes: [], edges: [] }

  // 1. Initial node filtering by attributes
  let nodes = filterGraphNodes(data.nodes, filters, now)

  // 2. Focus mode intersection
  if (focus && focus.nodeId) {
    const focusSet = getFocusNeighbourhood(focus.nodeId, data.edges, focus.depth)
    nodes = nodes.filter(n => focusSet.has(n.id))
  }

  const nodeIds = new Set(nodes.map(n => n.id))

  // 3. Filter edges among valid nodes
  let edges = filterGraphEdges(data.edges, nodeIds, filters)

  // 4. Calculate connections / degrees from active edges
  const adjacency = computeAdjacency(edges)

  // 5. Hide orphans or enforce minConnections
  if (filters.hideOrphans || filters.minConnections > 0) {
    const minConn = filters.hideOrphans ? Math.max(1, filters.minConnections) : filters.minConnections
    nodes = nodes.filter(node => (adjacency.get(node.id)?.size || 0) >= minConn)

    // Re-filter edges to drop links to pruned nodes
    const survivingIds = new Set(nodes.map(n => n.id))
    edges = edges.filter(edge => {
      const s = typeof edge.source === 'object' ? (edge.source as any).id : edge.source
      const t = typeof edge.target === 'object' ? (edge.target as any).id : edge.target
      return survivingIds.has(s) && survivingIds.has(t)
    })
  }

  return { nodes, edges }
}

/**
 * Returns tag counts across nodes, sorted descending by frequency.
 */
export function getTagCounts(nodes: GraphNode[]): { tag: string; count: number }[] {
  const map = new Map<string, number>()
  for (const node of nodes) {
    for (const tag of node.tags) {
      map.set(tag, (map.get(tag) || 0) + 1)
    }
  }
  return [...map.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

/**
 * Groups connected notes into similar meaning (% strength) and shared tags.
 */
export function getLinkedNotes(
  nodeId: string,
  data: GraphData,
  allNodesMap: Map<string, GraphNode>
): {
  similar: { node: GraphNode; strengthPercent: number; edge: GraphEdge }[]
  byTag: { node: GraphNode; sharedTags: string[]; edge?: GraphEdge }[]
} {
  const sourceNode = allNodesMap.get(nodeId)
  const similarMap = new Map<string, { node: GraphNode; strengthPercent: number; edge: GraphEdge }>()
  const tagMap = new Map<string, { node: GraphNode; sharedTags: string[]; edge?: GraphEdge }>()

  for (const edge of data.edges || []) {
    const s = typeof edge.source === 'object' ? (edge.source as any).id : edge.source
    const t = typeof edge.target === 'object' ? (edge.target as any).id : edge.target

    let otherId: string | null = null
    if (s === nodeId) otherId = t
    else if (t === nodeId) otherId = s

    if (!otherId || otherId === nodeId) continue
    const otherNode = allNodesMap.get(otherId)
    if (!otherNode) continue

    if (edge.reason === 'similar' || edge.reason === 'both') {
      const percent = Math.round(edge.strength * 100)
      const existing = similarMap.get(otherId)
      if (!existing || percent > existing.strengthPercent) {
        similarMap.set(otherId, { node: otherNode, strengthPercent: percent, edge })
      }
    }

    if (edge.reason === 'tag' || edge.reason === 'both') {
      const shared = sourceNode ? sourceNode.tags.filter(tag => otherNode.tags.includes(tag)) : []
      tagMap.set(otherId, { node: otherNode, sharedTags: shared, edge })
    }
  }

  // Also include any nodes that share tags even if an edge didn't exist or was truncated
  if (sourceNode && sourceNode.tags.length > 0) {
    for (const other of allNodesMap.values()) {
      if (other.id === nodeId || tagMap.has(other.id)) continue
      const shared = sourceNode.tags.filter(tag => other.tags.includes(tag))
      if (shared.length > 0) {
        tagMap.set(other.id, { node: other, sharedTags: shared })
      }
    }
  }

  const similar = [...similarMap.values()].sort((a, b) => b.strengthPercent - a.strengthPercent)
  const byTag = [...tagMap.values()].sort((a, b) => b.sharedTags.length - a.sharedTags.length || a.node.title.localeCompare(b.node.title))

  return { similar, byTag }
}

const NOTE_COLOR = '#8660f1'
const RESEARCH_COLOR = '#059669'
const SPECIALIZED_COLOR = '#2678ca'

const TAG_PALETTE = [
  '#ec4899', // pink
  '#f59e0b', // amber
  '#10b981', // emerald
  '#06b6d4', // cyan
  '#8b5cf6', // purple
  '#3b82f6', // blue
  '#f97316', // orange
  '#14b8a6', // teal
  '#a855f7', // violet
  '#e11d48'  // rose
]

export function getTagColor(tag: string): string {
  if (!tag) return NOTE_COLOR
  let hash = 0
  for (let i = 0; i < tag.length; i++) {
    hash = (hash << 5) - hash + tag.charCodeAt(i)
    hash |= 0
  }
  const index = Math.abs(hash) % TAG_PALETTE.length
  return TAG_PALETTE[index]
}

export function getNodeColor(node: GraphNode, colorBy: ColorByOption, now = new Date()): string {
  if (colorBy === 'kind') {
    if (node.kind === 'research') return RESEARCH_COLOR
    if (node.kind === 'specialized') return SPECIALIZED_COLOR
    return NOTE_COLOR
  }

  if (colorBy === 'tag') {
    if (node.tags && node.tags.length > 0) {
      return getTagColor(node.tags[0])
    }
    return '#9ca3af' // un-tagged gray
  }

  if (colorBy === 'age') {
    const updated = new Date(node.updated_at).getTime()
    if (isNaN(updated)) return NOTE_COLOR
    const diffDays = (now.getTime() - updated) / (1000 * 60 * 60 * 24)
    if (diffDays <= 3) return '#8660f1' // Very recent: purple
    if (diffDays <= 14) return '#3b82f6' // Recent: blue
    if (diffDays <= 30) return '#10b981' // Month: green
    if (diffDays <= 90) return '#f59e0b' // Quarter: amber
    return '#6b7280' // Older: gray
  }

  return NOTE_COLOR
}

export function getNodeRadius(node: GraphNode, sizeBy: SizeByOption, degree = 0): number {
  if (sizeBy === 'length') {
    const words = node.word_count || 0
    if (words <= 0) return 3.5
    // Scale smoothly from 3.5 to 11
    return 3.5 + Math.min(8.5, Math.log10(words + 1) * 2.8)
  }
  // Default: by connections / degree
  return 3 + Math.min(9, degree * 1.4)
}

export function hexWithAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '')
  if (value.length === 3) {
    const r = parseInt(value[0] + value[0], 16)
    const g = parseInt(value[1] + value[1], 16)
    const b = parseInt(value[2] + value[2], 16)
    return `rgba(${r},${g},${b},${alpha})`
  }
  const r = parseInt(value.slice(0, 2), 16)
  const g = parseInt(value.slice(2, 4), 16)
  const b = parseInt(value.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}
