import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_GRAPH_FILTERS,
  computeAdjacency,
  countActiveFilters,
  filterGraph,
  filterGraphEdges,
  filterGraphNodes,
  fuzzyMatch,
  getDefaultFilters,
  getFocusNeighbourhood,
  getLinkedNotes,
  getNodeColor,
  getNodeRadius,
  getTagColor,
  getTagCounts,
  hexWithAlpha,
  searchGraphNodes,
  type GraphFiltersState
} from './graph-filters'
import type { GraphData, GraphEdge, GraphNode } from '../types'

const baseTime = new Date('2026-11-12T12:00:00Z')

function mockNode(id: string, extra: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    title: `Note ${id.toUpperCase()}`,
    kind: 'note',
    tags: ['work'],
    updated_at: '2026-11-10T10:00:00Z',
    created_at: '2026-11-01T10:00:00Z',
    favorite: false,
    archived: false,
    word_count: 100,
    ...extra
  }
}

function mockEdge(source: string, target: string, strength = 0.8, reason: 'similar' | 'tag' | 'both' = 'similar'): GraphEdge {
  return { source, target, strength, reason }
}

test('fuzzyMatch handles exact, substring, and subsequence matching', () => {
  // Exact match
  const exact = fuzzyMatch('project', 'project')
  assert.equal(exact.matched, true)
  assert.equal(exact.score, 100)

  // Substring match
  const sub = fuzzyMatch('proj', 'My project notes')
  assert.equal(sub.matched, true)
  assert.ok(sub.score >= 50)

  // Subsequence match
  const subseq = fuzzyMatch('prjt', 'project')
  assert.equal(subseq.matched, true)
  assert.ok(subseq.score > 0)

  // Non-match
  const nomatch = fuzzyMatch('xyz', 'project')
  assert.equal(nomatch.matched, false)

  // Empty needle matches with base score
  assert.equal(fuzzyMatch('', 'anything').matched, true)
})

test('searchGraphNodes matches title and tags with correct ordering', () => {
  const nodes = [
    mockNode('1', { title: 'Deep Learning with PyTorch', tags: ['ai', 'code'] }),
    mockNode('2', { title: 'Grocery shopping list', tags: ['personal'] }),
    mockNode('3', { title: 'Meeting notes', tags: ['ai-strategy'] })
  ]

  const results = searchGraphNodes(nodes, 'ai')
  assert.equal(results.length, 2)
  // Both node 1 (tag 'ai') and node 3 (tag 'ai-strategy') matched
  const ids = results.map(r => r.node.id)
  assert.ok(ids.includes('1'))
  assert.ok(ids.includes('3'))
  assert.ok(!ids.includes('2'))
})

test('getFocusNeighbourhood extracts 1, 2, and 3-hop subgraphs', () => {
  // Graph: A - B - C - D, and isolated node E
  const edges = [
    mockEdge('A', 'B'),
    mockEdge('B', 'C'),
    mockEdge('C', 'D')
  ]

  const hop1 = getFocusNeighbourhood('A', edges, 1)
  assert.deepEqual([...hop1].sort(), ['A', 'B'])

  const hop2 = getFocusNeighbourhood('A', edges, 2)
  assert.deepEqual([...hop2].sort(), ['A', 'B', 'C'])

  const hop3 = getFocusNeighbourhood('A', edges, 3)
  assert.deepEqual([...hop3].sort(), ['A', 'B', 'C', 'D'])

  // Node with no edges returns just itself
  const isolated = getFocusNeighbourhood('E', edges, 2)
  assert.deepEqual([...isolated], ['E'])
})

