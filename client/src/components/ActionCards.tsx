import { useState, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  FileText,
  CheckSquare,
  Square,
  Calendar,
  Sparkles,
  MapPin,
  Clock,
  ExternalLink,
  Check,
  SlidersHorizontal,
  Layers3,
  Trash2,
  ShieldAlert,
  X,
  Music,
  Play,
  Pause,
  Download,
  CheckCircle2,
  RefreshCw,
  Music2,
  ListMusic,
  ArrowRight,
  Image as ImageIcon
} from 'lucide-react'
import { api, resolveApiImageSrc } from '../services/api'
import { robotMusic, type MusicPlayerState } from '../services/robot-music.service'
import type {
  ActionCard,
  NoteActionCard,
  TaskActionCard,
  EventActionCard,
  MemoryActionCard,
  TemplateActionCard,
  SpecializedNoteActionCard,
  DeletedItemActionCard,
  ConfirmRequiredActionCard,
  MusicActionCard,
  GeneratedImageActionCard
} from '../types'

interface ActionCardsProps {
  cards?: ActionCard[]
  onOpenNote?: (id: string) => void
  onNavigate?: (path: string) => void
}

function normalizeCard(raw: any): ActionCard {
  const d = raw?.data || {}
  const type = raw?.type || d?.type || 'note'

  if (type === 'note' || type === 'note_updated') {
    return {
      type: 'note',
      id: raw.id || d.id || '',
      title: raw.title || d.title || 'Untitled Note',
      contentSnippet: raw.contentSnippet || raw.snippet || d.contentSnippet || d.snippet || '',
      tags: raw.tags || d.tags || []
    }
  }
  if (type === 'task' || type === 'task_updated') {
    return {
      type: 'task',
      id: raw.id || d.id || '',
      text: raw.text || d.text || 'Untitled Task',
      completed: typeof raw.completed === 'boolean' ? raw.completed : !!d.completed,
      dueDate: raw.dueDate || raw.due_date || d.dueDate || d.due_date || null,
      priority: raw.priority || d.priority
    }
  }
  if (type === 'event') {
    return {
      type: 'event',
      id: raw.id || d.id || '',
      title: raw.title || d.title || 'Untitled Event',
      startTime: raw.startTime || raw.start_time || d.startTime || d.start_time || '',
      endTime: raw.endTime || raw.end_time || d.endTime || d.end_time || null,
      location: raw.location || d.location || ''
    }
  }
  if (type === 'memory') {
    return {
      type: 'memory',
      id: raw.id || d.id || '',
      fact: raw.fact || d.fact || '',
      category: raw.category || d.category || 'general'
    }
  }
  if (type === 'specialized_note') {
    return {
      type: 'specialized_note',
      id: raw.id || d.id || '',
      title: raw.title || d.title || 'Specialized Note',
      contentSnippet: raw.contentSnippet || raw.snippet || d.contentSnippet || d.snippet || '',
      tags: raw.tags || d.tags || [],
      category: raw.category || d.category || (d.specialized?.category) || 'custom'
    }
  }
  if (type === 'template') {
    return {
      type: 'template',
      id: raw.id || d.id || '',
      title: raw.title || d.title || 'Custom Template',
      contentSnippet: raw.contentSnippet || d.description || '',
      category: raw.category || d.category || 'custom'
    }
  }
  if (type === 'confirm_required') {
    return {
      type: 'confirm_required',
      id: raw.id || d.id,
      title: raw.title || d.title || 'Item',
      itemType: raw.itemType || d.itemType || 'Item',
      status: raw.status || d.status || 'Delete',
      token: d.token || raw.token || ''
    }
  }
  if (type === 'item_deleted' || type === 'deleted') {
    return {
      type: 'item_deleted',
      id: raw.id || d.id || '',
      title: raw.title || d.title || 'Deleted Item',
      contentSnippet: raw.contentSnippet || d.contentSnippet || '',
      category: raw.category || d.category || 'item',
      itemType: raw.itemType || d.itemType || raw.category || 'Item',
      status: raw.status || d.status || 'Deleted'
    }
  }
  if (type === 'music' || type === 'song') {
    return {
      type: 'music',
      id: raw.id || d.id || '',
      title: raw.title || d.title || 'Music Track',
      filename: raw.filename || d.filename || '',
      url: raw.url || d.url || '',
      status: raw.status || d.status || 'playing'
    }
  }
  if (type === 'music_download_plan') {
    return {
      type: 'music_download_plan',
      id: raw.id || d.id || '',
      title: raw.title || d.title || 'Music Download Plan',
      items: raw.items || d.items || [],
      count: raw.count || d.count || (raw.items || d.items || []).length
    }
  }
  if (type === 'music_download_progress') {
    return {
      type: 'music_download_progress',
      id: raw.id || d.id || '',
      title: raw.title || d.title || 'Downloading Music',
      tasks: raw.tasks || d.tasks || []
    }
  }
  if (type === 'playlist') {
    return {
      type: 'playlist',
      id: raw.id || d.id || '',
      title: raw.title || d.title || d.name || 'Playlist',
      name: raw.name || d.name || raw.title || 'Playlist',
      description: raw.description || d.description || '',
      tracks: raw.tracks || d.tracks || [],
      count: raw.count || d.count || (raw.tracks || d.tracks || []).length,
      status: raw.status || d.status || ''
    }
  }
  if (type === 'generated_image') {
    return {
      type: 'generated_image',
      id: raw.id || d.id || d.imageId || '',
      title: raw.title || d.title || 'Generated Image',
      contentSnippet: raw.contentSnippet || d.prompt || raw.prompt || '',
      data: {
        url: d.url || raw.url || '',
        imageId: d.imageId || raw.id || '',
        prompt: d.prompt || raw.prompt || '',
        model: d.model || raw.model || 'Gemini Image',
        mimeType: d.mimeType || 'image/png'
      }
    }
  }
  return raw
}

