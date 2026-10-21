import React, { useState, useEffect } from 'react'
import { Search, Image as ImageIcon, Check, X, RefreshCw, Music2 } from 'lucide-react'
import { api } from '../../services/api'

interface Candidate {
  trackId: number
  title: string
  artist: string
  album: string
  coverUrl: string
  thumbnailUrl: string
  releaseDate?: string
}

interface CoverArtModalProps {
  isOpen: boolean
  song: { filename: string; title: string; artist?: string; coverUrl?: string } | null
  onClose: () => void
  onCoverSelected: (filename: string, newCoverUrl: string) => void
}

export function CoverArtModal({
  isOpen,
  song,
  onClose,
  onCoverSelected
}: CoverArtModalProps) {
  const [query, setQuery] = useState('')
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [loading, setLoading] = useState(false)
  const [savingId, setSavingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen && song) {
      const defaultQuery = song.artist
        ? `${song.artist} ${song.title}`
        : song.title
      setQuery(defaultQuery)
      handleSearch(defaultQuery)
    } else {
      setCandidates([])
      setError(null)
    }
  }, [isOpen, song?.filename])

  const handleSearch = async (termToSearch?: string) => {
    const term = (typeof termToSearch === 'string' ? termToSearch : query).trim()
    if (!term) return
    try {
      setLoading(true)
      setError(null)
      const res = await api.searchMusicCovers(term)
      setCandidates(res.candidates || [])
      if ((res.candidates || []).length === 0) {
        setError('No album artwork found for this search term on iTunes.')
      }
    } catch (err: any) {
      console.error('Failed to search covers:', err)
      setError(err?.message || 'Error searching iTunes database.')
    } finally {
      setLoading(false)
    }
  }

  const handleSelectCover = async (candidate: Candidate) => {
    if (!song) return
    try {
      setSavingId(candidate.trackId)
      setError(null)
      const res = await api.saveMusicCover(song.filename, candidate.coverUrl)
      if (res.success) {
        onCoverSelected(song.filename, res.coverUrl)
        onClose()
      } else {
        setError(res.message || 'Could not save cover artwork.')
      }
    } catch (err: any) {
      console.error('Failed to save cover art:', err)
      setError(err?.message || 'Failed to download and persist cover art.')
    } finally {
      setSavingId(null)
    }
  }

  if (!isOpen || !song) return null

  return (
    <div className="playlist-modal-overlay" onClick={onClose}>
      <div className="playlist-modal-box cover-art-modal-box" onClick={e => e.stopPropagation()}>
        <div className="playlist-modal-header">
          <div className="modal-title-with-icon">
            <ImageIcon size={18} className="cover-modal-icon" />
            <div>
              <h4>Search & Choose Album Artwork</h4>
              <span className="cover-modal-sub">Powered by iTunes High-Resolution Catalog</span>
            </div>
          </div>
          <button className="modal-close-btn" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>

        <div className="cover-art-modal-body">
          {/* Target Track Info Banner */}
          <div className="cover-target-banner">
            <div className="cover-target-thumb-wrap">
              <img
                src={song.coverUrl || `/api/music/cover/${encodeURIComponent(song.filename)}`}
                alt={song.title}
                className="cover-target-thumb"
                onError={e => {
                  ;(e.currentTarget as HTMLElement).style.display = 'none'
                }}
              />
            </div>
            <div className="cover-target-meta">
              <span className="cover-target-title">{song.title}</span>
              {song.artist && <span className="cover-target-artist">{song.artist}</span>}
              <span className="cover-target-file">{song.filename}</span>
            </div>
          </div>

          {/* Search Input Form */}
          <form
            onSubmit={e => {
              e.preventDefault()
              handleSearch()
            }}
            className="cover-search-form"
          >
            <div className="cover-search-input-wrap">
              <Search size={16} className="search-icon-inside" />
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search artist, song, or album..."
                className="cover-search-input"
              />
            </div>
            <button
              type="submit"
              className="music-btn-primary cover-search-submit-btn"
              disabled={loading || !query.trim()}
            >
              {loading ? <RefreshCw size={14} className="spin-icon" /> : <Search size={14} />}
              <span>Search</span>
            </button>
          </form>

          {error && <div className="cover-search-error">{error}</div>}

          {/* Candidates Grid */}
          <div className="cover-candidates-container">
            {loading ? (
              <div className="cover-loading-state">
                <RefreshCw size={24} className="spin-icon" />
                <span>Searching iTunes high-res artwork...</span>
              </div>
            ) : candidates.length > 0 ? (
              <div className="cover-candidates-grid">
                {candidates.map(candidate => {
                  const isSaving = savingId === candidate.trackId
                  return (
                    <div
                      key={candidate.trackId}
                      className={`cover-candidate-card ${isSaving ? 'saving' : ''}`}
                      onClick={() => !savingId && handleSelectCover(candidate)}
                    >
                      <div className="cover-candidate-art-wrap">
                        <img
                          src={candidate.coverUrl || candidate.thumbnailUrl}
                          alt={candidate.title}
                          className="cover-candidate-art"
                          loading="lazy"
                        />
                        <div className="cover-hover-overlay">
                          <Check size={20} />
                          <span>{isSaving ? 'Saving...' : 'Select Cover'}</span>
                        </div>
                      </div>
                      <div className="cover-candidate-meta">
                        <span className="candidate-title" title={candidate.title}>
                          {candidate.title}
                        </span>
                        <span className="candidate-artist" title={candidate.artist}>
                          {candidate.artist}
                        </span>
                        {candidate.album && (
                          <span className="candidate-album" title={candidate.album}>
                            {candidate.album}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        className="candidate-select-btn"
                        disabled={!!savingId}
                        onClick={e => {
                          e.stopPropagation()
                          handleSelectCover(candidate)
                        }}
                      >
                        {isSaving ? 'Applying...' : 'Use Artwork'}
                      </button>
                    </div>
                  )
                })}
              </div>
            ) : null}
          </div>
        </div>

        <div className="playlist-modal-actions">
          <button type="button" className="music-btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
