import { useMemo } from 'react'
import { RotateCcw, SlidersHorizontal, X } from 'lucide-react'
import type { GraphFiltersState, NodeKindFilter, UpdatedRangeFilter } from '../services/graph-filters'
import { getTagCounts } from '../services/graph-filters'
import type { GraphNode } from '../types'

export interface GraphFiltersPanelProps {
  filters: GraphFiltersState
  setFilters: React.Dispatch<React.SetStateAction<GraphFiltersState>>
  onReset: () => void
  onClose: () => void
  allNodes: GraphNode[]
  onFitView?: () => void
}

export function GraphFiltersPanel({
  filters,
  setFilters,
  onReset,
  onClose,
  allNodes,
  onFitView
}: GraphFiltersPanelProps) {
  const tagCounts = useMemo(() => getTagCounts(allNodes), [allNodes])

  const kindCounts = useMemo(() => {
    let note = 0
    let specialized = 0
    let research = 0
    for (const n of allNodes) {
      if (n.kind === 'research') research++
      else if (n.kind === 'specialized') specialized++
      else note++
    }
    return { note, specialized, research }
  }, [allNodes])

  function toggleKind(kind: NodeKindFilter) {
    setFilters(prev => {
      const exists = prev.kinds.includes(kind)
      const nextKinds = exists ? prev.kinds.filter(k => k !== kind) : [...prev.kinds, kind]
      // Don't allow unchecking all kinds
      return { ...prev, kinds: nextKinds.length > 0 ? nextKinds : [kind] }
    })
  }

  function toggleTag(tag: string) {
    setFilters(prev => {
      const exists = prev.tags.includes(tag)
      return { ...prev, tags: exists ? prev.tags.filter(t => t !== tag) : [...prev.tags, tag] }
    })
  }

  function toggleEdgeType(edgeType: 'similar' | 'tag') {
    setFilters(prev => {
      const exists = prev.edgeTypes.includes(edgeType)
      const next = exists ? prev.edgeTypes.filter(e => e !== edgeType) : [...prev.edgeTypes, edgeType]
      return { ...prev, edgeTypes: next.length > 0 ? next : [edgeType] }
    })
  }

  return (
    <aside className="graph-filters-drawer" aria-label="Graph filters and view options">
      <header className="graph-filters-header">
        <h3>
          <SlidersHorizontal size={15} /> Filters & View
        </h3>
        <div className="graph-filters-actions">
          <button type="button" className="graph-filters-reset" onClick={onReset} title="Reset all filters to default">
            <RotateCcw size={12} style={{ display: 'inline', marginRight: 4 }} />
            Reset
          </button>
          <button type="button" className="graph-close-panel-btn" onClick={onClose} title="Close filters">
            <X size={16} />
          </button>
        </div>
      </header>

      <div className="graph-filters-body">
        {/* Node Kind */}
        <section className="graph-filter-section">
          <h4>Note Kind</h4>
          <div className="graph-chip-grid">
            <button
              type="button"
              className={`graph-chip ${filters.kinds.includes('note') ? 'active' : ''}`}
              onClick={() => toggleKind('note')}
            >
              Notes <span className="graph-chip-count">({kindCounts.note})</span>
            </button>
            <button
              type="button"
              className={`graph-chip ${filters.kinds.includes('specialized') ? 'active' : ''}`}
              onClick={() => toggleKind('specialized')}
            >
              Specialized <span className="graph-chip-count">({kindCounts.specialized})</span>
            </button>
            <button
              type="button"
              className={`graph-chip ${filters.kinds.includes('research') ? 'active' : ''}`}
              onClick={() => toggleKind('research')}
            >
              Research <span className="graph-chip-count">({kindCounts.research})</span>
            </button>
          </div>
        </section>

        {/* Tags */}
        {tagCounts.length > 0 && (
          <section className="graph-filter-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h4>Tags</h4>
              <button
                type="button"
                className="graph-filters-reset"
                style={{ fontSize: '10.5px' }}
                onClick={() =>
                  setFilters(prev => ({
                    ...prev,
                    tagMatchMode: prev.tagMatchMode === 'any' ? 'all' : 'any'
                  }))
                }
              >
                Match: {filters.tagMatchMode === 'any' ? 'Any' : 'All'}
              </button>
            </div>
            <div className="graph-chip-grid" style={{ maxHeight: 120, overflowY: 'auto' }}>
              {tagCounts.map(({ tag, count }) => {
                const active = filters.tags.includes(tag)
                return (
                  <button
                    key={tag}
                    type="button"
                    className={`graph-chip ${active ? 'active' : ''}`}
                    onClick={() => toggleTag(tag)}
                  >
                    #{tag} <span className="graph-chip-count">({count})</span>
                  </button>
                )
              })}
            </div>
          </section>
        )}

        {/* Updated Range */}
        <section className="graph-filter-section">
          <h4>Updated within</h4>
          <div className="graph-chip-grid">
            {(['all', '7d', '30d', '90d', 'custom'] as UpdatedRangeFilter[]).map(range => (
              <button
                key={range}
                type="button"
                className={`graph-chip ${filters.updatedRange === range ? 'active' : ''}`}
                onClick={() => setFilters(prev => ({ ...prev, updatedRange: range }))}
              >
                {range === 'all'
                  ? 'All time'
                  : range === '7d'
                  ? '7 days'
                  : range === '30d'
                  ? '30 days'
                  : range === '90d'
                  ? '90 days'
                  : 'Custom'}
              </button>
            ))}
          </div>
          {filters.updatedRange === 'custom' && (
            <div className="graph-custom-dates">
              <input
                type="date"
                value={filters.customDateStart || ''}
                onChange={e => setFilters(prev => ({ ...prev, customDateStart: e.target.value }))}
                title="Start date"
              />
              <input
                type="date"
                value={filters.customDateEnd || ''}
                onChange={e => setFilters(prev => ({ ...prev, customDateEnd: e.target.value }))}
                title="End date"
              />
            </div>
          )}
        </section>

        {/* Edge Types */}
        <section className="graph-filter-section">
          <h4>Edge Types</h4>
          <div className="graph-chip-grid">
            <button
              type="button"
              className={`graph-chip ${filters.edgeTypes.includes('similar') ? 'active' : ''}`}
              onClick={() => toggleEdgeType('similar')}
            >
              Similar meaning
            </button>
            <button
              type="button"
              className={`graph-chip ${filters.edgeTypes.includes('tag') ? 'active' : ''}`}
              onClick={() => toggleEdgeType('tag')}
            >
              Shared tags
            </button>
          </div>
        </section>

        {/* Similarity Threshold Slider */}
        <section className="graph-filter-section">
          <div className="graph-slider-row">
            <div className="graph-slider-label">
              <span>Similarity threshold</span>
              <strong>{Math.round(filters.minSimilarity * 100)}%</strong>
            </div>
            <input
              type="range"
              min="0.55"
              max="0.95"
              step="0.01"
              value={filters.minSimilarity}
              className="graph-slider"
              onChange={e => setFilters(prev => ({ ...prev, minSimilarity: parseFloat(e.target.value) }))}
            />
          </div>
        </section>

        {/* Connections & Density */}
        <section className="graph-filter-section">
          <h4>Density & Connections</h4>
          <label className="graph-checkbox-row">
            <input
              type="checkbox"
              checked={filters.hideOrphans}
              onChange={e => setFilters(prev => ({ ...prev, hideOrphans: e.target.checked }))}
            />
            <span>Hide orphan notes (0 links)</span>
          </label>
          <div className="graph-slider-row" style={{ marginTop: 6 }}>
            <div className="graph-slider-label">
              <span>Minimum connections</span>
              <strong>{filters.minConnections}</strong>
            </div>
            <input
              type="range"
              min="0"
              max="5"
              step="1"
              value={filters.minConnections}
              className="graph-slider"
              onChange={e => setFilters(prev => ({ ...prev, minConnections: parseInt(e.target.value, 10) }))}
            />
          </div>
        </section>

        {/* Status flags */}
        <section className="graph-filter-section">
          <h4>Flags</h4>
          <label className="graph-checkbox-row">
            <input
              type="checkbox"
              checked={filters.favoritesOnly}
              onChange={e => setFilters(prev => ({ ...prev, favoritesOnly: e.target.checked }))}
            />
            <span>Favorites only</span>
          </label>
          <label className="graph-checkbox-row">
            <input
              type="checkbox"
              checked={filters.includeArchived}
              onChange={e => setFilters(prev => ({ ...prev, includeArchived: e.target.checked }))}
            />
            <span>Include archived notes</span>
          </label>
        </section>

        {/* View Options */}
        <section className="graph-filter-section">
          <h4>View Options</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div>
              <span className="graph-slider-label" style={{ marginBottom: 4, display: 'block' }}>
                Color nodes by
              </span>
              <select
                className="graph-select"
                value={filters.colorBy}
                onChange={e => setFilters(prev => ({ ...prev, colorBy: e.target.value as any }))}
              >
                <option value="kind">Kind (Note / Specialized / Research)</option>
                <option value="tag">First tag</option>
                <option value="age">Age (Recent to Older)</option>
              </select>
            </div>

            <div>
              <span className="graph-slider-label" style={{ marginBottom: 4, display: 'block' }}>
                Size nodes by
              </span>
              <select
                className="graph-select"
                value={filters.sizeBy}
                onChange={e => setFilters(prev => ({ ...prev, sizeBy: e.target.value as any }))}
              >
                <option value="connections">Connections count</option>
                <option value="length">Note content length</option>
              </select>
            </div>

            <div>
              <span className="graph-slider-label" style={{ marginBottom: 4, display: 'block' }}>
                Labels
              </span>
              <select
                className="graph-select"
                value={filters.labelsMode}
                onChange={e => setFilters(prev => ({ ...prev, labelsMode: e.target.value as any }))}
              >
                <option value="hover">On hover / focus</option>
                <option value="always">Always show</option>
                <option value="off">Off</option>
              </select>
            </div>

            {onFitView && (
              <button
                type="button"
                className="graph-btn"
                style={{ justifyContent: 'center', marginTop: 4 }}
                onClick={onFitView}
              >
                Fit to view
              </button>
            )}
          </div>
        </section>
      </div>
    </aside>
  )
}
