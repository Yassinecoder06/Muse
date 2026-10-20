import { useState, useEffect } from 'react'
import {
  Download,
  CheckCircle2,
  AlertCircle,
  Clock,
  Sparkles,
  RefreshCw,
  Trash2,
  Music,
  ArrowRight,
  ListMusic
} from 'lucide-react'
import { api } from '../../services/api'

interface TaskProgressItem {
  task_id: string
  query: string
  title?: string
  artist?: string
  filename?: string
  status: 'queued' | 'searching' | 'downloading' | 'converting' | 'completed' | 'failed' | 'cancelled'
  progress_percent: number
  speed_str?: string
  eta_str?: string
  downloaded_bytes?: number
  total_bytes?: number
  error?: string
  created_at: number
  updated_at: number
}

export function MusicTasks({ onTaskCompleted }: { onTaskCompleted?: () => void }) {
  const [tasks, setTasks] = useState<TaskProgressItem[]>([])
  const [loading, setLoading] = useState(false)
  const [inputLines, setInputLines] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const fetchTasks = async () => {
    try {
      const res = await api.getMusicTasks()
      const taskList = res.tasks || []
      setTasks(taskList)

      // Notify parent if any tasks recently completed
      if (taskList.some((t: TaskProgressItem) => t.status === 'completed')) {
        onTaskCompleted?.()
      }
    } catch (err) {
      console.error('Failed to fetch music tasks', err)
    }
  }

  useEffect(() => {
    fetchTasks()
    // Poll every 1.5 seconds if there are active tasks (queued, searching, downloading, converting)
    const interval = setInterval(() => {
      fetchTasks()
    }, 1500)
    return () => clearInterval(interval)
  }, [])

  const handleStartBatch = async () => {
    const raw = inputLines.trim()
    if (!raw) return

    // Split by newlines or commas
    const lines = raw
      .split(/[\n,]+/)
      .map(s => s.trim())
      .filter(Boolean)

    if (lines.length === 0) return

    try {
      setSubmitting(true)
      setErrorMsg('')

      const items = lines.map((q, idx) => {
        let artist = ''
        let title = q

        if (/\s+by\s+/i.test(title)) {
          const parts = title.split(/\s+by\s+/i)
          title = parts[0].trim()
          artist = parts[1].trim()
        } else if (title.includes(' - ')) {
          const parts = title.split(' - ')
          artist = parts[0].trim()
          title = parts.slice(1).join(' - ').trim()
        }

        const formatCap = (s: string) =>
          s
            .split(' ')
            .map(w => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ')
        if (artist) artist = formatCap(artist)
        if (title) title = formatCap(title)

        const filename = artist ? `${artist} - ${title}.mp3` : `${title}.mp3`
        const query = artist ? `${artist} - ${title}` : title

        return {
          id: `task_${Date.now()}_${idx}`,
          query,
          artist,
          title,
          filename
        }
      })

      await api.downloadMusicBatch(items)
      setInputLines('')
      fetchTasks()
    } catch (err: any) {
      console.error('Batch download submission failed', err)
      setErrorMsg(err.message || 'Failed to submit download batch')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteTask = async (taskId: string) => {
    try {
      await api.deleteMusicTask(taskId)
      setTasks(prev => prev.filter(t => t.task_id !== taskId))
    } catch (err) {
      console.error('Failed to delete task', err)
    }
  }

  const getStatusBadge = (task: TaskProgressItem) => {
    switch (task.status) {
      case 'completed':
        return (
          <span className="task-status-badge status-completed">
            <CheckCircle2 size={13} /> Completed
          </span>
        )
      case 'failed':
        return (
          <span className="task-status-badge status-failed">
            <AlertCircle size={13} /> Failed
          </span>
        )
      case 'converting':
        return (
          <span className="task-status-badge status-converting">
            <RefreshCw size={13} className="spin-icon" /> Converting MP3
          </span>
        )
      case 'downloading':
        return (
          <span className="task-status-badge status-downloading">
            <Download size={13} className="pulse-icon" /> Downloading {Math.round(task.progress_percent)}%
          </span>
        )
      case 'searching':
        return (
          <span className="task-status-badge status-searching">
            <RefreshCw size={13} className="spin-icon" /> Searching...
          </span>
        )
      default:
        return (
          <span className="task-status-badge status-queued">
            <Clock size={13} /> Queued
          </span>
        )
    }
  }

  const activeTasks = tasks.filter(t => ['queued', 'searching', 'downloading', 'converting'].includes(t.status))
  const pastTasks = tasks.filter(t => ['completed', 'failed', 'cancelled'].includes(t.status))

  return (
    <div className="music-tasks-container">
      {/* Quick Batch Downloader Form */}
      <div className="music-downloader-card">
        <div className="downloader-card-header">
          <div className="downloader-title-wrap">
            <Sparkles size={18} className="sparkle-icon" />
            <h3>Batch Music Downloader</h3>
          </div>
          <span className="downloader-subtitle">
            Powered by <code>muse-music-downloader</code> & FFmpeg
          </span>
        </div>

        <p className="downloader-hint">
          Enter song titles, artist names, or YouTube URLs below. You can enter multiple songs separated by newlines or commas!
        </p>

        <textarea
          className="downloader-textarea"
          rows={3}
          placeholder="e.g.&#10;Queen - Bohemian Rhapsody&#10;The Weeknd - Blinding Lights&#10;https://www.youtube.com/watch?v=..."
          value={inputLines}
          onChange={e => setInputLines(e.target.value)}
        />

        {errorMsg && <div className="downloader-error-alert">{errorMsg}</div>}

        <div className="downloader-submit-row">
          <button
            className="music-btn-primary"
            disabled={submitting || !inputLines.trim()}
            onClick={handleStartBatch}
          >
            {submitting ? (
              <>
                <RefreshCw size={15} className="spin-icon" />
                <span>Submitting Batch...</span>
              </>
            ) : (
              <>
                <Download size={15} />
                <span>Start Batch Download</span>
                <ArrowRight size={14} />
              </>
            )}
          </button>
        </div>
      </div>

      {/* Active Tasks Queue */}
      <div className="music-tasks-section">
        <div className="tasks-section-header">
          <div className="section-title-wrap">
            <ListMusic size={18} />
            <h4>Active Downloads ({activeTasks.length})</h4>
          </div>
          {activeTasks.length > 0 && (
            <span className="tasks-live-indicator">
              <span className="live-dot" /> Live Progress
            </span>
          )}
        </div>

        {activeTasks.length === 0 ? (
          <div className="tasks-empty-state">
            <Clock size={24} />
            <p>No downloads currently running.</p>
          </div>
        ) : (
          <div className="task-cards-list">
            {activeTasks.map(task => (
              <div key={task.task_id} className="task-progress-card">
                <div className="task-card-top">
                  <div className="task-info-block">
                    <span className="task-song-title">
                      {task.filename || task.title || task.query}
                    </span>
                    <span className="task-query-meta">Query: {task.query}</span>
                  </div>
                  <div className="task-status-block">
                    {getStatusBadge(task)}
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="task-progress-bar-track">
                  <div
                    className={`task-progress-bar-fill ${task.status === 'converting' ? 'converting-animated' : ''}`}
                    style={{ width: `${Math.max(5, Math.min(100, task.progress_percent))}%` }}
                  />
                </div>

                <div className="task-card-bottom">
                  <span className="task-pct-text">
                    {task.status === 'converting'
                      ? 'Extracting & converting audio to MP3...'
                      : `${Math.round(task.progress_percent)}% complete`}
                  </span>
                  <div className="task-stats-row">
                    {task.speed_str && <span className="task-stat-item">{task.speed_str}</span>}
                    {task.eta_str && <span className="task-stat-item">ETA: {task.eta_str}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Download History / Past Tasks */}
      {pastTasks.length > 0 && (
        <div className="music-tasks-section">
          <div className="tasks-section-header">
            <h4>History ({pastTasks.length})</h4>
          </div>

          <div className="task-cards-list">
            {pastTasks.map(task => (
              <div key={task.task_id} className="task-progress-card past-task-card">
                <div className="task-card-top">
                  <div className="task-info-block">
                    <span className="task-song-title">
                      {task.filename || task.title || task.query}
                    </span>
                    {task.error ? (
                      <span className="task-error-text">{task.error}</span>
                    ) : (
                      <span className="task-query-meta">Saved as MP3</span>
                    )}
                  </div>
                  <div className="task-status-block">
                    {getStatusBadge(task)}
                    <button
                      className="task-remove-btn"
                      onClick={() => handleDeleteTask(task.task_id)}
                      title="Clear from history"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
