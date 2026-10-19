import { useState } from 'react'
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
  X
} from 'lucide-react'
import { api } from '../services/api'
import type {
  ActionCard,
  NoteActionCard,
  TaskActionCard,
  EventActionCard,
  MemoryActionCard,
  TemplateActionCard,
  SpecializedNoteActionCard,
  DeletedItemActionCard,
  ConfirmRequiredActionCard
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
  return raw
}

export function ActionCards({ cards, onOpenNote, onNavigate }: ActionCardsProps) {
  if (!cards || cards.length === 0) return null

  return (
    <div className="action-cards-container">
      {cards.map((rawCard, idx) => {
        const card = normalizeCard(rawCard)
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
