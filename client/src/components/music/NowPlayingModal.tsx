import React, { useState } from 'react'
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  Volume2,
  VolumeX,
  X,
  Minimize2,
  Image as ImageIcon,
  Moon,
  Sliders,
  Sparkles,
  Gauge,
  HardDriveDownload
} from 'lucide-react'
import { robotMusic, type MusicPlayerState } from '../../services/robot-music.service'
import { offlineMusic } from '../../services/offline-music.service'

interface NowPlayingModalProps {
  isOpen: boolean
  onClose: () => void
  playerState: MusicPlayerState
  onOpenCoverSearch: (track: any) => void
}

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`
}

export function NowPlayingModal({
  isOpen,
  onClose,
  playerState,
  onOpenCoverSearch
}: NowPlayingModalProps) {
  const [showSleepMenu, setShowSleepMenu] = useState(false)
  const [showCrossfadeMenu, setShowCrossfadeMenu] = useState(false)

  if (!isOpen || !playerState.currentTrack) return null

  const track = playerState.currentTrack
  const coverUrl =
    track.coverUrl || `/api/music/cover/${encodeURIComponent(track.filename)}`

  const speeds = [0.75, 1.0, 1.25, 1.5, 2.0]
  const crossfades = [0, 3, 5, 8, 12]
  const sleepOptions: Array<{ label: string; value: number | 'track' | null }> = [
    { label: 'Off', value: null },
    { label: 'End of Track', value: 'track' },
    { label: '15 Minutes', value: 15 },
    { label: '30 Minutes', value: 30 },
    { label: '45 Minutes', value: 45 },
    { label: '1 Hour', value: 60 }
  ]

  const formatRemainingSleep = (secs: number | null, dur: number | 'track' | null) => {
    if (dur === 'track') return 'End of Track'
    if (secs === null) return 'Off'
    const mins = Math.ceil(secs / 60)
    return `${mins}m left`
  }

  return (
    <div className="now-playing-overlay" onClick={onClose}>
      <div className="now-playing-modal" onClick={e => e.stopPropagation()}>
        {/* Dynamic ambient backdrop glow */}
        <div
          className="now-playing-backdrop"
          style={{ backgroundImage: `url(${coverUrl})` }}
        />

        <div className="now-playing-content">
          {/* Header */}
          <div className="now-playing-header">
            <div className="now-playing-context">
              <span className="context-sub">PLAYING FROM</span>
              <span className="context-name">
                {playerState.playlistName || 'Music Library'}
              </span>
            </div>
            <button
              className="now-playing-close-btn"
              onClick={onClose}
              title="Minimize player"
            >
              <Minimize2 size={18} />
            </button>
          </div>

          {/* Album Artwork & Visualizer */}
          <div className="now-playing-art-container">
            <div className="now-playing-art-wrap">
              <img
                src={coverUrl}
                alt={track.title}
                className="now-playing-art"
                onError={e => {
                  ;(e.currentTarget as HTMLElement).style.opacity = '0.5'
                }}
              />
              <button
                className="now-playing-change-cover-badge"
                onClick={() => onOpenCoverSearch(track)}
                title="Search and change album cover on iTunes"
              >
                <ImageIcon size={14} />
                <span>Change Cover</span>
              </button>
            </div>

            {/* Audio Waveform / Visualizer Bars */}
            <div className={`now-playing-visualizer ${playerState.isPlaying ? 'active' : ''}`}>
              {Array.from({ length: 16 }).map((_, i) => (
                <div
                  key={i}
                  className="visualizer-bar"
                  style={{
                    animationDelay: `${(i * 0.1).toFixed(2)}s`,
                    animationDuration: `${0.6 + (i % 5) * 0.15}s`
                  }}
                />
              ))}
            </div>
          </div>

          {/* Track Meta */}
          <div className="now-playing-meta">
            <h2 className="now-playing-title" title={track.title}>
              {track.title}
            </h2>
            <div className="now-playing-artist-row">
              <p className="now-playing-artist">
                {track.artist || 'Bip Singing Companion'}
              </p>
              {(playerState.isCurrentOffline || offlineMusic.isTrackOffline(track.filename)) && (
                <span
                  className="now-playing-offline-tag"
                  title="Playing directly from this PC (Offline ready)"
                >
                  <HardDriveDownload size={12} /> Stored on this PC
                </span>
              )}
            </div>
          </div>

          {/* Timeline & Scrubber */}
          <div className="now-playing-timeline">
            <input
              type="range"
              min={0}
              max={playerState.duration || 100}
              value={playerState.currentTime || 0}
              onChange={e => robotMusic.seek(parseFloat(e.target.value))}
              className="now-playing-slider"
            />
            <div className="timeline-labels">
              <span>{formatTime(playerState.currentTime)}</span>
              <span>
                {playerState.duration > 0
                  ? `-${formatTime(playerState.duration - playerState.currentTime)}`
                  : '0:00'}
              </span>
            </div>
          </div>

          {/* Primary Playback Controls */}
          <div className="now-playing-controls">
            <button
              type="button"
              className={`np-ctrl-btn ${playerState.shuffle ? 'active' : ''}`}
              onClick={() => robotMusic.toggleShuffle()}
              title={`Shuffle: ${playerState.shuffle ? 'On' : 'Off'}`}
            >
              <Shuffle size={20} />
            </button>

            <button
              type="button"
              className="np-ctrl-btn step"
              onClick={() => robotMusic.prevTrack()}
              title="Previous song"
            >
              <SkipBack size={26} />
            </button>

            <button
              type="button"
              className="np-play-btn"
              onClick={() => robotMusic.togglePlay()}
              title={playerState.isPlaying ? 'Pause' : 'Play'}
            >
              {playerState.isPlaying ? (
                <Pause size={30} />
              ) : (
                <Play size={30} fill="currentColor" style={{ marginLeft: 3 }} />
              )}
            </button>

            <button
              type="button"
              className="np-ctrl-btn step"
              onClick={() => robotMusic.nextTrack()}
              title="Next song"
            >
              <SkipForward size={26} />
            </button>

            <button
              type="button"
              className={`np-ctrl-btn ${playerState.repeatMode !== 'off' ? 'active' : ''}`}
              onClick={() => robotMusic.toggleRepeatMode()}
              title={`Repeat: ${playerState.repeatMode}`}
            >
              {playerState.repeatMode === 'one' ? (
                <Repeat1 size={20} />
              ) : (
                <Repeat size={20} />
              )}
              {playerState.repeatMode !== 'off' && <span className="np-active-dot" />}
            </button>
          </div>

          {/* Secondary Features: Speed, Sleep Timer, Crossfade, Volume */}
          <div className="now-playing-extra-toolbar">
            {/* Speed Selector */}
            <div className="extra-tool-item">
              <span className="tool-label">Speed</span>
              <div className="speed-pills-row">
                {speeds.map(s => (
                  <button
                    key={s}
                    className={`speed-pill ${playerState.playbackRate === s ? 'active' : ''}`}
                    onClick={() => robotMusic.setPlaybackRate(s)}
                  >
                    {s}x
                  </button>
                ))}
              </div>
            </div>

            {/* Sleep Timer */}
            <div className="extra-tool-item relative">
              <span className="tool-label">Sleep Timer</span>
              <button
                className={`tool-action-btn ${playerState.sleepTimerDuration ? 'active' : ''}`}
                onClick={() => setShowSleepMenu(!showSleepMenu)}
              >
                <Moon size={14} />
                <span>
                  {formatRemainingSleep(
                    playerState.sleepTimerRemaining,
                    playerState.sleepTimerDuration
                  )}
                </span>
              </button>

              {showSleepMenu && (
                <div className="tool-dropdown-menu">
                  <div className="dropdown-title">Stop playback after:</div>
                  {sleepOptions.map(opt => (
                    <button
                      key={opt.label}
                      className={`dropdown-opt-btn ${
                        playerState.sleepTimerDuration === opt.value ? 'selected' : ''
                      }`}
                      onClick={() => {
                        robotMusic.setSleepTimer(opt.value)
                        setShowSleepMenu(false)
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Crossfade */}
            <div className="extra-tool-item relative">
              <span className="tool-label">Crossfade</span>
              <button
                className={`tool-action-btn ${playerState.crossfadeSeconds > 0 ? 'active' : ''}`}
                onClick={() => setShowCrossfadeMenu(!showCrossfadeMenu)}
              >
                <Sliders size={14} />
                <span>
                  {playerState.crossfadeSeconds > 0
                    ? `${playerState.crossfadeSeconds}s`
                    : 'Off'}
                </span>
              </button>

              {showCrossfadeMenu && (
                <div className="tool-dropdown-menu">
                  <div className="dropdown-title">Transition fade length:</div>
                  {crossfades.map(sec => (
                    <button
                      key={sec}
                      className={`dropdown-opt-btn ${
                        playerState.crossfadeSeconds === sec ? 'selected' : ''
                      }`}
                      onClick={() => {
                        robotMusic.setCrossfade(sec)
                        setShowCrossfadeMenu(false)
                      }}
                    >
                      {sec === 0 ? 'Off (Gapless)' : `${sec} seconds`}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Volume */}
            <div className="extra-tool-item volume-group">
              <button
                className="np-vol-icon"
                onClick={() => robotMusic.setVolume(playerState.volume > 0 ? 0 : 0.8)}
              >
                {playerState.volume > 0 ? <Volume2 size={16} /> : <VolumeX size={16} />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={playerState.volume}
                onChange={e => robotMusic.setVolume(parseFloat(e.target.value))}
                className="now-playing-vol-slider"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
