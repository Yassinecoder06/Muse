import { useState, useEffect } from 'react'
import {
  ListMusic,
  Plus,
  Play,
  Trash2,
  RefreshCw,
  Edit2,
  X,
  Disc,
  ArrowUpDown,
  Search
} from 'lucide-react'
import { api } from '../../services/api'
import { robotMusic } from '../../services/robot-music.service'
import { ConfirmModal } from '../ConfirmModal'
import { DraggableTrackList, type TrackItem } from './DraggableTrackList'

interface Playlist {
  id: string
  name: string
  description?: string
  tracks: TrackItem[]
  created_at: string
  updated_at: string
}

export function MusicPlaylists() {
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [availableSongs, setAvailableSongs] = useState<TrackItem[]>([])
  const [loading, setLoading] = useState(true)

  // Create / Edit Modal State
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [modalTracks, setModalTracks] = useState<TrackItem[]>([])
  const [searchFilter, setSearchFilter] = useState('')
  const [saving, setSaving] = useState(false)

  // Direct Reorder Modal State (for quick reordering from the card)
  const [reorderPlaylist, setReorderPlaylist] = useState<Playlist | null>(null)
  const [reorderTracks, setReorderTracks] = useState<TrackItem[]>([])
  const [savingReorder, setSavingReorder] = useState(false)

  // Delete State
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const loadData = async () => {
    try {
      setLoading(true)
      const [plistRes, songsRes] = await Promise.all([
        api.listMusicPlaylists(),
        api.listMusicSongs()
      ])
      setPlaylists(plistRes.playlists || [])
      setAvailableSongs(songsRes.songs || [])
    } catch (err) {
      console.error('Failed to load playlists or songs', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const openCreateModal = () => {
    setEditingId(null)
    setName('')
    setDescription('')
    setModalTracks([])
    setSearchFilter('')
    setModalOpen(true)
  }

  const openEditModal = (pl: Playlist) => {
    setEditingId(pl.id)
    setName(pl.name)
    setDescription(pl.description || '')
    setModalTracks([...(pl.tracks || [])])
    setSearchFilter('')
    setModalOpen(true)
  }

  const openQuickReorder = (pl: Playlist) => {
    setReorderPlaylist(pl)
    setReorderTracks([...(pl.tracks || [])])
  }

  const handleAddTrackToModal = (song: TrackItem) => {
    setModalTracks(prev => [
      ...prev,
      {
        filename: song.filename,
        title: song.title,
        artist: song.artist,
        url: song.url,
        size: song.size
      }
    ])
  }

  const handleRemoveTrackFromModal = (index: number) => {
    setModalTracks(prev => prev.filter((_, idx) => idx !== index))
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return

    try {
      setSaving(true)
      if (editingId) {
        await api.updateMusicPlaylist(editingId, {
          name: name.trim(),
          description: description.trim(),
          tracks: modalTracks
        })
      } else {
        await api.createMusicPlaylist({
          name: name.trim(),
          description: description.trim(),
          tracks: modalTracks
        })
      }

      setModalOpen(false)
      loadData()
    } catch (err) {
      console.error('Failed to save playlist', err)
    } finally {
      setSaving(false)
    }
  }

  const handleSaveQuickReorder = async () => {
    if (!reorderPlaylist) return
    try {
      setSavingReorder(true)
      await api.updateMusicPlaylist(reorderPlaylist.id, {
        tracks: reorderTracks
      })
      setPlaylists(prev =>
        prev.map(p => (p.id === reorderPlaylist.id ? { ...p, tracks: reorderTracks } : p))
      )
      setReorderPlaylist(null)
    } catch (err) {
      console.error('Failed to save reordered playlist', err)
    } finally {
      setSavingReorder(false)
    }
  }

  const handleDelete = async () => {
    if (!deletingId) return
    try {
      await api.deleteMusicPlaylist(deletingId)
      setPlaylists(prev => prev.filter(p => p.id !== deletingId))
      setDeletingId(null)
    } catch (err) {
      console.error('Failed to delete playlist', err)
    }
  }

  const handlePlayPlaylist = (pl: Playlist, startIndex = 0) => {
    if (!pl.tracks || pl.tracks.length === 0) return
    robotMusic.playPlaylist(pl.name, pl.tracks, startIndex)
  }

  const filteredAvailable = availableSongs.filter(s =>
    `${s.title} ${s.artist || ''} ${s.filename}`.toLowerCase().includes(searchFilter.toLowerCase())
  )

  return (
    <div className="music-playlists-container">
      {/* Header bar */}
      <div className="music-playlists-toolbar">
        <div className="toolbar-info">
          <h3>Your Playlists</h3>
          <span className="toolbar-sub">
            Organize songs into custom mixes and drag to set playback priority
          </span>
        </div>
        <div className="toolbar-actions">
          <button className="music-btn-secondary" onClick={loadData} title="Refresh">
            <RefreshCw size={14} className={loading ? 'spin-icon' : ''} />
            <span>Refresh</span>
          </button>
          <button className="music-btn-primary" onClick={openCreateModal}>
            <Plus size={15} />
            <span>New Playlist</span>
          </button>
        </div>
      </div>

      {/* Grid of Playlists */}
      {loading && playlists.length === 0 ? (
        <div className="music-empty-state">
          <RefreshCw size={28} className="spin-icon" />
          <p>Loading playlists...</p>
        </div>
      ) : playlists.length === 0 ? (
        <div className="music-empty-state">
          <ListMusic size={36} />
          <h3>No Playlists Yet</h3>
          <p>Create your first playlist or ask Bip in chat: "Bip, make a workout playlist with Dua Lipa"!</p>
          <button className="music-btn-primary" onClick={openCreateModal} style={{ marginTop: 8 }}>
            <Plus size={15} />
            <span>Create First Playlist</span>
          </button>
        </div>
      ) : (
        <div className="playlists-grid">
          {playlists.map(pl => {
            const trackCount = (pl.tracks || []).length
            return (
              <div key={pl.id} className="playlist-card">
                <div className="playlist-card-top">
                  <div className="playlist-icon-badge">
                    <ListMusic size={20} />
                  </div>
                  <div className="playlist-meta">
                    <h4 className="playlist-title">{pl.name}</h4>
                    {pl.description && <p className="playlist-desc">{pl.description}</p>}
                    <span className="playlist-count-badge">
                      {trackCount} {trackCount === 1 ? 'track' : 'tracks'}
                    </span>
                  </div>
                </div>

                {/* Priority Track Preview */}
                <div className="playlist-tracks-preview">
                  {trackCount === 0 ? (
                    <span className="playlist-empty-text">No tracks added yet</span>
                  ) : (
                    pl.tracks.slice(0, 3).map((t, idx) => (
                      <div key={`${t.filename}-${idx}`} className="playlist-preview-row">
                        <span className="preview-priority-tag">#{idx + 1}</span>
                        <Disc size={12} className="track-disc-icon" />
                        <span className="track-preview-name">{t.title || t.filename}</span>
                        {t.artist && <span className="track-preview-artist">· {t.artist}</span>}
                      </div>
                    ))
                  )}
                  {trackCount > 3 && (
                    <span className="playlist-more-text">+{trackCount - 3} more in priority queue</span>
                  )}
                </div>

                <div className="playlist-card-footer">
                  <button
                    className="playlist-play-btn"
                    disabled={trackCount === 0}
                    onClick={() => handlePlayPlaylist(pl)}
                    title="Play playlist from top priority track"
                  >
                    <Play size={14} fill="currentColor" />
                    <span>Play Mix</span>
                  </button>

                  <div className="playlist-btn-group">
                    <button
                      className="playlist-icon-action"
                      onClick={() => openQuickReorder(pl)}
                      title="Set playback priority (drag up/down)"
                      disabled={trackCount === 0}
                    >
                      <ArrowUpDown size={14} />
                    </button>
                    <button
                      className="playlist-icon-action"
                      onClick={() => openEditModal(pl)}
                      title="Edit playlist & add songs"
                    >
                      <Edit2 size={14} />
                    </button>
                    <button
                      className="playlist-icon-action delete"
                      onClick={() => setDeletingId(pl.id)}
                      title="Delete playlist"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Full Create / Edit Modal with Draggable Priority */}
      {modalOpen && (
        <div className="playlist-modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="playlist-modal-box modal-wide" onClick={e => e.stopPropagation()}>
            <div className="playlist-modal-header">
              <div className="modal-title-with-icon">
                <ListMusic size={18} />
                <h4>{editingId ? 'Edit Playlist & Priority' : 'Create Playlist & Set Priority'}</h4>
              </div>
              <button className="modal-close-btn" onClick={() => setModalOpen(false)}>
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSave} className="playlist-modal-form">
              <div className="modal-meta-row">
                <div className="modal-field flex-1">
                  <label>Playlist Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Focus Beats, Late Night Coding"
                    value={name}
                    onChange={e => setName(e.target.value)}
                  />
                </div>
                <div className="modal-field flex-2">
                  <label>Description (optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. Upbeat electronic and pop tracks"
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                  />
                </div>
              </div>

              {/* Two-Column Song Selector and Draggable Priority List */}
              <div className="playlist-builder-grid">
                {/* Left: Add music from list */}
                <div className="builder-source-col">
                  <div className="builder-col-header">
                    <div className="header-label-badge">
                      <label className="playlist-col-header-red">Library Songs</label>
                      <span className="count-pill">{availableSongs.length}</span>
                    </div>
                    <div className="builder-search-wrap">
                      <Search size={14} className="builder-search-icon" />
                      <input
                        type="text"
                        className="builder-search-input"
                        placeholder="Search songs to add..."
                        value={searchFilter}
                        onChange={e => setSearchFilter(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="builder-song-picker-list">
                    {filteredAvailable.length === 0 ? (
                      <p className="no-songs-hint">No matching songs found in library.</p>
                    ) : (
                      filteredAvailable.map(song => {
                        const inPlaylistIndices = modalTracks
                          .map((t, i) => (t.filename === song.filename ? i + 1 : null))
                          .filter(Boolean)

                        const isAdded = inPlaylistIndices.length > 0

                        return (
                          <div
                            key={song.filename}
                            className={`builder-picker-item ${isAdded ? 'is-added' : ''}`}
                          >
                            <div className="picker-song-meta">
                              <span className="picker-song-title music-song-name-red">
                                {song.title}
                              </span>
                              {song.artist && (
                                <span className="picker-song-artist">{song.artist}</span>
                              )}
                            </div>
                            <div className="picker-song-actions">
                              {isAdded && (
                                <span className="picker-priority-pill" title="Current priority position">
                                  #{inPlaylistIndices.join(', #')}
                                </span>
                              )}
                              <button
                                type="button"
                                className={`picker-add-btn ${isAdded ? 'secondary' : 'primary'}`}
                                onClick={() => handleAddTrackToModal(song)}
                                title={isAdded ? 'Add another instance to playlist' : 'Add to playlist'}
                              >
                                <Plus size={13} />
                                <span>{isAdded ? 'Add again' : 'Add'}</span>
                              </button>
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>

                {/* Right: Draggable component for priority order */}
                <div className="builder-priority-col">
                  <div className="builder-col-header">
                    <div className="header-label-badge">
                      <label className="playlist-col-header-red">Playback Priority Order</label>
                      <span className="count-pill priority-pill">{modalTracks.length}</span>
                    </div>
                    <span className="builder-priority-hint">
                      Drag tracks up & down to set playing sequence
                    </span>
                  </div>

                  <div className="builder-priority-scroll-area">
                    <DraggableTrackList
                      tracks={modalTracks}
                      onReorder={setModalTracks}
                      onRemove={handleRemoveTrackFromModal}
                      emptyMessage="Click '+ Add' on any song from the left to set its playback priority."
                    />
                  </div>
                </div>
              </div>

              <div className="playlist-modal-actions">
                <button
                  type="button"
                  className="music-btn-secondary"
                  onClick={() => setModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="music-btn-primary"
                  disabled={saving || !name.trim()}
                >
                  {saving ? 'Saving...' : editingId ? 'Update Playlist' : 'Create Playlist'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Quick Priority Reorder Modal (Drag-and-Drop focused) */}
      {reorderPlaylist && (
        <div className="playlist-modal-overlay" onClick={() => setReorderPlaylist(null)}>
          <div className="playlist-modal-box" onClick={e => e.stopPropagation()}>
            <div className="playlist-modal-header">
              <div className="modal-title-with-icon">
                <ArrowUpDown size={18} />
                <h4>Playback Priority: {reorderPlaylist.name}</h4>
              </div>
              <button className="modal-close-btn" onClick={() => setReorderPlaylist(null)}>
                <X size={16} />
              </button>
            </div>

            <div className="quick-reorder-body">
              <p className="reorder-instructions">
                Drag songs up and down to change which song Bip plays first, second, and third.
              </p>

              <div className="quick-reorder-scroll">
                <DraggableTrackList
                  tracks={reorderTracks}
                  onReorder={setReorderTracks}
                  onRemove={idx => setReorderTracks(prev => prev.filter((_, i) => i !== idx))}
                  showPlayButton={true}
                  onPlayTrack={(_, idx) => {
                    handlePlayPlaylist({ ...reorderPlaylist, tracks: reorderTracks }, idx)
                    setReorderPlaylist(null)
                  }}
                />
              </div>

              <div className="playlist-modal-actions">
                <button
                  type="button"
                  className="music-btn-secondary"
                  onClick={() => setReorderPlaylist(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="music-btn-primary"
                  onClick={handleSaveQuickReorder}
                  disabled={savingReorder}
                >
                  {savingReorder ? 'Saving...' : 'Save Priority Order'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={!!deletingId}
        title="Delete Playlist"
        message="Are you sure you want to delete this playlist? The song files themselves will not be deleted."
        confirmText="Delete Playlist"
        danger
        onConfirm={handleDelete}
        onCancel={() => setDeletingId(null)}
      />
    </div>
  )
}
