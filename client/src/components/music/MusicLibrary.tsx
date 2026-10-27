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
  PlayCircle,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  Maximize2,
  Moon,
  Image as ImageIcon,
  Sliders,
  LayoutGrid,
  List,
  Download,
  DownloadCloud,
  HardDriveDownload,
  WifiOff,
  FileDown,
  CheckCircle2,
  MoreVertical
} from 'lucide-react'
import { api } from '../../services/api'
import { robotMusic, type MusicPlayerState } from '../../services/robot-music.service'
import { offlineMusic, type BatchOfflineStatus } from '../../services/offline-music.service'
import { ConfirmModal } from '../ConfirmModal'
import { DraggableTrackList, type TrackItem } from './DraggableTrackList'
import { CoverArtModal } from './CoverArtModal'
import { NowPlayingModal } from './NowPlayingModal'

interface MusicTrackItem {
  filename: string
  title: string
  artist?: string
  size: number
  mtime: number
  url: string
  coverUrl?: string
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

  // View mode: Grid cards vs List table
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => {
    return (localStorage.getItem('muse_music_view_mode') as 'grid' | 'list') || 'grid'
  })

  const handleViewModeChange = (mode: 'grid' | 'list') => {
    setViewMode(mode)
    localStorage.setItem('muse_music_view_mode', mode)
  }

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

  // Cover Art Search & Now Playing Modals
  const [coverModalSong, setCoverModalSong] = useState<MusicTrackItem | null>(null)
  const [showNowPlaying, setShowNowPlaying] = useState(false)
  const [showPlayerSleepMenu, setShowPlayerSleepMenu] = useState(false)

  // Offline music state (read directly from this machine)
  const [offlineFilenames, setOfflineFilenames] = useState<Set<string>>(() => offlineMusic.getOfflineFilenames())
  const [batchStatus, setBatchStatus] = useState<BatchOfflineStatus>(() => offlineMusic.getBatchStatus())
  const [filterOfflineOnly, setFilterOfflineOnly] = useState(false)
  const [offlineStats, setOfflineStats] = useState<{ count: number; totalBytes: number }>({ count: 0, totalBytes: 0 })
  const [downloadingSong, setDownloadingSong] = useState<string | null>(null)
  const [isOfflineFallback, setIsOfflineFallback] = useState(false)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [openMenuSong, setOpenMenuSong] = useState<string | null>(null)

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('.track-menu-wrap')) {
        setOpenMenuSong(null)
      }
    }
    window.addEventListener('click', handleOutsideClick)
    return () => window.removeEventListener('click', handleOutsideClick)
  }, [])

  const showToast = (msg: string) => {
    setToastMessage(msg)
    setTimeout(() => setToastMessage(null), 3000)
  }

  const refreshOfflineStats = async () => {
    const stats = await offlineMusic.getOfflineStorageStats()
    setOfflineStats(stats)
  }

  const handleCoverSelected = (filename: string, newCoverUrl: string) => {
    setSongs(prev =>
      prev.map(s => (s.filename === filename ? { ...s, coverUrl: newCoverUrl } : s))
    )
  }

  const fetchSongs = async () => {
    try {
      setLoading(true)
      const res = await api.listMusicSongs()
      const list = res.songs || []
      setSongs(list)
      setIsOfflineFallback(false)
      if (list.length > 0) {
        void offlineMusic.saveSongsListCache(list)
      }
    } catch (err) {
      console.warn('[MusicLibrary] Network load failed, loading offline storage:', err)
      const cached = await offlineMusic.loadSongsListCache()
      if (cached && cached.length > 0) {
        setSongs(cached)
        setIsOfflineFallback(true)
      } else {
        const localTracks = await offlineMusic.getAllOfflineTracks()
        if (localTracks.length > 0) {
          setSongs(
            localTracks.map(t => ({
              filename: t.filename,
              title: t.title,
              artist: t.artist,
              size: t.size,
              mtime: t.cachedAt,
              url: `/api/music/stream/${encodeURIComponent(t.filename)}`
            }))
          )
          setIsOfflineFallback(true)
        }
      }
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
    const unsubscribeMusic = robotMusic.subscribe(state => setPlayerState(state))
    const unsubscribeOffline = offlineMusic.subscribe(filenames => {
      setOfflineFilenames(filenames)
      void refreshOfflineStats()
    })
    const unsubscribeBatch = offlineMusic.subscribeBatch(status => setBatchStatus(status))
    void refreshOfflineStats()

    return () => {
      unsubscribeMusic()
      unsubscribeOffline()
      unsubscribeBatch()
    }
  }, [])

  const handleToggleOffline = async (song: MusicTrackItem) => {
    const filename = song.filename
    if (offlineFilenames.has(filename)) {
      await offlineMusic.deleteOfflineTrack(filename)
      showToast(`Removed "${song.title}" from this PC's offline cache`)
    } else {
      setDownloadingSong(filename)
      const res = await offlineMusic.downloadTrackOffline(song)
      setDownloadingSong(null)
      if (res.alreadyDownloaded) {
        showToast(`"${song.title}" is already downloaded on this PC!`)
      } else if (res.success) {
        showToast(`"${song.title}" saved to this PC for offline listening!`)
      } else {
        showToast(`Failed to download "${song.title}" to this PC: ${res.error || 'Network error'}`)
      }
    }
  }

  const handleDownloadAllToPC = async () => {
    if (songs.length === 0) return
    const unCached = songs.filter(s => !offlineFilenames.has(s.filename))
    if (unCached.length === 0) {
      showToast('All songs in your library are already downloaded on this PC!')
      return
    }
    showToast(`Downloading ${unCached.length} songs to this PC for offline playback…`)
    const res = await offlineMusic.downloadAllOffline(songs)
    showToast(`Downloaded ${res.downloaded} songs (${res.skipped} already cached on this PC)!`)
  }

  const handleExportTrack = async (song: MusicTrackItem) => {
    try {
      showToast(`Exporting "${song.title}" to your computer's Downloads...`)
      await offlineMusic.exportTrackToComputer(song)
    } catch {
      showToast('Could not export song file.')
    }
  }

  // Keyboard controls for switching tracks back and forth
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return
      }

      if (e.key === ' ' && playerState.currentTrack) {
        e.preventDefault()
        robotMusic.togglePlay()
      } else if ((e.shiftKey || e.altKey) && e.key === 'ArrowRight') {
        e.preventDefault()
        void robotMusic.nextTrack()
      } else if ((e.shiftKey || e.altKey) && e.key === 'ArrowLeft') {
        e.preventDefault()
        void robotMusic.prevTrack()
      } else if (e.key === ']' && playerState.currentTrack) {
        e.preventDefault()
        void robotMusic.nextTrack()
      } else if (e.key === '[' && playerState.currentTrack) {
        e.preventDefault()
        void robotMusic.prevTrack()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [playerState.currentTrack])

  const handlePlayToggle = (song: MusicTrackItem) => {
    if (playerState.currentTrack?.filename === song.filename) {
      robotMusic.togglePlay()
    } else {
      robotMusic.playTrack(song, songs)
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

  const filtered = songs
    .filter(s => `${s.title} ${s.artist || ''} ${s.filename}`.toLowerCase().includes(search.toLowerCase()))
    .filter(s => (!filterOfflineOnly ? true : offlineFilenames.has(s.filename)))

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

        <div className="music-toolbar-actions">
          {/* Download All to PC */}
          <button
            className={`music-btn-secondary ${batchStatus.active ? 'active-pulse' : ''}`}
            onClick={handleDownloadAllToPC}
            disabled={batchStatus.active || songs.length === 0}
            title="Download all songs to this computer for offline playback"
          >
            <DownloadCloud size={15} />
            <span>
              {batchStatus.active
                ? `Downloading ${batchStatus.current}/${batchStatus.total}...`
                : songs.length > 0 && songs.every(s => offlineFilenames.has(s.filename))
                ? 'All on this PC'
                : `Download All to PC (${songs.filter(s => !offlineFilenames.has(s.filename)).length})`}
            </span>
          </button>

          {/* Filter Offline Only */}
          <button
            className={`music-btn-secondary ${filterOfflineOnly ? 'active-offline' : ''}`}
            onClick={() => setFilterOfflineOnly(!filterOfflineOnly)}
            title={
              filterOfflineOnly
                ? 'Showing only songs saved on this PC (Click to show all)'
                : 'Show only songs saved on this PC'
            }
          >
            <HardDrive size={15} />
            <span>Saved on PC ({offlineStats.count})</span>
          </button>

          <button className="music-btn-secondary" onClick={fetchSongs} title="Refresh song list">
            <RefreshCw size={15} className={loading ? 'spin-icon' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {isOfflineFallback && (
        <div className="music-offline-banner">
          <WifiOff size={16} />
          <span>
            <strong>Offline Mode:</strong> Connected server is unreachable. Reading songs stored locally on this machine!
          </span>
        </div>
      )}

      {toastMessage && (
        <div className="music-toast-notification">
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Floating Active Player if a track is active */}
      {playerState.currentTrack && (
        <div className="music-player-wrapper">
          <div className="music-active-player-banner">
            <div
              className="player-track-info"
              onClick={() => setShowNowPlaying(true)}
              style={{ cursor: 'pointer' }}
              title="Click to open Expanded Now Playing view"
            >
              <div className="player-track-icon cover-interactive">
                <img
                  src={
                    playerState.currentTrack.coverUrl ||
                    `/api/music/cover/${encodeURIComponent(playerState.currentTrack.filename)}`
                  }
                  alt={playerState.currentTrack.title}
                  className="player-thumb-img"
                  onError={e => {
                    ;(e.currentTarget as HTMLElement).style.display = 'none'
                  }}
                />
                <Music2 size={18} className={playerState.isPlaying ? 'pulsing-note' : ''} />
              </div>
              <div className="player-track-meta">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="player-title">{playerState.currentTrack.title}</span>
                  {(playerState.isCurrentOffline || offlineFilenames.has(playerState.currentTrack.filename)) && (
                    <span
                      className="player-offline-badge"
                      title="Playing directly from this machine's storage without internet"
                    >
                      <HardDriveDownload size={11} /> Saved on PC
                    </span>
                  )}
                </div>
                <span className="player-bip-tag">
                  <Mic size={12} /> Bip Singing Companion
                  {playerState.playlistName && ` · ${playerState.playlistName}`}
                </span>
              </div>
            </div>

            <div className="player-controls">
              <div className="player-buttons-group">
                <button
                  type="button"
                  className={`player-step-btn ${playerState.shuffle ? 'active-tint' : ''}`}
                  onClick={() => robotMusic.toggleShuffle()}
                  title={`Shuffle: ${playerState.shuffle ? 'On' : 'Off'}`}
                >
                  <Shuffle size={15} />
                </button>
                <button
                  type="button"
                  className="player-step-btn"
                  onClick={() => robotMusic.prevTrack()}
                  title="Previous song (Go back) [Shift + Left or []"
                  disabled={!playerState.currentTrack}
                >
                  <SkipBack size={17} />
                </button>
                <button
                  type="button"
                  className="player-play-btn"
                  onClick={() => robotMusic.togglePlay()}
                  title={playerState.isPlaying ? 'Pause song (Space)' : 'Play song (Space)'}
                >
                  {playerState.isPlaying ? (
                    <Pause size={18} />
                  ) : (
                    <Play size={18} fill="currentColor" />
                  )}
                </button>
                <button
                  type="button"
                  className="player-step-btn"
                  onClick={() => robotMusic.nextTrack()}
                  title="Next song (Go forward) [Shift + Right or ]]"
                  disabled={!playerState.currentTrack}
                >
                  <SkipForward size={17} />
                </button>
                <button
                  type="button"
                  className={`player-step-btn ${playerState.repeatMode !== 'off' ? 'active-tint' : ''}`}
                  onClick={() => robotMusic.toggleRepeatMode()}
                  title={`Repeat Mode: ${playerState.repeatMode} (Click to toggle)`}
                >
                  {playerState.repeatMode === 'one' ? <Repeat1 size={15} /> : <Repeat size={15} />}
                </button>
              </div>
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

            <div className="player-extras-group">
              {/* Playback speed cycle */}
              <button
                type="button"
                className="player-speed-badge"
                onClick={() => {
                  const speeds = [1, 1.25, 1.5, 2, 0.75]
                  const next = speeds[(speeds.indexOf(playerState.playbackRate) + 1) % speeds.length]
                  robotMusic.setPlaybackRate(next)
                }}
                title="Playback speed (click to cycle)"
              >
                {playerState.playbackRate}x
              </button>

              {/* Sleep Timer */}
              <div className="player-sleep-wrapper" style={{ position: 'relative' }}>
                <button
                  type="button"
                  className={`player-step-btn ${playerState.sleepTimerDuration ? 'active-tint' : ''}`}
                  onClick={() => setShowPlayerSleepMenu(!showPlayerSleepMenu)}
                  title="Sleep Timer"
                >
                  <Moon size={15} />
                  {playerState.sleepTimerRemaining !== null && (
                    <span className="player-badge-text">
                      {Math.ceil(playerState.sleepTimerRemaining / 60)}m
                    </span>
                  )}
                  {playerState.sleepTimerDuration === 'track' && (
                    <span className="player-badge-text">1trk</span>
                  )}
                </button>

                {showPlayerSleepMenu && (
                  <div className="player-quick-sleep-popup">
                    <div className="sleep-popup-title">Stop playback after:</div>
                    <button
                      onClick={() => {
                        robotMusic.setSleepTimer(null)
                        setShowPlayerSleepMenu(false)
                      }}
                    >
                      Off
                    </button>
                    <button
                      onClick={() => {
                        robotMusic.setSleepTimer('track')
                        setShowPlayerSleepMenu(false)
                      }}
                    >
                      End of Track
                    </button>
                    <button
                      onClick={() => {
                        robotMusic.setSleepTimer(15)
                        setShowPlayerSleepMenu(false)
                      }}
                    >
                      15 min
                    </button>
                    <button
                      onClick={() => {
                        robotMusic.setSleepTimer(30)
                        setShowPlayerSleepMenu(false)
                      }}
                    >
                      30 min
                    </button>
                    <button
                      onClick={() => {
                        robotMusic.setSleepTimer(60)
                        setShowPlayerSleepMenu(false)
                      }}
                    >
                      1 hour
                    </button>
                  </div>
                )}
              </div>

              {/* Search Cover Art on iTunes */}
              <button
                type="button"
                className="player-step-btn"
                onClick={() => setCoverModalSong(playerState.currentTrack as any)}
                title="Search iTunes Cover Art"
              >
                <ImageIcon size={15} />
              </button>

              {/* Quick Offline Save/Remove in Player */}
              <button
                type="button"
                className={`player-step-btn ${offlineFilenames.has(playerState.currentTrack.filename) ? 'active-tint' : ''}`}
                onClick={() => handleToggleOffline(playerState.currentTrack as any)}
                title={
                  offlineFilenames.has(playerState.currentTrack.filename)
                    ? 'Saved on this PC (Click to remove)'
                    : 'Download to this PC for offline listening'
                }
              >
                {offlineFilenames.has(playerState.currentTrack.filename) ? (
                  <HardDriveDownload size={15} style={{ color: '#10b981' }} />
                ) : (
                  <Download size={15} />
                )}
              </button>

              {/* Volume Slider */}
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

              {/* Expand Fullscreen / Now Playing */}
              <button
                type="button"
                className="player-expand-btn"
                onClick={() => setShowNowPlaying(true)}
                title="Expand Now Playing view"
              >
                <Maximize2 size={16} />
              </button>
            </div>
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

      {/* Song List Subbar (Selection Toolbar / Count / View Toggle) */}
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

          <div className="music-view-toggle-wrap">
            <button
              type="button"
              className={`music-view-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => handleViewModeChange('grid')}
              title="Grid View"
            >
              <LayoutGrid size={15} />
              <span>Grid</span>
            </button>
            <button
              type="button"
              className={`music-view-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => handleViewModeChange('list')}
              title="List View"
            >
              <List size={15} />
              <span>List</span>
            </button>
          </div>
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
      ) : viewMode === 'list' ? (
        /* List Mode View (Spotify / Apple Music Table style) */
        <div className="music-tracks-list">
          <div className="music-tracks-list-header">
            <div className="list-col col-check">#</div>
            <div className="list-col col-main">Track</div>
            <div className="list-col col-size">Size</div>
            <div className="list-col col-date">Date Added</div>
            <div className="list-col col-actions">Actions</div>
          </div>
          <div className="music-tracks-list-body">
            {filtered.map((song, index) => {
              const isPlaying = isCurrentPlaying(song.filename)
              const isSelected = playerState.currentTrack?.filename === song.filename
              const isSongSelected = selectedSongs.includes(song.filename)

              return (
                <div
                  key={song.filename}
                  className={`music-track-row ${isSelected ? 'active-track' : ''} ${isSongSelected ? 'selected-row' : ''} ${openMenuSong === song.filename ? 'menu-open' : ''}`}
                  onClick={() => {
                    if (selectedSongs.length > 0) {
                      toggleSelect(song.filename)
                    }
                  }}
                  onDoubleClick={() => handlePlayToggle(song)}
                >
                  <div className="list-col col-check">
                    <button
                      className={`note-check ${isSongSelected ? 'on' : ''} ${selectedSongs.length > 0 ? 'visible' : 'hover-only'}`}
                      title={isSongSelected ? 'Deselect song' : 'Select song'}
                      onClick={e => {
                        e.stopPropagation()
                        toggleSelect(song.filename)
                      }}
                    >
                      {isSongSelected ? <Check size={12} /> : null}
                    </button>
                    <span className="row-index-num">{index + 1}</span>
                  </div>

                  <div className="list-col col-main">
                    <button
                      className={`track-play-badge compact ${isPlaying ? 'playing' : ''}`}
                      onClick={e => {
                        e.stopPropagation()
                        handlePlayToggle(song)
                      }}
                      title={isPlaying ? 'Pause song' : 'Play song & sing with Bip'}
                    >
                      {isPlaying ? (
                        <Pause size={14} />
                      ) : (
                        <Play size={14} fill="currentColor" style={{ marginLeft: 1 }} />
                      )}
                    </button>

                    <div
                      className="track-cover-badge compact"
                      onClick={e => {
                        e.stopPropagation()
                        setCoverModalSong(song)
                      }}
                      title="Search & change album cover on iTunes"
                    >
                      <img
                        src={song.coverUrl || `/api/music/cover/${encodeURIComponent(song.filename)}`}
                        alt={song.title}
                        className="track-cover-img"
                        onError={e => {
                          ;(e.currentTarget as HTMLElement).style.display = 'none'
                        }}
                      />
                      <div className="track-cover-overlay-hint">
                        <ImageIcon size={10} />
                      </div>
                    </div>

                    <div className="track-details">
                      <div className="track-title-header">
                        <span className="track-title" title={song.title}>
                          {song.title}
                        </span>
                        {offlineFilenames.has(song.filename) && (
                          <span
                            className="track-offline-pill"
                            title="Stored on this PC — 100% offline ready"
                          >
                            <HardDriveDownload size={11} /> On PC
                          </span>
                        )}
                      </div>
                      {song.artist && <span className="track-artist">{song.artist}</span>}
                    </div>
                  </div>

                  <div className="list-col col-size">
                    <span className="track-meta-item">
                      <HardDrive size={12} /> {formatSize(song.size)}
                    </span>
                  </div>

                  <div className="list-col col-date">
                    {song.mtime ? (
                      <span className="track-meta-item">
                        <Clock size={12} /> {formatDate(song.mtime)}
                      </span>
                    ) : (
                      <span className="track-meta-item">-</span>
                    )}
                  </div>

                  <div className="list-col col-actions">
                    <div className="track-actions">
                      {/* Offline Download/Remove Button */}
                      <button
                        className={`track-action-btn ${offlineFilenames.has(song.filename) ? 'offline-active-btn' : ''}`}
                        onClick={e => {
                          e.stopPropagation()
                          handleToggleOffline(song)
                        }}
                        disabled={
                          downloadingSong === song.filename ||
                          (batchStatus.active && batchStatus.currentTitle === song.title)
                        }
                        title={
                          downloadingSong === song.filename
                            ? 'Downloading to this PC...'
                            : offlineFilenames.has(song.filename)
                            ? 'Saved on this PC (Click to remove)'
                            : 'Download to this PC for offline listening'
                        }
                      >
                        {downloadingSong === song.filename ? (
                          <RefreshCw size={14} className="spin-icon text-amber-400" />
                        ) : offlineFilenames.has(song.filename) ? (
                          <HardDriveDownload size={14} />
                        ) : (
                          <Download size={14} />
                        )}
                      </button>

                      <button
                        className={`track-action-btn sing-btn ${isPlaying ? 'playing' : ''}`}
                        onClick={e => {
                          e.stopPropagation()
                          handlePlayToggle(song)
                        }}
                        title={isPlaying ? 'Pause singing companion' : 'Sing along with Bip'}
                      >
                        <Mic size={14} />
                      </button>

                      <button
                        className="track-action-btn"
                        onClick={e => {
                          e.stopPropagation()
                          openAddToPlaylist(song)
                        }}
                        title="Add song to playlist or priority queue"
                      >
                        <ListPlus size={14} />
                      </button>

                      {/* More Menu */}
                      <div className="track-menu-wrap" onClick={e => e.stopPropagation()}>
                        <button
                          className={`track-action-btn ${openMenuSong === song.filename ? 'active' : ''}`}
                          onClick={e => {
                            e.stopPropagation()
                            setOpenMenuSong(openMenuSong === song.filename ? null : song.filename)
                          }}
                          title="More song actions"
                        >
                          <MoreVertical size={14} />
                        </button>

                        {openMenuSong === song.filename && (
                          <div className="track-menu-dropdown">
                            <button
                              onClick={() => {
                                setOpenMenuSong(null)
                                handleExportTrack(song)
                              }}
                            >
                              <FileDown size={14} />
                              <span>Save MP3 to Computer</span>
                            </button>

                            <button
                              onClick={() => {
                                setOpenMenuSong(null)
                                setCoverModalSong(song)
                              }}
                            >
                              <ImageIcon size={14} />
                              <span>Change Album Cover</span>
                            </button>

                            <button
                              className="danger"
                              onClick={() => {
                                setOpenMenuSong(null)
                                setDeletingSong(song.filename)
                              }}
                            >
                              <Trash2 size={14} />
                              <span>Delete Song</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        /* Grid Mode View */
        <div className="music-tracks-grid">
          {filtered.map(song => {
            const isPlaying = isCurrentPlaying(song.filename)
            const isSelected = playerState.currentTrack?.filename === song.filename
            const isSongSelected = selectedSongs.includes(song.filename)

            return (
              <div
                key={song.filename}
                className={`music-track-card ${isSelected ? 'active-track' : ''} ${isSongSelected ? 'selected-card' : ''} ${openMenuSong === song.filename ? 'menu-open' : ''}`}
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

                <div
                  className="track-cover-badge"
                  onClick={e => {
                    e.stopPropagation()
                    setCoverModalSong(song)
                  }}
                  title="Search & change album cover on iTunes"
                >
                  <img
                    src={song.coverUrl || `/api/music/cover/${encodeURIComponent(song.filename)}`}
                    alt={song.title}
                    className="track-cover-img"
                    onError={e => {
                      ;(e.currentTarget as HTMLElement).style.display = 'none'
                    }}
                  />
                  <div className="track-cover-overlay-hint">
                    <ImageIcon size={11} />
                  </div>
                </div>

                <button
                  className={`track-play-badge ${isPlaying ? 'playing' : ''}`}
                  onClick={e => {
                    e.stopPropagation()
                    handlePlayToggle(song)
                  }}
                  title={isPlaying ? 'Pause song' : 'Play song & sing with Bip'}
                >
                  {isPlaying ? (
                    <Pause size={17} />
                  ) : (
                    <Play size={17} fill="currentColor" style={{ marginLeft: 2 }} />
                  )}
                </button>

                <div className="track-details">
                  <div className="track-title-header">
                    <span className="track-title" title={song.title}>
                      {song.title}
                    </span>
                    {offlineFilenames.has(song.filename) && (
                      <span
                        className="track-offline-pill"
                        title="Stored on this PC — 100% offline ready"
                      >
                        <HardDriveDownload size={11} /> On PC
                      </span>
                    )}
                  </div>
                  {song.artist && <span className="track-artist">{song.artist}</span>}

                  <div className="track-meta-row">
                    <span className="track-meta-item">
                      <HardDrive size={11} /> {formatSize(song.size)}
                    </span>
                    {song.mtime ? (
                      <span className="track-meta-item">
                        <Clock size={11} /> {formatDate(song.mtime)}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="track-actions">
                  {/* Offline Download/Remove Button */}
                  <button
                    className={`track-action-btn ${offlineFilenames.has(song.filename) ? 'offline-active-btn' : ''}`}
                    onClick={e => {
                      e.stopPropagation()
                      handleToggleOffline(song)
                    }}
                    disabled={
                      downloadingSong === song.filename ||
                      (batchStatus.active && batchStatus.currentTitle === song.title)
                    }
                    title={
                      downloadingSong === song.filename
                        ? 'Downloading to this PC...'
                        : offlineFilenames.has(song.filename)
                        ? 'Saved on this PC (Click to remove)'
                        : 'Download to this PC for offline listening'
                    }
                  >
                    {downloadingSong === song.filename ? (
                      <RefreshCw size={14} className="spin-icon text-amber-400" />
                    ) : offlineFilenames.has(song.filename) ? (
                      <HardDriveDownload size={14} />
                    ) : (
                      <Download size={14} />
                    )}
                  </button>

                  {/* Sing with Bip */}
                  <button
                    className={`track-action-btn sing-btn ${isPlaying ? 'playing' : ''}`}
                    onClick={e => {
                      e.stopPropagation()
                      handlePlayToggle(song)
                    }}
                    title={isPlaying ? 'Pause singing companion' : 'Sing along with Bip'}
                  >
                    <Mic size={14} />
                  </button>

                  {/* More Options Dropdown */}
                  <div className="track-menu-wrap" onClick={e => e.stopPropagation()}>
                    <button
                      className={`track-action-btn ${openMenuSong === song.filename ? 'active' : ''}`}
                      onClick={e => {
                        e.stopPropagation()
                        setOpenMenuSong(openMenuSong === song.filename ? null : song.filename)
                      }}
                      title="More song actions"
                    >
                      <MoreVertical size={14} />
                    </button>

                    {openMenuSong === song.filename && (
                      <div className="track-menu-dropdown">
                        <button
                          onClick={() => {
                            setOpenMenuSong(null)
                            openAddToPlaylist(song)
                          }}
                        >
                          <ListPlus size={14} />
                          <span>Add to Playlist / Queue</span>
                        </button>

                        <button
                          onClick={() => {
                            setOpenMenuSong(null)
                            handleExportTrack(song)
                          }}
                        >
                          <FileDown size={14} />
                          <span>Save MP3 to Computer</span>
                        </button>

                        <button
                          onClick={() => {
                            setOpenMenuSong(null)
                            setCoverModalSong(song)
                          }}
                        >
                          <ImageIcon size={14} />
                          <span>Change Album Cover</span>
                        </button>

                        <button
                          className="danger"
                          onClick={() => {
                            setOpenMenuSong(null)
                            setDeletingSong(song.filename)
                          }}
                        >
                          <Trash2 size={14} />
                          <span>Delete Song</span>
                        </button>
                      </div>
                    )}
                  </div>
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
                  <span className="banner-title">{targetSong.title}</span>
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

      {/* Fullscreen / Expanded Now Playing View */}
      <NowPlayingModal
        isOpen={showNowPlaying}
        onClose={() => setShowNowPlaying(false)}
        playerState={playerState}
        onOpenCoverSearch={track => setCoverModalSong(track as any)}
      />

      {/* Cover Art Search & Selection Modal (iTunes Catalog) */}
      <CoverArtModal
        isOpen={!!coverModalSong}
        song={coverModalSong}
        onClose={() => setCoverModalSong(null)}
        onCoverSelected={handleCoverSelected}
      />
    </div>
  )
}