export function ActionCards({ cards, onOpenNote, onNavigate }: ActionCardsProps) {
  if (!cards || cards.length === 0) return null

  return (
    <div className="action-cards-container">
      {cards.map((rawCard, idx) => {
        const card = normalizeCard(rawCard)
        if (card.type === 'generated_image') {
          return (
            <GeneratedImageCard
              key={`gen-img-${card.id || idx}-${idx}`}
              card={card}
              onNavigate={onNavigate}
            />
          )
        }
        if (card.type === 'playlist') {
          return (
            <PlaylistCard
              key={`pl-${card.id || idx}-${idx}`}
              card={card}
              onNavigate={onNavigate}
            />
          )
        }
        if (card.type === 'music_download_plan') {
          return (
            <MusicDownloadPlanCard
              key={`dlplan-${card.id || idx}-${idx}`}
              card={card}
              onNavigate={onNavigate}
            />
          )
        }
        if (card.type === 'music_download_progress') {
          return (
            <MusicDownloadProgressCard
              key={`dlprog-${card.id || idx}-${idx}`}
              card={card}
              onNavigate={onNavigate}
            />
          )
        }
        if (card.type === 'music') {
          return <MusicCard key={`music-${card.id || idx}-${idx}`} card={card} />
        }
        if (card.type === 'note') {
          return (
            <NoteCard
              key={`note-${card.id || idx}-${idx}`}
              card={card}
              onOpenNote={onOpenNote}
              onNavigate={onNavigate}
            />
          )
        }
        if (card.type === 'specialized_note') {
          return (
            <SpecializedNoteCard
              key={`spec-note-${card.id || idx}-${idx}`}
              card={card}
              onOpenNote={onOpenNote}
              onNavigate={onNavigate}
            />
          )
        }
        if (card.type === 'template') {
          return <TemplateCard key={`template-${card.id || idx}-${idx}`} card={card} />
        }
        if (card.type === 'task') {
          return <TaskCard key={`task-${card.id || idx}-${idx}`} card={card} />
        }
        if (card.type === 'event') {
          return <EventCard key={`event-${card.id || idx}-${idx}`} card={card} onNavigate={onNavigate} />
        }
        if (card.type === 'memory') {
          return <MemoryCard key={`memory-${card.id || idx}-${idx}`} card={card} />
        }
        if (card.type === 'item_deleted') {
          return <DeletedItemCard key={`deleted-${card.id || idx}-${idx}`} card={card} />
        }
        if (card.type === 'confirm_required') {
          return <ConfirmActionCard key={`confirm-${card.id || idx}-${idx}`} card={card} />
        }
        return null
      })}
    </div>
  )
}

