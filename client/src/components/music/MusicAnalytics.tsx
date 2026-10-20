import { useState, useEffect } from 'react'
import {
  HardDrive,
  Music,
  Users,
  Clock,
  Sparkles,
  RefreshCw,
  Play,
  TrendingUp,
  Disc
} from 'lucide-react'
import { api } from '../../services/api'
import { robotMusic } from '../../services/robot-music.service'

interface AnalyticsData {
  totalSongs: number
  totalBytes: number
  totalMb: number
  topArtists: Array<{ name: string; count: number }>
  recentSongs: Array<{
    filename: string
    title: string
    artist?: string
    size: number
    mtime: number
    url: string
  }>
}

export function MusicAnalytics() {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchAnalytics = async () => {
    try {
      setLoading(true)
      const res = await api.getMusicAnalytics()
      setData(res)
    } catch (err) {
      console.error('Failed to load music analytics', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAnalytics()
  }, [])

  const formatSize = (bytes: number) => {
    if (bytes >= 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
    }
    if (bytes >= 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    }
    return `${Math.round(bytes / 1024)} KB`
  }

  const formatAvg = () => {
    if (!data || data.totalSongs === 0) return '0 MB'
    const avg = data.totalBytes / data.totalSongs
    return formatSize(avg)
  }

  const estimatedHours = () => {
    if (!data) return '0 hrs'
    // Assume average 3.5 minutes per song
    const totalMins = data.totalSongs * 3.5
    const hrs = Math.floor(totalMins / 60)
    const mins = Math.round(totalMins % 60)
    if (hrs === 0) return `${mins} mins`
    return `${hrs}h ${mins}m`
  }

  if (loading && !data) {
    return (
      <div className="music-empty-state">
        <RefreshCw size={28} className="spin-icon" />
        <p>Calculating library metrics...</p>
      </div>
    )
  }

  return (
    <div className="music-analytics-container">
      {/* Metrics Row */}
      <div className="music-metrics-grid">
        <div className="music-metric-card">
          <div className="metric-icon-wrap icon-purple">
            <Music size={20} />
          </div>
          <div className="metric-content">
            <span className="metric-label">Total Tracks</span>
            <span className="metric-value">{data?.totalSongs || 0}</span>
          </div>
        </div>

        <div className="music-metric-card">
          <div className="metric-icon-wrap icon-blue">
            <HardDrive size={20} />
          </div>
          <div className="metric-content">
            <span className="metric-label">Disk Storage</span>
            <span className="metric-value">{formatSize(data?.totalBytes || 0)}</span>
          </div>
        </div>

        <div className="music-metric-card">
          <div className="metric-icon-wrap icon-teal">
            <TrendingUp size={20} />
          </div>
          <div className="metric-content">
            <span className="metric-label">Avg. Track Size</span>
            <span className="metric-value">{formatAvg()}</span>
          </div>
        </div>

        <div className="music-metric-card">
          <div className="metric-icon-wrap icon-amber">
            <Clock size={20} />
          </div>
          <div className="metric-content">
            <span className="metric-label">Listening Time</span>
            <span className="metric-value">{estimatedHours()}</span>
          </div>
        </div>
      </div>

      {/* Top Artists Distribution */}
      <div className="music-analytics-card">
        <div className="analytics-card-header">
          <div className="analytics-card-title">
            <Users size={17} />
            <h4>Top Artists in Library</h4>
          </div>
          <span className="analytics-card-hint">Calculated from song metadata</span>
        </div>

        {(!data?.topArtists || data.topArtists.length === 0) ? (
          <p className="analytics-empty-hint">No artist tags detected yet.</p>
        ) : (
          <div className="artists-chips-grid">
            {data.topArtists.slice(0, 12).map(artist => (
              <div key={artist.name} className="artist-chip">
                <Disc size={13} className="artist-chip-icon" />
                <span className="artist-name">{artist.name}</span>
                <span className="artist-count-badge">
                  {artist.count} {artist.count === 1 ? 'song' : 'songs'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent Downloads Activity */}
      <div className="music-analytics-card">
        <div className="analytics-card-header">
          <div className="analytics-card-title">
            <Clock size={17} />
            <h4>Recently Downloaded</h4>
          </div>
          <button className="music-btn-secondary" onClick={fetchAnalytics} title="Refresh metrics">
            <RefreshCw size={13} />
            <span>Refresh</span>
          </button>
        </div>

        {(!data?.recentSongs || data.recentSongs.length === 0) ? (
          <p className="analytics-empty-hint">No download activity logged yet.</p>
        ) : (
          <div className="recent-tracks-table">
            {data.recentSongs.map(song => (
              <div key={song.filename} className="recent-track-row">
                <button
                  className="recent-track-play-btn"
                  onClick={() => robotMusic.playTrack(song)}
                  title={`Play ${song.title}`}
                >
                  <Play size={14} fill="currentColor" />
                </button>
                <div className="recent-track-meta">
                  <span className="recent-track-title">{song.title}</span>
                  {song.artist && <span className="recent-track-artist">{song.artist}</span>}
                </div>
                <div className="recent-track-details">
                  <span className="recent-track-size">{formatSize(song.size)}</span>
                  {song.mtime && (
                    <span className="recent-track-date">
                      {new Date(song.mtime).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric'
                      })}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
