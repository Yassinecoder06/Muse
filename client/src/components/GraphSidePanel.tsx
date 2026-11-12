import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Calendar, ExternalLink, Hash, Link2, Sparkles, X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../services/api'
import { prepareContent, sanitizeHtml } from './Editor'
import { getLinkedNotes } from '../services/graph-filters'
import type { GraphData, GraphNode, Note } from '../types'

export interface GraphSidePanelProps {
  nodeId: string
  onClose: () => void
  onOpenNote: (id: string) => void
  onSelectLinkedNode: (id: string) => void
  graphData: GraphData
  allNodesMap: Map<string, GraphNode>
  canGoBack: boolean
  canGoForward: boolean
  onHistoryBack: () => void
  onHistoryForward: () => void
}

const PANEL_WIDTH_KEY = 'muse-graph-panel-width'
const DEFAULT_WIDTH = 420
const MIN_WIDTH = 320
const MAX_WIDTH_RATIO = 0.65

export function GraphSidePanel({
  nodeId,
  onClose,
  onOpenNote,
  onSelectLinkedNode,
  graphData,
  allNodesMap,
  canGoBack,
  canGoForward,
  onHistoryBack,
  onHistoryForward
}: GraphSidePanelProps) {
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(PANEL_WIDTH_KEY)
      if (saved) {
        const val = parseInt(saved, 10)
        if (!isNaN(val) && val >= MIN_WIDTH) return val
      }
    } catch {
      // Ignore
    }
    return DEFAULT_WIDTH
  })

  const [isDragging, setIsDragging] = useState(false)
  const isDraggingRef = useRef(false)

  // Fetch full note content
  const noteQuery = useQuery({
    queryKey: ['note', nodeId],
    queryFn: () => api.getNote(nodeId),
    staleTime: 30_000
  })

  const nodeMeta = allNodesMap.get(nodeId)
  const fullNote = noteQuery.data

  // Resizable drag handle
  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      if (!isDraggingRef.current) return
      const maxAllowed = window.innerWidth * MAX_WIDTH_RATIO
      const newWidth = Math.max(MIN_WIDTH, Math.min(maxAllowed, window.innerWidth - e.clientX))
      setPanelWidth(newWidth)
    }

    function handleMouseUp() {
      if (isDraggingRef.current) {
        isDraggingRef.current = false
        setIsDragging(false)
        try {
          localStorage.setItem(PANEL_WIDTH_KEY, String(panelWidth))
        } catch {
          // Ignore
        }
      }
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [panelWidth])

  function handleStartDrag(e: React.MouseEvent) {
    e.preventDefault()
    isDraggingRef.current = true
    setIsDragging(true)
  }

  // Linked notes grouped by similar meaning and shared tags
  const linked = getLinkedNotes(nodeId, graphData, allNodesMap)

  // Rendered note content
  const contentRaw = fullNote?.content || ''
  const { html, extractedTitle } = prepareContent(contentRaw)
  const sanitizedContent = sanitizeHtml(html)

  const displayTitle = nodeMeta?.title || fullNote?.title || extractedTitle || 'Untitled note'
  const displayKind = nodeMeta?.kind || fullNote?.kind || 'note'
  const displayTags = nodeMeta?.tags || fullNote?.tags || []
  const displayUpdated = nodeMeta?.updated_at || fullNote?.updated_at
  const wordCount = nodeMeta?.word_count ?? (fullNote?.content ? fullNote.content.replace(/<[^>]*>/g, ' ').trim().split(/\s+/).filter(Boolean).length : 0)

  return (
    <aside
      className="graph-side-panel"
      style={{ width: panelWidth }}
      aria-label="Note details panel"
    >
      {/* Resizer drag handle (desktop only) */}
      <div
        className={`graph-resizer ${isDragging ? 'is-dragging' : ''}`}
        onMouseDown={handleStartDrag}
        title="Drag to resize panel"
      />

      {/* Sheet handle for mobile bottom sheet */}
      <div className="graph-sheet-handle" onClick={onClose} />

      <header className="graph-panel-header">
        <div className="graph-panel-nav">
          <button
            type="button"
            className="graph-nav-btn"
            disabled={!canGoBack}
            onClick={onHistoryBack}
            title="Previous note (History)"
          >
            <ArrowLeft size={14} />
          </button>
          <button
            type="button"
            className="graph-nav-btn"
            disabled={!canGoForward}
            onClick={onHistoryForward}
            title="Next note (History)"
          >
            <ArrowRight size={14} />
          </button>
        </div>

        <div className="graph-panel-actions">
          <button
            type="button"
            className="graph-open-editor-btn"
            onClick={() => onOpenNote(nodeId)}
            title="Open in editor"
          >
            <ExternalLink size={13} />
            <span>Open in editor</span>
          </button>
          <button
            type="button"
            className="graph-close-panel-btn"
            onClick={onClose}
            title="Close panel (Esc)"
          >
            <X size={17} />
          </button>
        </div>
      </header>

      <div className="graph-panel-content">
        <div className="graph-panel-masthead">
          <div className="graph-panel-meta">
            <span className={`graph-kind-badge ${displayKind}`}>{displayKind}</span>
            {displayUpdated && (
              <span>
                <Calendar size={11} style={{ display: 'inline', marginRight: 3, verticalAlign: -1 }} />
                {new Date(displayUpdated).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric'
                })}
              </span>
            )}
            {wordCount > 0 && <span>· {wordCount} words</span>}
          </div>

          <h2 className="graph-panel-title">{displayTitle}</h2>

          {displayTags.length > 0 && (
            <div className="graph-panel-tags">
              {displayTags.map(tag => (
                <span key={tag} className="graph-panel-tag">
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Note body preview */}
        {noteQuery.isLoading ? (
          <div className="graph-note-body" style={{ color: '#8c8a94', fontStyle: 'italic' }}>
            Loading note content…
          </div>
        ) : sanitizedContent ? (
          <div
            className="graph-note-body"
            dangerouslySetInnerHTML={{ __html: sanitizedContent }}
          />
        ) : (
          <div className="graph-note-body" style={{ color: '#8c8a94', fontStyle: 'italic' }}>
            Empty note.
          </div>
        )}

        {/* Linked notes */}
        <section className="graph-linked-section">
          <h4>
            <Link2 size={13} /> Linked Notes
          </h4>

          {/* Similar meaning */}
          {linked.similar.length > 0 && (
            <div>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  color: '#8660f1',
                  marginBottom: 6,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4
                }}
              >
                <Sparkles size={11} /> Similar meaning
              </span>
              <div className="graph-linked-list">
                {linked.similar.map(({ node, strengthPercent }) => (
                  <button
                    key={node.id}
                    type="button"
                    className="graph-linked-card"
                    onClick={() => onSelectLinkedNode(node.id)}
                  >
                    <div className="graph-linked-info">
                      <span className="graph-linked-card-title">{node.title}</span>
                      {node.tags.length > 0 && (
                        <span className="graph-linked-tags">
                          #{node.tags.slice(0, 2).join(' · #')}
                        </span>
                      )}
                    </div>
                    <span className="graph-similarity-badge">{strengthPercent}% match</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Shared tags */}
          {linked.byTag.length > 0 && (
            <div style={{ marginTop: linked.similar.length > 0 ? 12 : 0 }}>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  color: '#c4882a',
                  marginBottom: 6,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4
                }}
              >
                <Hash size={11} /> Shared tags
              </span>
              <div className="graph-linked-list">
                {linked.byTag.map(({ node, sharedTags }) => (
                  <button
                    key={node.id}
                    type="button"
                    className="graph-linked-card"
                    onClick={() => onSelectLinkedNode(node.id)}
                  >
                    <div className="graph-linked-info">
                      <span className="graph-linked-card-title">{node.title}</span>
                      {sharedTags.length > 0 && (
                        <span className="graph-linked-tags" style={{ color: '#c4882a' }}>
                          Shared: #{sharedTags.join(' · #')}
                        </span>
                      )}
                    </div>
                    <span className={`graph-kind-badge ${node.kind}`}>{node.kind}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {linked.similar.length === 0 && linked.byTag.length === 0 && (
            <div style={{ fontSize: '12px', color: '#8c8a94', fontStyle: 'italic', padding: '6px 0' }}>
              No connected notes yet. Add tags or related ideas to link them.
            </div>
          )}
        </section>
      </div>
    </aside>
  )
}
