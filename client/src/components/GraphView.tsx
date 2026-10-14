import { useCallback, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import { ArrowLeft, Plus, Waypoints } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../services/api'
import type { GraphData, GraphEdge, GraphNode } from '../types'

type NodeObject = GraphNode & { x?: number; y?: number; degree?: number }
type LinkObject = { source: string | NodeObject; target: string | NodeObject; strength: number; reason: GraphEdge['reason'] }

const NOTE_COLOR = '#8660f1'
const RESEARCH_COLOR = '#237a46'
const SPECIALIZED_COLOR = '#2678ca'
const DIM = 0.12

export function GraphView({ onBack, create }: { onBack: () => void; create: () => void }) {
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [selected, setSelected] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const graph = useQuery({ queryKey: ['graph'], queryFn: api.getGraph, staleTime: 30_000, refetchInterval: 60_000 })
  const data = graph.data
  const measure = useCallback((node: HTMLDivElement | null) => {
    if (!node) return
    const observer = new ResizeObserver(entries => {
      const entry = entries[0]
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const adjacency = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const edge of data?.edges || []) {
      if (!map.has(edge.source)) map.set(edge.source, new Set())
      if (!map.has(edge.target)) map.set(edge.target, new Set())
      map.get(edge.source)!.add(edge.target)
      map.get(edge.target)!.add(edge.source)
    }
    return map
  }, [data])

  const graphData = useMemo(() => {
    if (!data) return { nodes: [], links: [] }
    const nodes: NodeObject[] = data.nodes.map(node => ({ ...node, degree: adjacency.get(node.id)?.size || 0 }))
    const links: LinkObject[] = data.edges.map(edge => ({ source: edge.source, target: edge.target, strength: edge.strength, reason: edge.reason }))
    return { nodes, links }
  }, [data, adjacency])
  const ref = useRef<any>(null)

  const neighborOf = (node: NodeObject) => selected ? node.id === selected || adjacency.get(selected)?.has(node.id) : true
  const linkColor = useCallback((link: LinkObject) => {
    const active = !selected || [link.source, link.target].some(side => typeof side === 'object' && side.id === selected)
    if (!active) return 'rgba(128,128,140,0.06)'
    if (link.reason === 'tag') return 'rgba(196,136,42,0.45)'
    if (link.reason === 'both') return 'rgba(134,96,241,0.5)'
    return 'rgba(134,96,241,0.32)'
  }, [selected])

  const nodeCanvasObject = useCallback((node: NodeObject, ctx: CanvasRenderingContext2D, active: boolean) => {
    const inFocus = neighborOf(node)
    const isHovered = node.id === hovered || node.id === selected
    const radius = 3 + Math.min(9, (node.degree || 0) * 1.4)
    ctx.beginPath()
    ctx.arc(node.x || 0, node.y || 0, radius, 0, 2 * Math.PI)
    const color = node.kind === 'research' ? RESEARCH_COLOR : node.kind === 'specialized' ? SPECIALIZED_COLOR : NOTE_COLOR
    ctx.fillStyle = inFocus ? color : hexWithAlpha(color, DIM)
    ctx.fill()
    if (isHovered) { ctx.strokeStyle = hexWithAlpha('#ffffff', 0.85); ctx.lineWidth = 1.6; ctx.stroke() }
    const showLabel = active || isHovered || (selected !== null && inFocus)
    if (showLabel) {
      const label = node.title.length > 26 ? `${node.title.slice(0, 24)}…` : node.title
      ctx.font = `${isHovered ? 500 : 400} ${isHovered ? 11 : 9.5}px 'DM Sans', sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillStyle = inFocus ? (document.documentElement.dataset.theme === 'dark' ? '#e8e6ec' : '#2a2833') : hexWithAlpha('#8c8a94', DIM)
      ctx.fillText(label, node.x || 0, (node.y || 0) + radius + 3)
    }
  }, [hovered, selected, adjacency])

  const nodePointerAreaPaint = useCallback((node: NodeObject, color: string, ctx: CanvasRenderingContext2D) => {
    const radius = 3 + Math.min(9, (node.degree || 0) * 1.4)
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(node.x || 0, node.y || 0, radius + 3, 0, 2 * Math.PI)
    ctx.fill()
  }, [])

  if (graph.isLoading) return <div className="graph-page"><GraphShell onBack={onBack} create={create} empty="loading"><div className="app-loading"><div className="loader"/>Mapping your notes</div></GraphShell></div>
  const hasNotes = (graphData.nodes.length || 0) > 0
  return <div className="graph-page">
    <GraphShell onBack={onBack} create={create}>
      <div className="graph-canvas" ref={measure}>
        {hasNotes ? <ForceGraph2D
          ref={ref}
          width={size.width || undefined}
          height={size.height || undefined}
          graphData={graphData as any}
          backgroundColor="rgba(0,0,0,0)"
          nodeLabel={(node: NodeObject) => `<div style="font:12px/1.4 'DM Sans',sans-serif;padding:2px 0"><strong>${escapeAttr(node.title)}</strong>${node.tags.length ? `<br/><span style="opacity:.7">#${node.tags.join(' · #')}</span>` : ''}</div>`}
          nodeColor={(node: NodeObject) => { const color = node.kind === 'research' ? RESEARCH_COLOR : node.kind === 'specialized' ? SPECIALIZED_COLOR : NOTE_COLOR; return neighborOf(node) ? color : hexWithAlpha(color, DIM) }}
          nodeVal={(node: NodeObject) => 2 + Math.min(8, (node.degree || 0) * 1.2)}
          nodeCanvasObject={nodeCanvasObject as any}
          nodeCanvasObjectMode={(() => true) as any}
          nodePointerAreaPaint={nodePointerAreaPaint as any}
          linkColor={linkColor as any}
          linkWidth={(link: LinkObject) => 0.8 + link.strength * 1.8}
          linkDirectionalParticles={(link: LinkObject) => link.reason === 'both' ? 2 : 0}
          linkDirectionalParticleWidth={1.6}
          d3AlphaDecay={0.02}
          d3VelocityDecay={0.35}
          cooldownTicks={220}
          onEngineStop={() => ref.current?.zoomToFit(500, 70)}
          onNodeClick={(node: NodeObject) => { setSelected(node.id === selected ? null : node.id); ref.current?.centerAt(node.x || 0, node.y || 0, 600) }}
          onNodeHover={(node: NodeObject | null) => setHovered(node ? node.id : null)}
          onBackgroundClick={() => setSelected(null)}
        /> : <div className="graph-empty"><Waypoints size={26}/><h3>No graph yet</h3><p>The graph grows as Muse learns your notes. Create a note, run “Organize”, and connected dots will appear here.</p></div>}
        <aside className="graph-legend"><span><i style={{ background: NOTE_COLOR }}/> Note</span><span><i style={{ background: RESEARCH_COLOR }}/> Research</span><span><i style={{ background: SPECIALIZED_COLOR }}/> Specialized</span><span><i className="edge similar"/> Similar meaning</span><span><i className="edge tag"/> Shared tag</span></aside>
        {hasNotes && selected ? <button className="graph-clear" onClick={() => setSelected(null)}>Clear focus</button> : null}
        {graph.error ? <button className="graph-retry" onClick={() => void graph.refetch()}>Could not load the graph — retry</button> : null}
      </div>
    </GraphShell>
  </div>
}

function GraphShell({ children, onBack, create, empty }: { children: ReactNode; onBack: () => void; create: () => void; empty?: 'loading' }) {
  return <div className="graph-shell">
    <header className="graph-header"><button className="graph-back" onClick={onBack}><ArrowLeft size={17}/> All notes</button><div className="graph-title"><Waypoints size={15}/><strong>Graph</strong>{empty ? <em>loading…</em> : <em>notes linked by meaning</em>}</div><button className="graph-new" onClick={create}><Plus size={15}/> New note</button></header>
    {children}
  </div>
}

function hexWithAlpha(hex: string, alpha: number) {
  const value = hex.replace('#', '')
  const r = parseInt(value.slice(0, 2), 16); const g = parseInt(value.slice(2, 4), 16); const b = parseInt(value.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}
function escapeAttr(value: string) { return value.replace(/[&<>"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[character] as string)) }