function ConfirmActionCard({ card }: { card: ConfirmRequiredActionCard }) {
  const queryClient = useQueryClient()
  const [state, setState] = useState<'pending' | 'working' | 'done' | 'cancelled'>('pending')
  const [error, setError] = useState('')

  async function confirm() {
    setState('working')
    setError('')
    try {
      await api.confirmAgentAction(card.token)
      setState('done')
      void queryClient.invalidateQueries()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not complete this action.')
      setState('pending')
    }
  }

  const label = `${card.status} ${card.itemType.toLowerCase()}`
  return (
    <div className="action-card action-card-deleted">
      <div className="action-card-header">
        <span className="action-card-badge badge-deleted">
          {state === 'done' ? <Trash2 size={13} /> : <ShieldAlert size={13} />}
          <span>{card.itemType}</span>
        </span>
        <span className="action-card-status-pill">
          {state === 'done' ? 'Done' : state === 'cancelled' ? 'Cancelled' : 'Needs your confirmation'}
        </span>
      </div>
      <h4 className={`action-card-title${state === 'done' ? ' deleted-title' : ''}`}>{card.title}</h4>
      {error && <p className="action-card-snippet" role="alert">{error}</p>}
      {(state === 'pending' || state === 'working') && (
        <div className="action-card-confirm-row">
          <button type="button" className="confirm-modal-btn danger" disabled={state === 'working' || !card.token} onClick={() => void confirm()}>
            <Check size={13} /> {state === 'working' ? 'Working…' : label}
          </button>
          <button type="button" className="confirm-modal-btn cancel" disabled={state === 'working'} onClick={() => setState('cancelled')}>
            <X size={13} /> Cancel
          </button>
        </div>
      )}
    </div>
  )
}

function DeletedItemCard({ card }: { card: DeletedItemActionCard }) {
  return (
    <div className="action-card action-card-deleted">
      <div className="action-card-header">
        <span className="action-card-badge badge-deleted">
          <Trash2 size={13} />
          <span>{card.itemType || 'Deleted'}</span>
        </span>
        <span className="action-card-status-pill">{card.status || 'Deleted'}</span>
      </div>
      <h4 className="action-card-title deleted-title">{card.title}</h4>
      {card.contentSnippet && (
        <p className="action-card-snippet">{card.contentSnippet}</p>
      )}
    </div>
  )
}

function NoteCard({
  card,
  onOpenNote,
  onNavigate
}: {
  card: NoteActionCard
  onOpenNote?: (id: string) => void
  onNavigate?: (path: string) => void
}) {
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!card.id) {
      console.warn('[ActionCards] NoteCard clicked with empty id:', card)
      return
    }
    if (onOpenNote) {
      onOpenNote(card.id)
    } else if (onNavigate) {
      onNavigate(`/note/${card.id}`)
    } else {
      window.location.href = `/note/${card.id}`
    }
  }

  return (
    <div className="action-card action-card-note" onClick={handleClick} role="button" tabIndex={0}>
      <div className="action-card-header">
        <span className="action-card-badge badge-note">
          <FileText size={13} />
          <span>Note</span>
        </span>
        <span className="action-card-link-hint">
          Open <ExternalLink size={12} />
        </span>
      </div>
      <h4 className="action-card-title">{card.title || 'Untitled Note'}</h4>
      {card.contentSnippet && (
        <p className="action-card-snippet">{card.contentSnippet}</p>
      )}
      {card.tags && card.tags.length > 0 && (
        <div className="action-card-tags">
          {card.tags.map(tag => (
            <span key={tag} className="action-card-tag">#{tag}</span>
          ))}
        </div>
      )}
    </div>
  )
}

