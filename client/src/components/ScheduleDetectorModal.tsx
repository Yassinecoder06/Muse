import { useState, useEffect } from 'react'
import { Calendar, CheckSquare, Clock, Plus, Sparkles, X, Check, ArrowRight } from 'lucide-react'
import { api } from '../services/api'
import type { DetectionResult } from '../types'

export function ScheduleDetectorModal({
  noteId,
  noteTitle,
  noteContent,
  onClose,
  onApplied
}: {
  noteId?: string
  noteTitle: string
  noteContent: string
  onClose: () => void
  onApplied: (msg: string) => void
}) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [events, setEvents] = useState<{ title: string; start_time: string; end_time?: string | null; all_day?: boolean; selected: boolean }[]>([])
  const [tasks, setTasks] = useState<{ text: string; due_date?: string | null; priority: 'low' | 'medium' | 'high'; selected: boolean }[]>([])
  const [applying, setApplying] = useState(false)

  useEffect(() => {
    let active = true
    const detect = async () => {
      try {
        setLoading(true)
        setError('')
        const result: DetectionResult = await api.detectSchedule(noteId, {
          title: noteTitle,
          content: noteContent
        })
        if (!active) return
        setEvents((result.events || []).map(e => ({ ...e, selected: true })))
        setTasks((result.tasks || []).map(t => ({
          text: t.text,
          due_date: t.due_date || null,
          priority: (t.priority as any) || 'medium',
          selected: true
        })))
      } catch (err) {
        if (!active) return
        setError(err instanceof Error ? err.message : 'Could not detect events or tasks')
      } finally {
        if (active) setLoading(false)
      }
    }
    void detect()
    return () => { active = false }
  }, [noteId, noteTitle, noteContent])

  const toggleEvent = (index: number) => {
    setEvents(items => items.map((item, i) => i === index ? { ...item, selected: !item.selected } : item))
  }

  const toggleTask = (index: number) => {
    setTasks(items => items.map((item, i) => i === index ? { ...item, selected: !item.selected } : item))
  }

  const selectedEvents = events.filter(e => e.selected)
  const selectedTasks = tasks.filter(t => t.selected)
  const totalSelected = selectedEvents.length + selectedTasks.length

  const handleApply = async () => {
    if (totalSelected === 0) return
    try {
      setApplying(true)
      const res = await api.applyDetections(noteId || null, {
        events: selectedEvents.map(({ selected, ...rest }) => rest),
        tasks: selectedTasks.map(({ selected, ...rest }) => rest)
      })
      onApplied(`Added ${res.addedEvents} event${res.addedEvents === 1 ? '' : 's'} and ${res.addedTasks} task${res.addedTasks === 1 ? '' : 's'} to your workspace.`)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to schedule items')
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="command-backdrop" onClick={onClose}>
      <div className="command detector-modal" onClick={e => e.stopPropagation()}>
        <header className="detector-header">
          <div className="detector-title-badge">
            <Sparkles size={18} />
            <strong>Detect Calendar & Tasks</strong>
          </div>
          <button onClick={onClose}><X size={17} /></button>
        </header>

        <p className="detector-subtitle">
          Muse scanned your note text and identified these schedule items and action tasks:
        </p>

        {loading ? (
          <div className="detector-loading">
            <div className="loader" />
            <span>Scanning note for dates, appointments, and tasks…</span>
          </div>
        ) : error ? (
          <div className="detector-error">{error}</div>
        ) : events.length === 0 && tasks.length === 0 ? (
          <div className="detector-empty">
            <Sparkles size={32} />
            <h4>No schedule items found</h4>
            <p>Write notes mentioning times or tasks like <em>"Gym tomorrow at 20h"</em> or <em>"Submit report on Friday"</em>.</p>
          </div>
        ) : (
          <div className="detector-body">
            {/* Events Section */}
            {events.length > 0 && (
              <div className="detector-section">
                <div className="section-title">
                  <Calendar size={16} />
                  <span>Calendar Events ({events.length})</span>
                </div>
                <div className="detector-items-list">
                  {events.map((ev, i) => (
                    <div
                      key={i}
                      className={`detector-item-card ${ev.selected ? 'selected' : ''}`}
                      onClick={() => toggleEvent(i)}
                    >
                      <button className={`item-check ${ev.selected ? 'on' : ''}`}>
                        {ev.selected && <Check size={13} />}
                      </button>
                      <div className="item-details">
                        <strong>{ev.title}</strong>
                        <div className="item-meta">
                          <Clock size={12} />
                          <span>
                            {new Date(ev.start_time).toLocaleString(undefined, {
                              weekday: 'short',
                              month: 'short',
                              day: 'numeric',
                              hour: ev.all_day ? undefined : '2-digit',
                              minute: ev.all_day ? undefined : '2-digit'
                            })}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tasks Section */}
            {tasks.length > 0 && (
              <div className="detector-section">
                <div className="section-title">
                  <CheckSquare size={16} />
                  <span>Action Items & Tasks ({tasks.length})</span>
                </div>
                <div className="detector-items-list">
                  {tasks.map((tk, i) => (
                    <div
                      key={i}
                      className={`detector-item-card ${tk.selected ? 'selected' : ''}`}
                      onClick={() => toggleTask(i)}
                    >
                      <button className={`item-check ${tk.selected ? 'on' : ''}`}>
                        {tk.selected && <Check size={13} />}
                      </button>
                      <div className="item-details">
                        <strong>{tk.text}</strong>
                        {tk.due_date && (
                          <div className="item-meta">
                            <Calendar size={12} />
                            <span>Due: {tk.due_date}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <footer className="detector-footer">
          <button className="cancel-btn" onClick={onClose}>Cancel</button>
          <button
            className="save-btn"
            disabled={loading || applying || totalSelected === 0}
            onClick={handleApply}
          >
            {applying ? 'Adding…' : `Add ${totalSelected} Item${totalSelected === 1 ? '' : 's'} to Workspace`}
          </button>
        </footer>
      </div>
    </div>
  )
}