test('filterGraphNodes respects kind, tags, favorites, and archived filters', () => {
  const nodes = [
    mockNode('1', { kind: 'note', tags: ['frontend', 'react'], favorite: true }),
    mockNode('2', { kind: 'research', tags: ['ai'], favorite: false }),
    mockNode('3', { kind: 'specialized', tags: ['workout'], archived: true }),
    mockNode('4', { kind: 'note', tags: ['frontend'], favorite: false })
  ]

  // Default filters: excludes archived by default
  const defaultRes = filterGraphNodes(nodes, DEFAULT_GRAPH_FILTERS, baseTime)
  assert.equal(defaultRes.length, 3)
  assert.ok(!defaultRes.some(n => n.id === '3'))

  // Include archived
  const withArchived = filterGraphNodes(nodes, { ...DEFAULT_GRAPH_FILTERS, includeArchived: true }, baseTime)
  assert.equal(withArchived.length, 4)

  // Favorites only
  const favsOnly = filterGraphNodes(nodes, { ...DEFAULT_GRAPH_FILTERS, favoritesOnly: true }, baseTime)
  assert.equal(favsOnly.length, 1)
  assert.equal(favsOnly[0].id, '1')

  // Kind filter: research only
  const researchOnly = filterGraphNodes(nodes, { ...DEFAULT_GRAPH_FILTERS, kinds: ['research'] }, baseTime)
  assert.equal(researchOnly.length, 1)
  assert.equal(researchOnly[0].id, '2')

  // Tag filter: any ('react')
  const tagAny = filterGraphNodes(nodes, { ...DEFAULT_GRAPH_FILTERS, tags: ['react'], tagMatchMode: 'any' }, baseTime)
  assert.equal(tagAny.length, 1)
  assert.equal(tagAny[0].id, '1')

  // Tag filter: all ('frontend', 'react')
  const tagAll = filterGraphNodes(nodes, { ...DEFAULT_GRAPH_FILTERS, tags: ['frontend', 'react'], tagMatchMode: 'all' }, baseTime)
  assert.equal(tagAll.length, 1)
  assert.equal(tagAll[0].id, '1')
})

test('filterGraphNodes filters by updated date ranges', () => {
  const nodes = [
    mockNode('1', { updated_at: '2026-11-11T12:00:00Z' }), // 1 day ago
    mockNode('2', { updated_at: '2026-10-25T12:00:00Z' }), // 18 days ago
    mockNode('3', { updated_at: '2026-09-01T12:00:00Z' })  // 72 days ago
  ]

  // 7d range
  const r7d = filterGraphNodes(nodes, { ...DEFAULT_GRAPH_FILTERS, updatedRange: '7d' }, baseTime)
  assert.deepEqual(r7d.map(n => n.id), ['1'])

  // 30d range
  const r30d = filterGraphNodes(nodes, { ...DEFAULT_GRAPH_FILTERS, updatedRange: '30d' }, baseTime)
  assert.deepEqual(r30d.map(n => n.id), ['1', '2'])

  // Custom range
  const custom = filterGraphNodes(nodes, {
    ...DEFAULT_GRAPH_FILTERS,
    updatedRange: 'custom',
    customDateStart: '2026-10-01',
    customDateEnd: '2026-11-01'
  }, baseTime)
  assert.deepEqual(custom.map(n => n.id), ['2'])
})

test('filterGraphEdges filters by reason and similarity threshold', () => {
  const edges = [
    mockEdge('1', '2', 0.85, 'similar'),
    mockEdge('2', '3', 0.65, 'similar'),
    mockEdge('1', '3', 0.50, 'tag'),
    mockEdge('3', '4', 0.90, 'both')
  ]
  const validIds = new Set(['1', '2', '3', '4'])

  // Default filters (similarity threshold 0.72)
  const defaultEdges = filterGraphEdges(edges, validIds, DEFAULT_GRAPH_FILTERS)
  // '2'-'3' similar edge (0.65) should be filtered out by minSimilarity 0.72
  assert.equal(defaultEdges.some(e => e.source === '2' && e.target === '3'), false)
  // '1'-'2' (0.85 similar), '1'-'3' (tag), '3'-'4' (both) should survive
  assert.equal(defaultEdges.length, 3)

  // Tag edges (matches reason 'tag' or 'both')
  const tagEdges = filterGraphEdges(edges, validIds, { ...DEFAULT_GRAPH_FILTERS, edgeTypes: ['tag'] })
  assert.equal(tagEdges.length, 2)
  assert.ok(tagEdges.every(e => e.reason === 'tag' || e.reason === 'both'))

  // Disconnected endpoints are dropped
  const pruned = filterGraphEdges(edges, new Set(['1', '2']), DEFAULT_GRAPH_FILTERS)
  assert.equal(pruned.length, 1)
  assert.equal(pruned[0].source, '1')
  assert.equal(pruned[0].target, '2')
})