function TaskCard({ card }: { card: TaskActionCard }) {
  const [completed, setCompleted] = useState(card.completed)
  const [loading, setLoading] = useState(false)

  const toggleTask = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const nextState = !completed
    setCompleted(nextState)
    setLoading(true)
    try {
      await api.updateTask(card.id, { completed: nextState })
    } catch {
      // Revert if API failed
      setCompleted(!nextState)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={`action-card action-card-task ${completed ? 'completed' : ''}`}>
      <div className="action-card-header">
        <span className="action-card-badge badge-task">
          <CheckSquare size={13} />
          <span>Task</span>
        </span>
        {card.priority && (
          <span className={`priority-badge priority-${card.priority}`}>
            {card.priority}
          </span>
        )}
      </div>
      <div className="task-content-row" onClick={toggleTask}>
        <button
          type="button"
          className={`task-checkbox ${completed ? 'checked' : ''}`}
          disabled={loading}
          aria-label={completed ? 'Mark task incomplete' : 'Mark task complete'}
        >
          {completed ? <Check size={13} /> : <Square size={13} />}
        </button>
        <span className={`task-text ${completed ? 'strikethrough' : ''}`}>
          {card.text}
        </span>
      </div>
      {card.dueDate && (
        <div className="action-card-meta">
          <Clock size={12} />
          <span>Due: {card.dueDate}</span>
        </div>
      )}
    </div>
  )
}

function EventCard({
  card,
  onNavigate
}: {
  card: EventActionCard
  onNavigate?: (path: string) => void
}) {
  const formatTime = (isoString: string) => {
    try {
      const d = new Date(isoString)
      return d.toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      })
    } catch {
      return isoString
    }
  }

  const handleClick = () => {
    if (onNavigate) {
      onNavigate('/calendar')
    } else {
      window.location.href = '/calendar'
    }
  }

  return (
    <div className="action-card action-card-event" onClick={handleClick} role="button" tabIndex={0}>
      <div className="action-card-header">
        <span className="action-card-badge badge-event">
          <Calendar size={13} />
          <span>Calendar Event</span>
        </span>
        <span className="action-card-link-hint">
          Calendar <ExternalLink size={12} />
        </span>
      </div>
      <h4 className="action-card-title">{card.title}</h4>
      <div className="action-card-meta">
        <Clock size={12} />
        <span>{formatTime(card.startTime)}</span>
      </div>
      {card.location && (
        <div className="action-card-meta">
          <MapPin size={12} />
          <span>{card.location}</span>
        </div>
      )}
    </div>
  )
}

function MemoryCard({ card }: { card: MemoryActionCard }) {
  return (
    <div className="action-card action-card-memory">
      <div className="action-card-header">
        <span className="action-card-badge badge-memory">
          <Sparkles size={13} />
          <span>Memory Saved</span>
        </span>
        <span className="memory-category-pill">{card.category || 'general'}</span>
      </div>
      <p className="memory-fact-text">“{card.fact}”</p>
    </div>
  )
}

function SpecializedNoteCard({
  card,
  onOpenNote,
  onNavigate
}: {
  card: SpecializedNoteActionCard
  onOpenNote?: (id: string) => void
  onNavigate?: (path: string) => void
}) {
  const handleClick = () => {
    if (card.id) {
      if (onOpenNote) onOpenNote(card.id)
      else if (onNavigate) onNavigate(`/note/${card.id}`)
    }
  }

  return (
    <div
      className="action-card action-card-note action-card-specialized"
      onClick={handleClick}
      role="button"
      tabIndex={0}
      title="Click to open specialized note in editor"
    >
      <div className="action-card-header">
        <span className="action-card-badge badge-specialized" style={{ color: '#7c3aed', background: '#ede9fe' }}>
          <Layers3 size={13} />
          <span>Specialized · {card.category ? card.category.charAt(0).toUpperCase() + card.category.slice(1) : 'Structured'}</span>
        </span>
        <ExternalLink size={13} className="action-card-external-icon" />
      </div>
      <h4 className="action-card-title">{card.title}</h4>
      {card.contentSnippet && (
        <p className="action-card-snippet">{card.contentSnippet}</p>
      )}
      {card.tags && card.tags.length > 0 && (
        <div className="action-card-tags">
          {card.tags.slice(0, 3).map((tag, idx) => (
            <span key={idx} className="action-card-tag">#{tag}</span>
          ))}
        </div>
      )}
    </div>
  )
}

function TemplateCard({ card }: { card: TemplateActionCard }) {
  return (
    <div className="action-card action-card-template" style={{ borderLeft: '3px solid #8b5cf6' }}>
      <div className="action-card-header">
        <span className="action-card-badge badge-template" style={{ color: '#6d28d9', background: '#f5f3ff' }}>
          <SlidersHorizontal size={13} />
          <span>Template Saved</span>
        </span>
      </div>
      <h4 className="action-card-title">{card.title}</h4>
      {card.contentSnippet && (
        <p className="action-card-snippet" style={{ color: '#6b7280' }}>{card.contentSnippet}</p>
      )}
    </div>
  )
}

