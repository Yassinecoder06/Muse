import { useEffect, useRef, useState } from 'react'
import { Search, Sparkles, X } from 'lucide-react'
import { api } from '../services/api'
import { searchGraphNodes } from '../services/graph-filters'
import type { GraphNode, Note } from '../types'

export interface GraphSearchBarProps {
  query: string
  setQuery: (q: string) => void
  byMeaning: boolean
  setByMeaning: (val: boolean) => void
  allNodes: GraphNode[]
  onSelectNode: (nodeId: string) => void
  onMatchesChange: (matchedNodeIds: Set<string> | null) => void
}

export function GraphSearchBar({
  query,
  setQuery,
  byMeaning,
  setByMeaning,
  allNodes,
  onSelectNode,
  onMatchesChange
}: GraphSearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [highlightIndex, setHighlightIndex] = useState(0)
  const [semanticResults, setSemanticResults] = useState<Note[]>([])
  const [isSearchingSemantic, setIsSearchingSemantic] = useState(false)

  // Hotkey "/" to focus search box
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
        setDropdownOpen(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Fuzzy local search or semantic API search
  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      onMatchesChange(null)
      setSemanticResults([])
      setDropdownOpen(false)
      return
    }

    if (byMeaning) {
      setIsSearchingSemantic(true)
      const timer = setTimeout(async () => {
        try {
          const results = await api.searchNotes(trimmed)
          setSemanticResults(results)
          const ids = new Set(results.map(n => n.id))
          onMatchesChange(ids)
          setDropdownOpen(true)
          setHighlightIndex(0)
        } catch {
          // Fallback to local search if semantic endpoint fails
          const localMatches = searchGraphNodes(allNodes, trimmed)
          onMatchesChange(new Set(localMatches.map(m => m.node.id)))
        } finally {
          setIsSearchingSemantic(false)
        }
      }, 300)
      return () => clearTimeout(timer)
    } else {
      const localMatches = searchGraphNodes(allNodes, trimmed)
      onMatchesChange(new Set(localMatches.map(m => m.node.id)))
      setDropdownOpen(true)
      setHighlightIndex(0)
    }
  }, [query, byMeaning, allNodes, onMatchesChange])

  // Get active dropdown items
  const localResults = !byMeaning && query.trim() ? searchGraphNodes(allNodes, query.trim()).slice(0, 10) : []
  const displayItems: { id: string; title: string; kind: string; tags: string[]; hint?: string }[] = byMeaning
    ? semanticResults.slice(0, 10).map(note => ({
        id: note.id,
        title: note.title || 'Untitled note',
        kind: note.kind,
        tags: note.tags || [],
        hint: 'semantic match'
      }))
    : localResults.map(res => ({
        id: res.node.id,
        title: res.node.title,
        kind: res.node.kind,
        tags: res.node.tags,
        hint: res.matchField === 'tag' ? `#${res.matchedTag}` : undefined
      }))

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!dropdownOpen || displayItems.length === 0) {
      if (e.key === 'ArrowDown') setDropdownOpen(true)
      return
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightIndex(i => (i + 1) % displayItems.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightIndex(i => (i - 1 + displayItems.length) % displayItems.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const selected = displayItems[highlightIndex]
      if (selected) {
        onSelectNode(selected.id)
        setDropdownOpen(false)
        inputRef.current?.blur()
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setDropdownOpen(false)
      inputRef.current?.blur()
    }
  }

  function handleSelect(id: string) {
    onSelectNode(id)
    setDropdownOpen(false)
  }

  return (
    <div className="graph-search-wrap">
      <div className="graph-search-input-box">
        <Search size={14} className="text-muted" style={{ opacity: 0.6 }} />
        <input
          ref={inputRef}
          type="text"
          className="graph-search-input"
          placeholder={byMeaning ? 'Search by meaning…' : 'Search titles and tags…'}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => {
            if (query.trim()) setDropdownOpen(true)
          }}
          onKeyDown={handleKeyDown}
        />
        {query ? (
          <button
            type="button"
            className="graph-close-panel-btn"
            onClick={() => {
              setQuery('')
              onMatchesChange(null)
              setDropdownOpen(false)
            }}
            title="Clear search"
          >
            <X size={13} />
          </button>
        ) : (
          <kbd className="graph-kbd">/</kbd>
        )}
        <button
          type="button"
          className={`graph-semantic-toggle ${byMeaning ? 'active' : ''}`}
          onClick={() => setByMeaning(!byMeaning)}
          title="Toggle semantic search (searches note meaning via vector embeddings)"
        >
          <Sparkles size={11} />
          <span>By meaning</span>
        </button>
      </div>

      {dropdownOpen && query.trim() && (
        <div className="graph-search-dropdown" onMouseDown={e => e.preventDefault()}>
          {isSearchingSemantic ? (
            <div className="graph-search-empty">Searching notes by meaning…</div>
          ) : displayItems.length > 0 ? (
            displayItems.map((item, index) => (
              <button
                key={item.id}
                type="button"
                className={`graph-search-item ${index === highlightIndex ? 'highlighted' : ''}`}
                onClick={() => handleSelect(item.id)}
                onMouseEnter={() => setHighlightIndex(index)}
              >
                <div className="graph-search-item-header">
                  <span className="graph-search-item-title">{item.title}</span>
                  <span className={`graph-kind-badge ${item.kind}`}>{item.kind}</span>
                </div>
                {(item.tags.length > 0 || item.hint) && (
                  <div className="graph-search-item-tags">
                    {item.hint && <span className="graph-search-item-tag">{item.hint}</span>}
                    {item.tags.slice(0, 3).map(tag => (
                      <span key={tag} className="graph-search-item-tag">
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            ))
          ) : (
            <div className="graph-search-empty">No matching notes found.</div>
          )}
        </div>
      )}
    </div>
  )
}
