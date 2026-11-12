import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import { ArrowLeft, Maximize2, Plus, SlidersHorizontal, Waypoints, X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../services/api'
import type { GraphData, GraphEdge, GraphNode } from '../types'
import {
  DEFAULT_GRAPH_FILTERS,
  computeAdjacency,
  countActiveFilters,
  filterGraph,
  getDefaultFilters,
  getNodeColor,
  getNodeRadius,
  hexWithAlpha,
  loadFiltersFromStorage,
  saveFiltersToStorage,
  type GraphFiltersState
} from '../services/graph-filters'
import { GraphSearchBar } from './GraphSearchBar'
import { GraphFiltersPanel } from './GraphFiltersPanel'
import { GraphSidePanel } from './GraphSidePanel'
import './graph.css'

type NodeObject = GraphNode & { x?: number; y?: number; degree?: number }
type LinkObject = { source: string | NodeObject; target: string | NodeObject; strength: number; reason: GraphEdge['reason'] }

const DIM = 0.12

export function GraphView({ onBack, create }: { onBack: () => void; create: () => void }) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const initialFocus = searchParams.get('focus')

  const [size, setSize] = useState({ width: 0, height: 0 })
  const [selected, setSelected] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)

  // Filters state with localStorage persistence
  const [filters, setFilters] = useState<GraphFiltersState>(() => loadFiltersFromStorage())
  useEffect(() => {
    saveFiltersToStorage(filters)
  }, [filters])

  // Focus mode (1/2/3 hops neighbourhood)
  const [focus, setFocus] = useState<{ nodeId: string; depth: number } | null>(null)

  // Search state
  const [query, setQuery] = useState('')
  const [byMeaning, setByMeaning] = useState(false)
  const [matchedNodeIds, setMatchedNodeIds] = useState<Set<string> | null>(null)

  // Selection history for side panel back/forward
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)

  // Fetch graph data (with minSimilarity parameter)
  const graphQuery = useQuery({
    queryKey: ['graph', filters.minSimilarity],
    queryFn: () => api.getGraph(filters.minSimilarity),
    staleTime: 30_000,
    refetchInterval: 60_000
  })

  const rawData = graphQuery.data
  const fgRef = useRef<any>(null)

  // Measure container size
  const measure = useCallback((node: HTMLDivElement | null) => {
    if (!node) return
    const observer = new ResizeObserver(entries => {
      const entry = entries[0]
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  // Map of all raw nodes for quick lookup
  const allNodesMap = useMemo(() => {
    const map = new Map<string, GraphNode>()
    for (const node of rawData?.nodes || []) {
      map.set(node.id, node)
    }
    return map
  }, [rawData])

  // Filter graph data according to filters and focus mode
  const filteredData = useMemo(() => {
    if (!rawData) return { nodes: [], edges: [] }
    return filterGraph(rawData, filters, focus)
  }, [rawData, filters, focus])

  // Compute adjacency on filtered edges
  const filteredAdjacency = useMemo(() => {
    return computeAdjacency(filteredData.edges)
  }, [filteredData])

  // Prepare graphData for react-force-graph-2d
  const graphData = useMemo(() => {
    const nodes: NodeObject[] = filteredData.nodes.map(node => ({
      ...node,
      degree: filteredAdjacency.get(node.id)?.size || 0
    }))
    const links: LinkObject[] = filteredData.edges.map(edge => ({
      source: edge.source,
      target: edge.target,
      strength: edge.strength,
      reason: edge.reason
    }))
    return { nodes, links }
  }, [filteredData, filteredAdjacency])

  // Auto-focus node from URL param (?focus=nodeId) on initial load
  const hasFocusedInitial = useRef(false)
  useEffect(() => {
    if (!hasFocusedInitial.current && initialFocus && graphData.nodes.length > 0) {
      const target = graphData.nodes.find(n => n.id === initialFocus)
      if (target) {
        hasFocusedInitial.current = true
        handleSelectNode(target.id)
        setTimeout(() => {
          fgRef.current?.centerAt(target.x || 0, target.y || 0, 700)
          fgRef.current?.zoom(1.8, 700)
        }, 300)
      }
    }
  }, [initialFocus, graphData.nodes])

  // Escape key closes panels and clears selection
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (filtersOpen) {
          setFiltersOpen(false)
        } else if (selected) {
          setSelected(null)
        } else if (focus) {
          setFocus(null)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [filtersOpen, selected, focus])

  // Select node and update history
  const handleSelectNode = useCallback(
    (id: string | null) => {
      setSelected(id)
      if (id) {
        setHistory(prev => {
          const next = prev.slice(0, historyIndex + 1)
          if (next[next.length - 1] === id) return prev
          return [...next, id]
        })
        setHistoryIndex(prev => prev + 1)
      }
    },
    [historyIndex]
  )

  // Linked note selection recentres graph and swaps side panel
  const handleSelectLinkedNode = useCallback(
    (id: string) => {
      handleSelectNode(id)
      const target = graphData.nodes.find(n => n.id === id)
      if (target && fgRef.current) {
        fgRef.current.centerAt(target.x || 0, target.y || 0, 600)
        fgRef.current.zoom(1.5, 600)
      }
    },
    [graphData.nodes, handleSelectNode]
  )

  // History navigation
  const handleHistoryBack = useCallback(() => {
    if (historyIndex > 0) {
      const prevIndex = historyIndex - 1
      const prevId = history[prevIndex]
      setHistoryIndex(prevIndex)
      setSelected(prevId)
      const target = graphData.nodes.find(n => n.id === prevId)
      if (target && fgRef.current) {
        fgRef.current.centerAt(target.x || 0, target.y || 0, 600)
      }
    }
  }, [history, historyIndex, graphData.nodes])

  const handleHistoryForward = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const nextIndex = historyIndex + 1
      const nextId = history[nextIndex]
      setHistoryIndex(nextIndex)
      setSelected(nextId)
      const target = graphData.nodes.find(n => n.id === nextId)
      if (target && fgRef.current) {
        fgRef.current.centerAt(target.x || 0, target.y || 0, 600)
      }
    }
  }, [history, historyIndex, graphData.nodes])

  const lastClickRef = useRef<{ id: string; time: number } | null>(null)

  // Double click node enters focus mode (Deliverable 2)
  const handleNodeDoubleClick = useCallback((node: NodeObject) => {
    setFocus(prev => (prev?.nodeId === node.id ? null : { nodeId: node.id, depth: 1 }))
  }, [])

  // Highlight check
  const isNodeActive = useCallback(
    (node: NodeObject) => {
      if (matchedNodeIds) {
        return matchedNodeIds.has(node.id)
      }
      if (selected) {
        return node.id === selected || filteredAdjacency.get(selected)?.has(node.id)
      }
      return true
    },
    [matchedNodeIds, selected, filteredAdjacency]
  )

  // Canvas node painting
  const nodeCanvasObject = useCallback(
    (node: NodeObject, ctx: CanvasRenderingContext2D) => {
      const active = isNodeActive(node)
      const isHovered = node.id === hovered || node.id === selected
      const isFocusedOrigin = focus?.nodeId === node.id
      const radius = getNodeRadius(node, filters.sizeBy, node.degree || 0)

      ctx.beginPath()
      ctx.arc(node.x || 0, node.y || 0, radius, 0, 2 * Math.PI)
      const baseColor = getNodeColor(node, filters.colorBy)
      ctx.fillStyle = active ? baseColor : hexWithAlpha(baseColor, DIM)
      ctx.fill()

      if (isHovered || isFocusedOrigin) {
        ctx.strokeStyle = isFocusedOrigin ? '#8660f1' : hexWithAlpha('#ffffff', 0.85)
        ctx.lineWidth = isFocusedOrigin ? 2.4 : 1.8
        ctx.stroke()
      }

      // Label rendering
      let showLabel = false
      if (filters.labelsMode === 'always') showLabel = true
      else if (filters.labelsMode === 'hover') showLabel = Boolean(isHovered || (selected !== null && active))
      else if (filters.labelsMode === 'off') showLabel = Boolean(isHovered)

      if (showLabel) {
        const label = node.title.length > 26 ? `${node.title.slice(0, 24)}…` : node.title
        ctx.font = `${isHovered ? 600 : 400} ${isHovered ? 11 : 9.5}px 'DM Sans', sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        const isDark = document.documentElement.dataset.theme === 'dark'
        ctx.fillStyle = active ? (isDark ? '#e8e6ec' : '#2a2833') : hexWithAlpha('#8c8a94', DIM)
        ctx.fillText(label, node.x || 0, (node.y || 0) + radius + 4)
      }
    },
    [isNodeActive, hovered, selected, focus, filters]
  )

  const nodePointerAreaPaint = useCallback(
    (node: NodeObject, color: string, ctx: CanvasRenderingContext2D) => {
      const radius = getNodeRadius(node, filters.sizeBy, node.degree || 0)
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(node.x || 0, node.y || 0, radius + 4, 0, 2 * Math.PI)
      ctx.fill()
    },
    [filters.sizeBy]
  )

  const linkColor = useCallback(
    (link: LinkObject) => {
      const sId = typeof link.source === 'object' ? link.source.id : link.source
      const tId = typeof link.target === 'object' ? link.target.id : link.target

      let active = true
      if (matchedNodeIds) {
        active = matchedNodeIds.has(sId) && matchedNodeIds.has(tId)
      } else if (selected) {
        active = sId === selected || tId === selected
      }

      if (!active) return 'rgba(128,128,140,0.06)'
      if (link.reason === 'tag') return 'rgba(196,136,42,0.65)'
      if (link.reason === 'both') return 'rgba(134,96,241,0.65)'
      return 'rgba(134,96,241,0.4)'
    },
    [selected, matchedNodeIds]
  )

  const fitView = useCallback(() => {
    fgRef.current?.zoomToFit(500, 70)
  }, [])

  if (graphQuery.isLoading) {
    return (
      <div className="graph-page">
        <header className="graph-header">
          <button className="graph-back" onClick={onBack}>
            <ArrowLeft size={16} /> All notes
          </button>
          <div className="graph-title">
            <Waypoints size={15} />
            <strong>Graph</strong>
            <em>mapping your notes…</em>
          </div>
          <button className="graph-new" onClick={create}>
            <Plus size={15} /> New note
          </button>
        </header>
        <div className="app-loading">
          <div className="loader" />
          Mapping your notes
        </div>
      </div>
    )
  }

  const hasNotes = graphData.nodes.length > 0
  const activeFilterCount = countActiveFilters(filters)
  const focusedNodeMeta = focus ? allNodesMap.get(focus.nodeId) : null

  return (
    <div className="graph-page">
      {/* Top Header */}
      <header className="graph-header">
        <div className="graph-header-left">
          <button className="graph-back" onClick={onBack} title="Back to all notes">
            <ArrowLeft size={16} />
            <span className="graph-title-label">All notes</span>
          </button>
          <div className="graph-title">
            <Waypoints size={15} />
            <strong>Graph</strong>
            <em>
              {filteredData.nodes.length} {filteredData.nodes.length === 1 ? 'note' : 'notes'}
            </em>
          </div>
        </div>

        {/* Center Search Bar */}
        <div className="graph-header-center">
          <GraphSearchBar
            query={query}
            setQuery={setQuery}
            byMeaning={byMeaning}
            setByMeaning={setByMeaning}
            allNodes={rawData?.nodes || []}
            onSelectNode={id => {
              handleSelectNode(id)
              const target = graphData.nodes.find(n => n.id === id)
              if (target && fgRef.current) {
                fgRef.current.centerAt(target.x || 0, target.y || 0, 600)
                fgRef.current.zoom(1.6, 600)
              }
            }}
            onMatchesChange={setMatchedNodeIds}
          />
        </div>

        <div className="graph-header-right">
          <button
            type="button"
            className={`graph-btn ${filtersOpen ? 'active' : ''}`}
            onClick={() => setFiltersOpen(!filtersOpen)}
            title="Filters and view options"
          >
            <SlidersHorizontal size={14} />
            <span className="graph-btn-label">Filters</span>
            {activeFilterCount > 0 && <span className="graph-badge-count">{activeFilterCount}</span>}
          </button>

          <button type="button" className="graph-btn" onClick={fitView} title="Fit graph to view">
            <Maximize2 size={14} />
            <span className="graph-btn-label">Fit view</span>
          </button>

          <button className="graph-new" onClick={create} title="Create note">
            <Plus size={15} />
            <span className="graph-btn-label">New note</span>
          </button>
        </div>
      </header>

      {/* Workspace: Canvas + Side Panel */}
      <div className="graph-workspace">
        <div className="graph-canvas-container">
          <div className="graph-canvas" ref={measure}>
            {hasNotes ? (
              <ForceGraph2D
                ref={fgRef}
                width={size.width || undefined}
                height={size.height || undefined}
                graphData={graphData as any}
                backgroundColor="rgba(0,0,0,0)"
                nodeLabel={(node: NodeObject) =>
                  `<div style="font:12px/1.4 'DM Sans',sans-serif;padding:3px 6px;background:rgba(20,18,25,0.85);color:#fff;border-radius:6px;backdrop-filter:blur(4px)"><strong>${escapeAttr(
                    node.title
                  )}</strong>${
                    node.tags.length ? `<br/><span style="opacity:.75">#${node.tags.join(' · #')}</span>` : ''
                  }</div>`
                }
                nodeColor={(node: NodeObject) => {
                  const color = getNodeColor(node, filters.colorBy)
                  return isNodeActive(node) ? color : hexWithAlpha(color, DIM)
                }}
                nodeVal={(node: NodeObject) => getNodeRadius(node, filters.sizeBy, node.degree || 0)}
                nodeCanvasObject={nodeCanvasObject as any}
                nodeCanvasObjectMode={(() => true) as any}
                nodePointerAreaPaint={nodePointerAreaPaint as any}
                linkColor={linkColor as any}
                linkWidth={(link: LinkObject) => 0.8 + link.strength * 1.8}
                linkDirectionalParticles={(link: LinkObject) => (link.reason === 'both' ? 2 : 0)}
                linkDirectionalParticleWidth={1.6}
                d3AlphaDecay={0.02}
                d3VelocityDecay={0.35}
                cooldownTicks={220}
                onEngineStop={() => {
                  if (!selected && !focus) fgRef.current?.zoomToFit(500, 70)
                }}
                onNodeClick={(node: NodeObject) => {
                  const now = Date.now()
                  if (lastClickRef.current && lastClickRef.current.id === node.id && now - lastClickRef.current.time < 350) {
                    lastClickRef.current = null
                    handleNodeDoubleClick(node)
                    return
                  }
                  lastClickRef.current = { id: node.id, time: now }
                  if (selected === node.id) {
                    setSelected(null)
                  } else {
                    handleSelectNode(node.id)
                    fgRef.current?.centerAt(node.x || 0, node.y || 0, 600)
                  }
                }}
                onNodeHover={(node: NodeObject | null) => setHovered(node ? node.id : null)}
                onBackgroundClick={() => {
                  setSelected(null)
                }}
              />
            ) : (
              <div className="graph-empty">
                <Waypoints size={28} />
                <h3>No notes match your filters</h3>
                <p>Try resetting filters or adjusting search terms to show connected notes.</p>
                <button
                  type="button"
                  className="graph-btn"
                  style={{ marginTop: 8 }}
                  onClick={() => {
                    setFilters(getDefaultFilters())
                    setQuery('')
                    setMatchedNodeIds(null)
                    setFocus(null)
                  }}
                >
                  Reset all filters
                </button>
              </div>
            )}

            {/* Focus mode chip banner (Deliverable 2) */}
            {focus && focusedNodeMeta && (
              <div className="graph-focus-chip">
                <span className="graph-focus-title">
                  <Waypoints size={13} /> Focus: {focusedNodeMeta.title}
                </span>
                <div className="graph-depth-buttons">
                  {[1, 2, 3].map(depth => (
                    <button
                      key={depth}
                      type="button"
                      className={`graph-depth-btn ${focus.depth === depth ? 'active' : ''}`}
                      onClick={() => setFocus(prev => (prev ? { ...prev, depth } : null))}
                      title={`Show ${depth}-hop neighbourhood`}
                    >
                      {depth} {depth === 1 ? 'hop' : 'hops'}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="graph-focus-exit"
                  onClick={() => setFocus(null)}
                  title="Exit focus mode"
                >
                  <X size={13} />
                </button>
              </div>
            )}

            {/* Canvas Legend */}
            <aside className="graph-legend">
              <span>
                <i style={{ background: '#8660f1' }} /> Note
              </span>
              <span>
                <i style={{ background: '#2678ca' }} /> Specialized
              </span>
              <span>
                <i style={{ background: '#059669' }} /> Research
              </span>
              <span>
                <i className="edge similar" /> Similar meaning
              </span>
              <span>
                <i className="edge tag" /> Shared tag
              </span>
            </aside>

            {/* Clear focus / selection button */}
            {hasNotes && (selected || focus || matchedNodeIds) && (
              <div className="graph-canvas-controls">
                <button
                  type="button"
                  className="graph-btn"
                  onClick={() => {
                    setSelected(null)
                    setFocus(null)
                    setMatchedNodeIds(null)
                    setQuery('')
                  }}
                  title="Clear focus and highlights"
                >
                  Clear view
                </button>
              </div>
            )}

            {graphQuery.error && (
              <button className="graph-retry" onClick={() => void graphQuery.refetch()}>
                Could not load the graph — retry
              </button>
            )}
          </div>
        </div>

        {/* Collapsible Filters Drawer */}
        {filtersOpen && (
          <GraphFiltersPanel
            filters={filters}
            setFilters={setFilters}
            onReset={() => setFilters(getDefaultFilters())}
            onClose={() => setFiltersOpen(false)}
            allNodes={rawData?.nodes || []}
            onFitView={fitView}
          />
        )}

        {/* Resizable Side Panel / Bottom sheet */}
        {selected && (
          <GraphSidePanel
            nodeId={selected}
            onClose={() => setSelected(null)}
            onOpenNote={id => navigate(`/note/${id}`)}
            onSelectLinkedNode={handleSelectLinkedNode}
            graphData={rawData || { nodes: [], edges: [] }}
            allNodesMap={allNodesMap}
            canGoBack={historyIndex > 0}
            canGoForward={historyIndex < history.length - 1}
            onHistoryBack={handleHistoryBack}
            onHistoryForward={handleHistoryForward}
          />
        )}
      </div>
    </div>
  )
}

function escapeAttr(value: string) {
  return value.replace(/[&<>"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[character] as string))
}