function MusicCard({ card }: { card: MusicActionCard }) {
  const [musicState, setMusicState] = useState<MusicPlayerState>(robotMusic.getState())

  useEffect(() => {
    return robotMusic.subscribe(setMusicState)
  }, [])

  const isCurrentPlaying = musicState.isPlaying && (musicState.currentTrack?.title === card.title || !musicState.currentTrack)

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (musicState.currentTrack?.title === card.title) {
      robotMusic.togglePlayPause()
    } else {
      void robotMusic.playSong({
        title: card.title,
        filename: card.filename,
        url: card.url
      })
    }
  }

  const handleStop = (e: React.MouseEvent) => {
    e.stopPropagation()
    robotMusic.stop()
  }

  return (
    <div className="action-card action-card-music" style={{ borderLeft: '3px solid #ef4444' }}>
      <div className="action-card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="action-card-badge" style={{ color: '#ef4444', background: 'rgba(239, 68, 68, 0.12)', fontWeight: 700 }}>
          <Music size={13} />
          <span>Bip Singing · Live Stage</span>
        </span>
        {isCurrentPlaying && (
          <div className="bip-music-bars">
            <span />
            <span />
            <span />
          </div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 4 }}>
        <h4 className="action-card-title" style={{ margin: 0, fontSize: 13 }}>
          🎤 <span className="music-song-name-red">{card.title}</span>
        </h4>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            className="bip-music-ctrl-btn"
            onClick={handleToggle}
            title={isCurrentPlaying ? 'Pause song' : 'Play song'}
          >
            {isCurrentPlaying ? <Pause size={13} /> : <Play size={13} />}
          </button>
          <button
            type="button"
            className="bip-music-ctrl-btn stop"
            onClick={handleStop}
            title="Stop singing"
          >
            <Square size={11} fill="currentColor" />
          </button>
        </div>
      </div>
    </div>
  )
}