test('filterGraph handles hideOrphans and minConnections correctly', () => {
  const data: GraphData = {
    nodes: [
      mockNode('1'),
      mockNode('2'),
      mockNode('3'),
      mockNode('orphan')
    ],
    edges: [
      mockEdge('1', '2', 0.8, 'similar'),
      mockEdge('1', '3', 0.8, 'similar')
    ]
  }

  // Without hideOrphans
  const withOrphans = filterGraph(data, DEFAULT_GRAPH_FILTERS, null, baseTime)
  assert.equal(withOrphans.nodes.length, 4)

  // With hideOrphans = true
  const noOrphans = filterGraph(data, { ...DEFAULT_GRAPH_FILTERS, hideOrphans: true }, null, baseTime)
  assert.equal(noOrphans.nodes.length, 3)
  assert.ok(!noOrphans.nodes.some(n => n.id === 'orphan'))

  // With minConnections = 2
  // Only node '1' has degree 2 (connected to '2' and '3'); '2' and '3' only have degree 1
  const min2 = filterGraph(data, { ...DEFAULT_GRAPH_FILTERS, minConnections: 2 }, null, baseTime)
  assert.equal(min2.nodes.length, 1)
  assert.equal(min2.nodes[0].id, '1')
  assert.equal(min2.edges.length, 0)
})

test('getTagCounts aggregates tags with descending counts', () => {
  const nodes = [
    mockNode('1', { tags: ['ai', 'code', 'react'] }),
    mockNode('2', { tags: ['ai', 'research'] }),
    mockNode('3', { tags: ['ai', 'code'] })
  ]

  const counts = getTagCounts(nodes)
  assert.deepEqual(counts[0], { tag: 'ai', count: 3 })
  assert.deepEqual(counts[1], { tag: 'code', count: 2 })
})

test('getLinkedNotes groups by similar meaning (% score) and shared tags', () => {
  const nodeA = mockNode('A', { tags: ['music', 'piano'] })
  const nodeB = mockNode('B', { tags: ['music', 'guitar'] })
  const nodeC = mockNode('C', { tags: ['coding'] })

  const allMap = new Map([
    ['A', nodeA],
    ['B', nodeB],
    ['C', nodeC]
  ])

  const data: GraphData = {
    nodes: [nodeA, nodeB, nodeC],
    edges: [
      mockEdge('A', 'B', 0.88, 'both'),
      mockEdge('A', 'C', 0.74, 'similar')
    ]
  }

  const linked = getLinkedNotes('A', data, allMap)
  assert.equal(linked.similar.length, 2)
  assert.equal(linked.similar[0].node.id, 'B')
  assert.equal(linked.similar[0].strengthPercent, 88)
  assert.equal(linked.similar[1].node.id, 'C')
  assert.equal(linked.similar[1].strengthPercent, 74)

  assert.equal(linked.byTag.length, 1)
  assert.equal(linked.byTag[0].node.id, 'B')
  assert.deepEqual(linked.byTag[0].sharedTags, ['music'])
})

test('getNodeColor and getNodeRadius map visual attributes predictably', () => {
  const note = mockNode('1', { kind: 'note', word_count: 500 })
  const research = mockNode('2', { kind: 'research', word_count: 2000 })
  const specialized = mockNode('3', { kind: 'specialized', word_count: 50 })

  // Color by kind
  assert.equal(getNodeColor(note, 'kind'), '#8660f1')
  assert.equal(getNodeColor(research, 'kind'), '#059669')
  assert.equal(getNodeColor(specialized, 'kind'), '#2678ca')

  // Color by age
  const recent = mockNode('r', { updated_at: '2026-11-11T12:00:00Z' })
  assert.equal(getNodeColor(recent, 'age', baseTime), '#8660f1')

  // Radius by connections
  assert.equal(getNodeRadius(note, 'connections', 0), 3)
  assert.ok(getNodeRadius(note, 'connections', 5) > 3)

  // Radius by word count
  assert.ok(getNodeRadius(research, 'length') > getNodeRadius(specialized, 'length'))

  // hexWithAlpha
  assert.equal(hexWithAlpha('#ffffff', 0.5), 'rgba(255,255,255,0.5)')
})

test('countActiveFilters detects differences from defaults', () => {
  const defaults = getDefaultFilters()
  assert.equal(countActiveFilters(defaults), 0)

  const modified: GraphFiltersState = {
    ...defaults,
    favoritesOnly: true,
    tags: ['work'],
    minSimilarity: 0.85
  }
  assert.equal(countActiveFilters(modified), 3)
})
