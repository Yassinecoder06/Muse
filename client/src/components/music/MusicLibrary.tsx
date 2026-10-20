import { useState, useEffect } from 'react'
import {
  Play,
  Pause,
  Trash2,
  Mic,
  Music2,
  Search,
  Volume2,
  VolumeX,
  RefreshCw,
  Clock,
  HardDrive,
  ListPlus,
  ListMusic,
  X,
  Check,
  CheckSquare,
  Plus,
  ArrowUpCircle,
  PlayCircle
} from 'lucide-react'
import { api } from '../../services/api'
import { robotMusic, type MusicPlayerState } from '../../services/robot-music.service'
import { ConfirmModal } from '../ConfirmModal'
import { DraggableTrackList, type TrackItem } from './DraggableTrackList'

interface MusicTrackItem {
  filename: string
  title: string
  artist?: string
  size: number
  mtime: number
  url: string
}

interface Playlist {
  id: string
  name: string
  description?: string
  tracks: TrackItem[]
}

export function MusicLibrary({
  onRefreshTasks
}: {
  onRefreshTasks?: () => void
}) {
  const [songs, setSongs] = useState<MusicTrackItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [playerState, setPlayerState] = useState<MusicPlayerState>(robotMusic.getState())
  const [showQueue, setShowQueue] = useState(false)

  // Delete State
  const [deletingSong, setDeletingSong] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // Batch Selection & Deletion State (like notes)
  const [selectedSongs, setSelectedSongs] = useState<string[]>([])
  const [batchConfirmOpen, setBatchConfirmOpen] = useState(false)
  const [isBatchDeleting, setIsBatchDeleting] = useState(false)

  const toggleSelect = (filename: string) => {
    setSelectedSongs(current =>
      current.includes(filename) ? current.filter(f => f !== filename) : [...current, filename]
    )
  }

  // Add to Playlist modal state
  const [targetSong, setTargetSong] = useState<MusicTrackItem | null>(null)
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [loadingPlaylists, setLoadingPlaylists] = useState(false)
  const [newPlaylistName, setNewPlaylistName] = useState('')
  const [addingToId, setAddingToId] = useState<string | null>(null)
  const [addedStatus, setAddedStatus] = useState<string | null>(null)

  const fetchSongs = async () => {
    try {
      setLoading(true)
      const res = await api.listMusicSongs()
      setSongs(res.songs || [])
    } catch (err) {
      console.error('Failed to load songs', err)
    } finally {
      setLoading(false)
    }
  }

  const fetchPlaylists = async () => {
    try {
      setLoadingPlaylists(true)
      const res = await api.listMusicPlaylists()
      setPlaylists(res.playlists || [])
    } catch (err) {
      console.error('Failed to load playlists', err)
    } finally {
      setLoadingPlaylists(false)
    }
  }

  useEffect(() => {
    fetchSongs()
    const unsubscribe = robotMusic.subscribe(state => setPlayerState(state))
    return () => unsubscribe()
  }, [])

  const handlePlayToggle = (song: MusicTrackItem) => {
    if (playerState.currentTrack?.filename === song.filename) {
      robotMusic.togglePlay()
    } else {
      robotMusic.playTrack(song)
    }
  }

  const openAddToPlaylist = (song: MusicTrackItem) => {
    setTargetSong(song)
    setAddedStatus(null)
    setNewPlaylistName('')
    fetchPlaylists()
  }

  const handleAddSongToPlaylist = async (pl: Playlist) => {
    if (!targetSong) return
    try {
      setAddingToId(pl.id)
      const trackObj: TrackItem = {
        filename: targetSong.filename,
        title: targetSong.title,
        artist: targetSong.artist,
        url: targetSong.url,
        size: targetSong.size
      }
      const existing = pl.tracks || []
      const updated = [...existing, trackObj]

      await api.updateMusicPlaylist(pl.id, { tracks: updated })
      setPlaylists(prev => prev.map(p => (p.id === pl.id ? { ...p, tracks: updated } : p)))
      setAddedStatus(`Added to "${pl.name}" (Priority #${updated.length})!`)
      setTimeout(() => setAddedStatus(null), 2500)
    } catch (err) {
      console.error('Failed to add song to playlist', err)
    } finally {
      setAddingToId(null)
    }
  }

  const handleCreateAndAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newPlaylistName.trim() || !targetSong) return
    try {
      setAddingToId('new')
      const trackObj: TrackItem = {
        filename: targetSong.filename,
        title: targetSong.title,
        artist: targetSong.artist,
        url: targetSong.url,
        size: targetSong.size
      }
      const res = await api.createMusicPlaylist({
        name: newPlaylistName.trim(),
        tracks: [trackObj]
      })
      setPlaylists(prev => [...prev, res])
      setAddedStatus(`Created "${newPlaylistName}" with top priority!`)
      setNewPlaylistName('')
      setTimeout(() => setAddedStatus(null), 2500)
    } catch (err) {
      console.error('Failed to create playlist and add song', err)
    } finally {
      setAddingToId(null)
    }
  }

  const handleAddSongToQueue = (priority: 'next' | 'end') => {
    if (!targetSong) return
    robotMusic.addToQueue(
      {
        filename: targetSong.filename,
        title: targetSong.title,
        artist: targetSong.artist,
        url: targetSong.url,
        size: targetSong.size
      },
      priority
    )
    setAddedStatus(
      priority === 'next'
        ? 'Added as Next Song in Queue!'
        : 'Added to End of Playback Queue!'
    )
    setTimeout(() => setAddedStatus(null), 2500)
  }

  const handleDelete = async () => {
    if (!deletingSong) return
    try {
      setIsDeleting(true)
      if (playerState.currentTrack?.filename === deletingSong) {
        robotMusic.pause()
      }
      await api.deleteMusicSong(deletingSong)
      setSongs(prev => prev.filter(s => s.filename !== deletingSong))
      setSelectedSongs(prev => prev.filter(f => f !== deletingSong))
      setDeletingSong(null)
      onRefreshTasks?.()
    } catch (err) {
      console.error('Failed to delete song', err)
    } finally {
      setIsDeleting(false)
    }
  }

  const handleBatchDelete = async () => {
    if (selectedSongs.length === 0) return
    try {
      setIsBatchDeleting(true)
      if (playerState.currentTrack && selectedSongs.includes(playerState.currentTrack.filename)) {
        robotMusic.pause()
      }
      await api.deleteMusicSongsBatch(selectedSongs)
      setSongs(prev => prev.filter(s => !selectedSongs.includes(s.filename)))
      setSelectedSongs([])
      setBatchConfirmOpen(false)
      onRefreshTasks?.()
    } catch (err) {
      console.error('Failed to batch delete songs', err)
    } finally {
      setIsBatchDeleting(false)
    }
  }

  const formatSize = (bytes: number) => {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${Math.round(bytes / 1024)} KB`
  }

  const formatTime = (secs: number) => {
    if (!secs || isNaN(secs)) return '0:00'
    const m = Math.floor(secs / 60)
    const s = Math.floor(secs % 60)
    return `${m}:${s < 10 ? '0' : ''}${s}`
  }

  const formatDate = (ms?: number) => {
    if (!ms) return ''
    return new Date(ms).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  }

  const filtered = songs.filter(s =>
    `${s.title} ${s.artist || ''} ${s.filename}`.toLowerCase().includes(search.toLowerCase())
  )

  const isCurrentPlaying = (filename: string) =>
    playerState.currentTrack?.filename === filename && playerState.isPlaying

  const activeQueue = playerState.queue || (playerState.currentTrack ? [playerState.currentTrack] : [])

  return (
    <div className="music-library-container">
      {/* Search & Actions Bar */}
      <div className="music-library-toolbar">
        <div className="music-search-wrap">
          <Search size={16} className="music-search-icon" />
          <input
            type="text"
            className="music-search-input"
            placeholder="Filter library by title or artist..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <button className="music-btn-secondary" onClick={fetchSongs} title="Refresh song list">
          <RefreshCw size={15} className={loading ? 'spin-icon' : ''} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Floating Active Player if a track is active */}
      {playerState.currentTrack && (
        <div className="music-player-wrapper">
          <div className="music-active-player-banner">
            <div className="player-track-info">
              <div className="player-track-icon">
                <Music2 size={20} className={playerState.isPlaying ? 'pulsing-note' : ''} />
              </div>
              <div className="player-track-meta">
                <span className="player-title">{playerState.currentTrack.title}</span>
                <span className="player-bip-tag">
                  <Mic size={12} /> Bip Singing Companion
                  {playerState.playlistName && ` · ${playerState.playlistName}`}
                </span>
              </div>
            </div>

            <div className="player-controls">
              <button
                className="player-play-btn"
                onClick={() => robotMusic.togglePlay()}
                title={playerState.isPlaying ? 'Pause' : 'Play'}
              >
                {playerState.isPlaying ? (
                  <Pause size={18} />
                ) : (
                  <Play size={18} fill="currentColor" />
                )}
              </button>
              <span className="player-time-text">
                {formatTime(playerState.currentTime)} / {formatTime(playerState.duration)}
              </span>
              <input
                type="range"
                className="player-scrub-slider"
                min={0}
                max={playerState.duration || 100}
                value={playerState.currentTime || 0}
                onChange={e => robotMusic.seek(parseFloat(e.target.value))}
              />
            </div>

            <div className="player-volume-wrap">
              <button
                className="player-vol-icon-btn"
                onClick={() => robotMusic.setVolume(playerState.volume > 0 ? 0 : 0.8)}
              >
                {playerState.volume > 0 ? <Volume2 size={16} /> : <VolumeX size={16} />}
              </button>
              <input
                type="range"
                className="player-vol-slider"
                min={0}
                max={1}
                step={0.05}
                value={playerState.volume}
                onChange={e => robotMusic.setVolume(parseFloat(e.target.value))}
              />
            </div>

            {/* Priority Queue Toggle Button */}
            <button
              className={`player-queue-toggle-btn ${showQueue ? 'active' : ''}`}
              onClick={() => setShowQueue(!showQueue)}
              title="Open playback priority queue"
            >
              <ListMusic size={15} />
              <span>Queue ({activeQueue.length})</span>
            </button>
          </div>

          {/* Draggable Active Queue Panel */}
          {showQueue && (
            <div className="player-queue-drawer">
              <div className="queue-drawer-header">
                <div className="queue-title-wrap">
                  <ListMusic size={16} />
                  <span className="queue-title">Playback Priority Queue</span>
                  <span className="queue-hint">
                    Drag tracks up & down to set live playing priority
                  </span>
                </div>
                <button
                  className="queue-close-btn"
                  onClick={() => setShowQueue(false)}
                  title="Close queue"
                >
                  <X size={14} />
                </button>
              </div>

              <div className="queue-draggable-area">
                <DraggableTrackList
                  tracks={activeQueue}
                  onReorder={newTracks => robotMusic.setQueue(newTracks)}
                  onRemove={idx => robotMusic.removeFromQueue(idx)}
                  currentPlayingIndex={playerState.playlistIndex}
                  showPlayButton={true}
                  onPlayTrack={(_, idx) => robotMusic.playFromQueue(idx)}
                  emptyMessage="Playback queue is empty."
                  compact={true}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Song List Subbar (Selection Toolbar / Count) */}
      {songs.length > 0 && (
        <div className="music-library-subbar">
          {selectedSongs.length > 0 ? (
            <div className="trash-toolbar music-selection-toolbar">
              <button onClick={() => setSelectedSongs([])}>Deselect</button>
              <button onClick={() => setSelectedSongs(filtered.map(s => s.filename))}>
                Select all ({filtered.length})
              </button>
              <button
                className="danger"
                onClick={() => setBatchConfirmOpen(true)}
              >
                <Trash2 size={14} /> Delete selected ({selectedSongs.length})
              </button>
            </div>
          ) : (
            <div className="music-library-count-wrap">
              <span className="music-library-count-text">
                {filtered.length} {filtered.length === 1 ? 'song' : 'songs'}
              </span>
              {filtered.length > 0 && (
                <button
                  className="select-mode-toggle"
                  onClick={() => setSelectedSongs([filtered[0].filename])}
                  title="Select multiple songs to delete"
                >
                  <CheckSquare size={13} /> Select
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Song List */}
      {loading && songs.length === 0 ? (
        <div className="music-empty-state">
          <RefreshCw size={28} className="spin-icon" />
          <p>Scanning music library...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="music-empty-state">
          <Music2 size={36} />
          <h3>No songs found</h3>
          <p>
            {songs.length === 0
              ? 'Your music folder is currently empty. Ask Bip in chat to download some songs or use the Downloader tab!'
              : 'No songs match your search query.'}
          </p>
        </div>
      ) : (
        <div className="music-tracks-grid">
          {filtered.map(song => {
            const isPlaying = isCurrentPlaying(song.filename)
            const isSelected = playerState.currentTrack?.filename === song.filename
            const isSongSelected = selectedSongs.includes(song.filename)

            return (
              <div
                key={song.filename}
                className={`music-track-card ${isSelected ? 'active-track' : ''} ${isSongSelected ? 'selected-card' : ''}`}
                onClick={() => {
                  if (selectedSongs.length > 0) {
                    toggleSelect(song.filename)
                  }
                }}
              >
                <button
                  className={`note-check ${isSongSelected ? 'on' : ''} ${selectedSongs.length > 0 ? 'visible' : 'hover-only'}`}
                  title={isSongSelected ? 'Deselect song' : 'Select song'}
                  onClick={e => {
                    e.stopPropagation()
                    toggleSelect(song.filename)
                  }}
                >
                  {isSongSelected ? <Check size={13} /> : null}
                </button>

                <button
                  className={`track-play-badge ${isPlaying ? 'playing' : ''}`}
                  onClick={e => {
                    e.stopPropagation()
                    handlePlayToggle(song)
                  }}
                  title={isPlaying ? 'Pause song' : 'Play song & sing with Bip'}
                >
                  {isPlaying ? (
                    <Pause size={18} />
                  ) : (
                    <Play size={18} fill="currentColor" style={{ marginLeft: 2 }} />
                  )}
                </button>

                <div className="track-details">
                  <div className="track-title-row">
                    <span className="track-title music-song-name-red" title={song.title}>
                      {song.title}
                    </span>
                    {song.artist && <span className="track-artist">{song.artist}</span>}
                  </div>

                  <div className="track-meta-row">
                    <span className="track-meta-item">
                      <HardDrive size={12} /> {formatSize(song.size)}
                    </span>
                    {song.mtime && (
                      <span className="track-meta-item">
                        <Clock size={12} /> {formatDate(song.mtime)}
                      </span>
                    )}
                  </div>
                </div>

                <div className="track-actions">
                  <button
                    className="track-sing-btn"
                    onClick={e => {
                      e.stopPropagation()
                      handlePlayToggle(song)
                    }}
                    title="Sing along with Bip"
                  >
                    <Mic size={14} />
                    <span>Sing</span>
                  </button>

                  <button
                    className="track-add-playlist-btn"
                    onClick={e => {
                      e.stopPropagation()
                      openAddToPlaylist(song)
                    }}
                    title="Add music to playlist or set playback priority"
                  >
                    <ListPlus size={14} />
                    <span>Add</span>
                  </button>

                  <button
                    className="track-del-btn"
                    onClick={e => {
                      e.stopPropagation()
                      setDeletingSong(song.filename)
                    }}
                    title="Delete song from library"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Add To Playlist / Queue Modal */}
      {targetSong && (
        <div className="playlist-modal-overlay" onClick={() => setTargetSong(null)}>
          <div className="playlist-modal-box add-song-modal" onClick={e => e.stopPropagation()}>
            <div className="playlist-modal-header">
              <div className="modal-title-with-icon">
                <ListPlus size={18} />
                <h4>Add Song to Playlist & Priority Queue</h4>
              </div>
              <button className="modal-close-btn" onClick={() => setTargetSong(null)}>
                <X size={16} />
              </button>
            </div>

            <div className="add-song-modal-body">
              {/* Selected Song Preview Banner */}
              <div className="add-target-song-banner">
                <Music2 size={18} className="banner-icon" />
                <div className="banner-meta">
                  <span className="banner-title music-song-name-red">{targetSong.title}</span>
                  {targetSong.artist && <span className="banner-artist">{targetSong.artist}</span>}
                </div>
              </div>

              {addedStatus && (
                <div className="add-feedback-banner">
                  <Check size={15} />
                  <span>{addedStatus}</span>
                </div>
              )}

              {/* Instant Robot Queue Actions */}
              <div className="add-modal-section">
                <label className="section-label">Active Playback Queue</label>
                <div className="queue-quick-actions">
                  <button
                    className="queue-action-btn"
                    onClick={() => handleAddSongToQueue('next')}
                    title="Play this song right after the current song finishes"
                  >
                    <ArrowUpCircle size={15} className="action-icon-blue" />
                    <div className="action-text">
                      <span className="action-heading">Play Next</span>
                      <span className="action-desc">Top priority in current queue</span>
                    </div>
                  </button>
                  <button
                    className="queue-action-btn"
                    onClick={() => handleAddSongToQueue('end')}
                    title="Append song to end of queue"
                  >
                    <ListPlus size={15} className="action-icon-purple" />
                    <div className="action-text">
                      <span className="action-heading">Add to Queue</span>
                      <span className="action-desc">Plays after upcoming tracks</span>
                    </div>
                  </button>
                </div>
              </div>

              {/* Add to Existing Playlists */}
              <div className="add-modal-section">
                <label className="section-label">
                  Add to Existing Playlist ({playlists.length})
                </label>
                {loadingPlaylists ? (
                  <p className="no-songs-hint">Loading playlists...</p>
                ) : playlists.length === 0 ? (
                  <p className="no-songs-hint">No playlists found. Create one below!</p>
                ) : (
                  <div className="existing-playlists-picker">
                    {playlists.map(pl => {
                      const count = (pl.tracks || []).length
                      const isAdding = addingToId === pl.id
                      const alreadyIn = (pl.tracks || []).some(
                        t => t.filename === targetSong.filename
                      )

                      return (
                        <div key={pl.id} className="playlist-picker-item">
                          <div className="item-meta">
                            <span className="item-name">{pl.name}</span>
                            <span className="item-sub">
                              {count} {count === 1 ? 'track' : 'tracks'}
                              {alreadyIn && ' · Already in playlist'}
                            </span>
                          </div>
                          <button
                            className={`playlist-item-add-btn ${alreadyIn ? 'secondary' : 'primary'}`}
                            onClick={() => handleAddSongToPlaylist(pl)}
                            disabled={isAdding}
                          >
                            <Plus size={13} />
                            <span>{isAdding ? 'Adding...' : alreadyIn ? 'Add again' : 'Add'}</span>
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Create New Playlist With Song */}
              <div className="add-modal-section">
                <label className="section-label">Or Create New Playlist</label>
                <form onSubmit={handleCreateAndAdd} className="new-playlist-quick-form">
                  <input
                    type="text"
                    placeholder="Enter new playlist name..."
                    value={newPlaylistName}
                    onChange={e => setNewPlaylistName(e.target.value)}
                    className="new-playlist-input"
                  />
                  <button
                    type="submit"
                    className="music-btn-primary"
                    disabled={!newPlaylistName.trim() || addingToId === 'new'}
                  >
                    <Plus size={14} />
                    <span>Create & Add</span>
                  </button>
                </form>
              </div>
            </div>

            <div className="playlist-modal-actions">
              <button
                type="button"
                className="music-btn-secondary"
                onClick={() => setTargetSong(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Delete Modal */}
      <ConfirmModal
        isOpen={!!deletingSong}
        title="Delete Music File"
        message={`Are you sure you want to permanently delete "${deletingSong}"? This cannot be undone.`}
        confirmText={isDeleting ? 'Deleting...' : 'Delete File'}
        danger
        onConfirm={handleDelete}
        onCancel={() => !isDeleting && setDeletingSong(null)}
      />

      {/* Confirm Batch Delete Modal */}
      <ConfirmModal
        isOpen={batchConfirmOpen}
        title="Delete Multiple Songs"
        message={`Permanently delete ${selectedSongs.length} song${selectedSongs.length === 1 ? '' : 's'} from your library? This action cannot be undone.`}
        confirmText={isBatchDeleting ? 'Deleting...' : `Delete ${selectedSongs.length} Songs`}
        danger
        onConfirm={handleBatchDelete}
        onCancel={() => !isBatchDeleting && setBatchConfirmOpen(false)}
      />
    </div>
  )
}