function MusicDownloadPlanCard({
  card,
  onNavigate
}: {
  card: any
  onNavigate?: (path: string) => void
}) {
  const [submitting, setSubmitting] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [activeTasks, setActiveTasks] = useState<any[]>([])
  const [createdTaskIds, setCreatedTaskIds] = useState<string[]>([])

  const items = card.items || []
  const toDownload = items.filter((it: any) => !it.already_downloaded)
  const allAlreadyDownloaded = items.length > 0 && toDownload.length === 0

  const handleConfirm = async () => {
    if (allAlreadyDownloaded) {
      onNavigate?.('/music')
      return
    }
    try {
      setSubmitting(true)
      const res = await api.downloadMusicBatch(toDownload)
      const tasks = res.tasks || []
      setConfirmed(true)
      setActiveTasks(tasks)
      setCreatedTaskIds(tasks.map((t: any) => t.task_id))
    } catch (err: any) {
      console.error('Failed to submit music download', err)
    } finally {
      setSubmitting(false)
    }
  }

  if (confirmed) {
    return (
      <MusicDownloadProgressCard
        card={{
          type: 'music_download_progress',
          title: `Downloading ${toDownload.length} Track${toDownload.length > 1 ? 's' : ''}`,
          tasks: activeTasks,
          taskIds: createdTaskIds
        }}
        onNavigate={onNavigate}
      />
    )
  }

  return (
    <div className="action-card action-card-music-plan">
      <div className="action-card-header">
        <span className="action-card-badge badge-music-plan">
          <Music2 size={13} />
          <span>Music Download Plan</span>
        </span>
        <button
          className="action-card-link-btn"
          onClick={() => onNavigate?.('/music')}
          title="Open Music Hub"
        >
          <span>Music Hub</span>
          <ArrowRight size={12} />
        </button>
      </div>

      <h4 className="action-card-title">{card.title || `Download ${items.length} Songs`}</h4>

      <div className="plan-items-list">
        {items.map((it: any, i: number) => (
          <div key={it.id || i} className="plan-item-row">
            <span className="plan-item-num">{i + 1}.</span>
            <div className="plan-item-meta">
              <span className="plan-item-title music-song-name-red">{it.title || it.query}</span>
              {it.artist && <span className="plan-item-artist">by <strong style={{ color: '#60a5fa' }}>{it.artist}</strong></span>}
              <code className="plan-item-filename">{it.filename}</code>
              {it.already_downloaded && (
                <span
                  className="already-downloaded-pill"
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: '#10b981',
                    background: 'rgba(16, 185, 129, 0.12)',
                    padding: '2px 7px',
                    borderRadius: 6,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 3
                  }}
                  title="This song is already downloaded in your library and will not be re-downloaded"
                >
                  <CheckCircle2 size={11} /> Already in library (skipped)
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="plan-actions-row">
        <button
          className="plan-confirm-btn"
          disabled={submitting || items.length === 0}
          onClick={handleConfirm}
          style={allAlreadyDownloaded ? { background: '#10b981' } : undefined}
        >
          {submitting ? (
            <>
              <RefreshCw size={14} className="spin-icon" />
              <span>Starting Downloads...</span>
            </>
          ) : allAlreadyDownloaded ? (
            <>
              <CheckCircle2 size={14} />
              <span>All in Library · Open Music Hub</span>
            </>
          ) : (
            <>
              <Download size={14} />
              <span>Confirm & Download ({toDownload.length}{items.length > toDownload.length ? ` of ${items.length}` : ''})</span>
            </>
          )}
        </button>
      </div>
    </div>
  )
}

function MusicDownloadProgressCard({
  card,
  onNavigate
}: {
  card: any
  onNavigate?: (path: string) => void
}) {
  const isActivelyDownloading = (status: string) =>
    ['queued', 'searching', 'downloading', 'converting'].includes(status)

  const targetIds: string[] = card.taskIds || (Array.isArray(card.tasks) ? card.tasks.map((t: any) => t.task_id).filter(Boolean) : [])

  const [tasks, setTasks] = useState<any[]>(() =>
    (card.tasks || []).filter((t: any) => isActivelyDownloading(t.status || 'downloading'))
  )
  const [hasFinishedAll, setHasFinishedAll] = useState(false)

  useEffect(() => {
    let mounted = true
    const poll = async () => {
      try {
        const res = await api.getMusicTasks()
        if (mounted && Array.isArray(res.tasks)) {
          if (targetIds.length > 0) {
            // ONLY show the tasks that belong to THIS download action AND are actively downloading!
            const matching = res.tasks.filter(
              (t: any) => targetIds.includes(t.task_id) && isActivelyDownloading(t.status)
            )
            setTasks(matching)

            const allTargetTasks = res.tasks.filter((t: any) => targetIds.includes(t.task_id))
            if (allTargetTasks.length > 0 && allTargetTasks.every((t: any) => t.status === 'completed' || t.status === 'failed')) {
              setHasFinishedAll(true)
            }
          } else {
            // Fallback: only currently active downloads across the board
            const active = res.tasks.filter((t: any) => isActivelyDownloading(t.status))
            setTasks(active)
          }
        }
      } catch {}
    }

    poll()
    const timer = setInterval(poll, 1200)
    return () => {
      mounted = false
      clearInterval(timer)
    }
  }, [targetIds.join(',')])

  const relevantTasks = tasks.slice(0, 5)

  return (
    <div className="action-card action-card-music-progress" style={{ borderLeft: '4px solid #2563eb' }}>
      <div className="action-card-header">
        <span className="action-card-badge badge-music-progress" style={{ color: '#2563eb', background: 'rgba(37, 99, 235, 0.12)' }}>
          <Download size={13} className="pulse-icon" style={{ color: '#2563eb' }} />
          <span>Active Downloads{relevantTasks.length > 0 ? ` (${relevantTasks.length})` : ''}</span>
        </span>
        <button
          className="action-card-link-btn"
          onClick={() => onNavigate?.('/music')}
          title="Open Music Hub"
          style={{ color: '#2563eb' }}
        >
          <span>Music Hub</span>
          <ArrowRight size={12} />
        </button>
      </div>

      <div className="card-tasks-list">
        {relevantTasks.length === 0 ? (
          hasFinishedAll ? (
            <div className="card-downloads-complete-box">
              <div className="complete-icon-circle">
                <CheckCircle2 size={18} />
              </div>
              <div className="complete-info">
                <span className="complete-title">All Downloads Complete</span>
                <span className="complete-desc">Your music is ready to play in the Music Hub.</span>
              </div>
              <button
                className="music-hub-quick-btn"
                onClick={() => onNavigate?.('/music')}
                title="Open Music Hub"
              >
                <span>Open Library</span>
                <ArrowRight size={12} />
              </button>
            </div>
          ) : (
            <div className="card-empty-tasks-text">No active download tasks</div>
          )
        ) : (
          relevantTasks.map((t: any) => {
            const pct = Math.max(5, Math.min(100, t.progress_percent || 0))

            return (
              <div key={t.task_id} className="card-task-item">
                <div className="card-task-info">
                  <div className="card-task-title-group">
                    <span className="card-task-title music-song-name-red">{t.title || t.filename || t.query}</span>
                    {t.artist && <span className="card-task-artist">by {t.artist}</span>}
                  </div>
                  <span className="card-task-status" style={{ color: '#2563eb' }}>
                    {t.status === 'converting' ? (
                      <>
                        <RefreshCw size={12} className="spin-icon" style={{ color: '#2563eb' }} />
                        <span>Converting MP3</span>
                      </>
                    ) : t.status === 'searching' ? (
                      <>
                        <RefreshCw size={12} className="spin-icon" style={{ color: '#2563eb' }} />
                        <span>Searching stream</span>
                      </>
                    ) : (
                      <>
                        <Download size={12} style={{ color: '#2563eb' }} />
                        <span>{Math.round(pct)}%</span>
                      </>
                    )}
                  </span>
                </div>

                <div className="card-task-progress-bar" style={{ background: 'rgba(37, 99, 235, 0.12)' }}>
                  <div
                    className={`card-task-progress-fill ${t.status === 'converting' ? 'converting-animated' : ''}`}
                    style={{
                      width: `${pct}%`,
                      background: 'linear-gradient(90deg, #2563eb, #3b82f6)'
                    }}
                  />
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function PlaylistCard({
  card,
  onNavigate
}: {
  card: any
  onNavigate?: (path: string) => void
}) {
  const [musicState, setMusicState] = useState<MusicPlayerState>(robotMusic.getState())
  const tracks = card.tracks || []

  useEffect(() => {
    return robotMusic.subscribe(setMusicState)
  }, [])

  const playlistTitle = card.name || card.title
  const isCurrentPlaylist = musicState.isPlaying && musicState.playlistName === playlistTitle

  const handlePlayToggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (tracks.length === 0) return
    if (isCurrentPlaylist) {
      robotMusic.togglePlayPause()
    } else {
      void robotMusic.playPlaylist(playlistTitle, tracks, 0)
    }
  }

  return (
    <div className="action-card action-card-playlist" style={{ borderLeft: '4px solid #8b5cf6' }}>
      <div className="action-card-header">
        <span className="action-card-badge" style={{ color: '#8b5cf6', background: 'rgba(139, 92, 246, 0.12)' }}>
          <ListMusic size={13} />
          <span>Music Playlist</span>
        </span>
        <button
          className="action-card-link-btn"
          onClick={() => onNavigate?.('/music')}
          title="Open Music Hub"
        >
          <span>Music Hub</span>
          <ArrowRight size={12} />
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 4 }}>
        <h4 className="action-card-title playlist-card-title" style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>
          🎧 {playlistTitle}
        </h4>
        <button
          className="plan-confirm-btn"
          style={{ padding: '5px 12px', fontSize: 12, background: isCurrentPlaylist ? '#10b981' : undefined }}
          onClick={handlePlayToggle}
          disabled={tracks.length === 0}
        >
          {isCurrentPlaylist ? (
            <>
              <Pause size={12} fill="currentColor" />
              <span>Pause Mix</span>
            </>
          ) : (
            <>
              <Play size={12} fill="currentColor" />
              <span>Play Mix ({tracks.length})</span>
            </>
          )}
        </button>
      </div>

      {isCurrentPlaylist && musicState.currentTrack && (
        <div style={{ marginTop: 6, fontSize: 12, color: '#10b981', display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
          <Music size={13} className="spin-icon" />
          <span>Track {(musicState.playlistIndex || 0) + 1} of {tracks.length}: </span>
          <span className="music-song-name-red">{musicState.currentTrack.title}</span>
        </div>
      )}

      {card.description && (
        <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-secondary, #64748b)' }}>
          {card.description}
        </p>
      )}

      {tracks.length > 0 && (
        <div className="playlist-card-chips-row">
          {tracks.slice(0, 4).map((t: any, idx: number) => (
            <span key={idx} className="playlist-track-chip">
              <span style={{ fontSize: 10, fontWeight: 700, color: '#8b5cf6', marginRight: 4 }}>#{idx + 1}</span>
              <span className="chip-song-red">{t.title || t.filename}</span>
            </span>
          ))}
          {tracks.length > 4 && (
            <span className="playlist-track-more">+{tracks.length - 4} more</span>
          )}
        </div>
      )}
    </div>
  )
}

function GeneratedImageCard({ card, onNavigate }: { card: GeneratedImageActionCard; onNavigate?: (path: string) => void }) {
  const queryClient = useQueryClient()
  const [savedToNote, setSavedToNote] = useState(false)
  const [saving, setSaving] = useState(false)
  const imgUrl = resolveApiImageSrc(card.data?.url || (card as any).url || '')

  const handleSaveToNote = async () => {
    if (!imgUrl || saving) return
    setSaving(true)
    try {
      const title = card.title || 'Generated Image'
      const content = `<p><img src="${imgUrl}" alt="${card.data?.prompt || title}" /></p><p>${card.data?.prompt || ''}</p>`
      const note = await api.createNote({
        title,
        content,
        tags: ['image', 'ai-generated']
      })
      queryClient.invalidateQueries({ queryKey: ['notes'] })
      setSavedToNote(true)
      setTimeout(() => setSavedToNote(false), 3000)
      if (note?.id && onNavigate) {
        onNavigate(`/note/${note.id}`)
      }
    } catch (err) {
      console.error('Failed to save generated image to note:', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="action-card generated-image-card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="action-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="action-card-title-group" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ImageIcon size={16} className="action-card-icon" style={{ color: '#ec4899' }} />
          <span className="action-card-title" style={{ fontWeight: 600 }}>{card.title || 'Generated Image'}</span>
          {card.data?.model && (
            <span
              className="action-card-badge"
              style={{
                fontSize: 11,
                padding: '2px 8px',
                borderRadius: 12,
                backgroundColor: 'rgba(236, 72, 153, 0.1)',
                color: '#db2777',
                border: '1px solid rgba(236, 72, 153, 0.2)'
              }}
            >
              {card.data.model}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {imgUrl && (
            <a
              href={imgUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="action-card-btn"
              title="Open full size in new tab"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 12,
                padding: '4px 10px',
                borderRadius: 6,
                textDecoration: 'none',
                color: 'inherit',
                border: '1px solid var(--border, #cbd5e1)'
              }}
            >
              <ExternalLink size={12} />
              <span>View</span>
            </a>
          )}
          <button
            type="button"
            className="action-card-btn"
            onClick={handleSaveToNote}
            disabled={saving || !imgUrl}
            title="Save as a new note in Muse"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 12,
              padding: '4px 10px',
              borderRadius: 6,
              cursor: saving ? 'wait' : 'pointer',
              border: '1px solid var(--border, #cbd5e1)'
            }}
          >
            {savedToNote ? <><Check size={12} /> Saved</> : <><FileText size={12} /> Save to Note</>}
          </button>
        </div>
      </div>

      {imgUrl && (
        <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border, #e2e8f0)', maxHeight: 320, display: 'flex', justifyContent: 'center', background: '#0000000a' }}>
          <a href={imgUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'block', maxWidth: '100%' }}>
            <img
              src={imgUrl}
              alt={card.data?.prompt || card.title}
              style={{ maxWidth: '100%', maxHeight: 320, objectFit: 'contain', display: 'block' }}
              loading="lazy"
            />
          </a>
        </div>
      )}

      {card.data?.prompt && (
        <p style={{ margin: 0, fontSize: 12, fontStyle: 'italic', color: 'var(--text-secondary, #64748b)' }}>
          "{card.data.prompt}"
        </p>
      )}
    </div>
  )
}


