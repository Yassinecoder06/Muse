import { useState } from 'react'
import {
  FileText,
  CheckSquare,
  Square,
  Calendar,
  Sparkles,
  MapPin,
  Clock,
  ExternalLink,
  Check
} from 'lucide-react'
import { api } from '../services/api'
import type {
  ActionCard,
  NoteActionCard,
  TaskActionCard,
  EventActionCard,
  MemoryActionCard
} from '../types'

interface ActionCardsProps {
  cards?: ActionCard[]
  onOpenNote?: (id: string) => void
  onNavigate?: (path: string) => void
}

export function ActionCards({ cards, onOpenNote, onNavigate }: ActionCardsProps) {
  if (!cards || cards.length === 0) return null

  return (
    <div className="action-cards-container">
      {cards.map((card, idx) => {
        if (card.type === 'note') {
          return (
            <NoteCard
              key={`note-${card.id}-${idx}`}
              card={card}
              onOpenNote={onOpenNote}
              onNavigate={onNavigate}
            />
          )
        }
        if (card.type === 'task') {
          return <TaskCard key={`task-${card.id}-${idx}`} card={card} />
        }
        if (card.type === 'event') {
          return <EventCard key={`event-${card.id}-${idx}`} card={card} onNavigate={onNavigate} />
        }
        if (card.type === 'memory') {
          return <MemoryCard key={`memory-${card.id}-${idx}`} card={card} />
        }
        return null
      })}
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
  const handleClick = () => {
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
