import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Calendar as CalendarIcon, ChevronLeft, ChevronRight, Clock, MapPin, Plus, Sparkles, Trash2, FileText, X } from 'lucide-react'
import { api } from '../services/api'
import type { CalendarEvent } from '../types'

export function CalendarView({ onBack }: { onBack: () => void }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [currentDate, setCurrentDate] = useState(() => new Date())
  const [selectedDate, setSelectedDate] = useState(() => new Date())
  const [prompt, setPrompt] = useState('')
  const [quickAddError, setQuickAddError] = useState('')
  const [manualModal, setManualModal] = useState(false)
  const [manualTitle, setManualTitle] = useState('')
  const [manualTime, setManualTime] = useState('10:00')
  const [manualDuration, setManualDuration] = useState('60')
  const [manualLocation, setManualLocation] = useState('')

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()

  // First day of month & days in month
  const firstDayIndex = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  // Fetch events for current month (with buffer)
  const fromIso = new Date(year, month, 1 - 7).toISOString()
  const toIso = new Date(year, month + 1, 7).toISOString()

  const { data: events = [], isLoading } = useQuery({
    queryKey: ['calendar-events', year, month],
    queryFn: () => api.listEvents(fromIso, toIso)
  })

  const quickAdd = useMutation({
    mutationFn: (text: string) => api.quickAddEvent(text, selectedDate.toISOString()),
    onSuccess: (newEvent) => {
      setPrompt('')
      setQuickAddError('')
      queryClient.invalidateQueries({ queryKey: ['calendar-events'] })
      if (newEvent.start_time) {
        setSelectedDate(new Date(newEvent.start_time))
      }
    },
    onError: (err) => {
      setQuickAddError(err instanceof Error ? err.message : 'Could not add event')
    }
  })

  const createManual = useMutation({
    mutationFn: (data: Partial<CalendarEvent>) => api.createEvent(data),
    onSuccess: () => {
      setManualModal(false)
      setManualTitle('')
      queryClient.invalidateQueries({ queryKey: ['calendar-events'] })
    }
  })

  const deleteEvent = useMutation({
    mutationFn: (id: string) => api.deleteEvent(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar-events'] })
    }
  })

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1))
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1))
  const goToday = () => {
    const today = new Date()
    setCurrentDate(today)
    setSelectedDate(today)
  }

  const selectedDateStr = selectedDate.toISOString().slice(0, 10)
  const dayEvents = events.filter(e => e.start_time.startsWith(selectedDateStr))

  const handleQuickAdd = (e: React.FormEvent) => {
    e.preventDefault()
    if (!prompt.trim()) return
    quickAdd.mutate(prompt.trim())
  }

  const handleCreateManual = (e: React.FormEvent) => {
    e.preventDefault()
    if (!manualTitle.trim()) return
    const [hours, mins] = manualTime.split(':').map(Number)
    const start = new Date(selectedDate)
    start.setHours(hours || 10, mins || 0, 0, 0)
    const end = new Date(start.getTime() + Number(manualDuration || 60) * 60 * 1000)

    createManual.mutate({
      title: manualTitle.trim(),
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      all_day: false,
      location: manualLocation.trim()
    })
  }

  const createEventScratchpad = async (event: CalendarEvent) => {
    const note = await api.createNote({
      title: `${event.title} - Notes`,
      content: `<p><strong>Event:</strong> ${event.title}</p><p><strong>When:</strong> ${new Date(event.start_time).toLocaleString()}</p>${event.location ? `<p><strong>Location:</strong> ${event.location}</p>` : ''}<hr/><p>Write your thoughts and logs here...</p>`
    })
    await api.updateEvent(event.id, { note_id: note.id })
    queryClient.invalidateQueries({ queryKey: ['calendar-events'] })
    navigate(`/note/${note.id}`)
  }

  return (
    <div className="calendar-page">
      <header className="calendar-topbar">
        <div className="calendar-top-left">
          <button className="back-btn" onClick={onBack} title="Back to Notes">
            <ArrowLeft size={18} />
          </button>
          <h2>Calendar</h2>
        </div>
        <div className="calendar-month-controls">
          <button onClick={prevMonth} title="Previous Month"><ChevronLeft size={18} /></button>
          <span className="month-label">
            {currentDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
          </span>
          <button onClick={nextMonth} title="Next Month"><ChevronRight size={18} /></button>
          <button className="today-btn" onClick={goToday}>Today</button>
        </div>
        <button className="add-event-btn" onClick={() => setManualModal(true)}>
          <Plus size={16} /> New Event
        </button>
      </header>

      {/* Natural Language Prompt Input */}
      <section className="nl-prompt-container">
        <form onSubmit={handleQuickAdd} className="nl-prompt-form">
          <Sparkles size={18} className="sparkle-icon" />
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Write a prompt e.g. 'going to the gym at 20h pm tomorrow' or 'Team sync on Friday 10am'..."
            disabled={quickAdd.isPending}
          />
          <button type="submit" disabled={quickAdd.isPending || !prompt.trim()}>
            {quickAdd.isPending ? 'Scheduling…' : 'Schedule'}
          </button>
        </form>
        {quickAddError && <p className="nl-error">{quickAddError}</p>}
        <div className="nl-prompt-suggestions">
          <span className="suggestion-label">Quick suggestions:</span>
          {[
            'Gym at 20h tonight',
            'Friend passing by at 18h to talk project',
            'Team sync Friday at 10am',
            'Dinner before gym at 19h'
          ].map((sug) => (
            <button
              key={sug}
              type="button"
              className="suggestion-pill"
              onClick={() => setPrompt(sug)}
            >
              {sug}
            </button>
          ))}
        </div>
      </section>

      <div className="calendar-main-grid">
        {/* Month View Table */}
        <section className="calendar-grid-card">
          <div className="weekdays-row">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
              <div key={day} className="weekday-cell">{day}</div>
            ))}
          </div>

          <div className="days-grid">
            {/* Blank padding cells before 1st of month */}
            {Array.from({ length: firstDayIndex }).map((_, i) => (
              <div key={`blank-${i}`} className="day-cell day-cell-empty" />
            ))}

            {/* Days of current month */}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const dayNum = i + 1
              const cellDate = new Date(year, month, dayNum)
              const cellIso = cellDate.toISOString().slice(0, 10)
              const isSelected = cellIso === selectedDateStr
              const isToday = cellIso === new Date().toISOString().slice(0, 10)
              const cellEvents = events.filter(e => e.start_time.startsWith(cellIso))

              return (
                <div
                  key={dayNum}
                  className={`day-cell ${isSelected ? 'selected' : ''} ${isToday ? 'today' : ''}`}
                  onClick={() => setSelectedDate(cellDate)}
                >
                  <div className="day-cell-header">
                    <span className="day-number">{dayNum}</span>
                    {cellEvents.length > 0 && <span className="event-count-badge">{cellEvents.length}</span>}
                  </div>
                  <div className="day-cell-events">
                    {cellEvents.slice(0, 2).map(event => (
                      <div key={event.id} className="event-pill" title={event.title}>
                        <span className="pill-dot" />
                        <span className="pill-title">{event.title}</span>
                      </div>
                    ))}
                    {cellEvents.length > 2 && (
                      <span className="more-pill">+{cellEvents.length - 2} more</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* Selected Day Agenda Drawer */}
        <aside className="calendar-day-agenda">
          <header className="agenda-header">
            <div>
              <h3>{selectedDate.toLocaleDateString(undefined, { weekday: 'long' })}</h3>
              <p>{selectedDate.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</p>
            </div>
            <button className="small-add-btn" onClick={() => setManualModal(true)} title="Add event for this day">
              <Plus size={16} />
            </button>
          </header>

          <div className="agenda-events-list">
            {isLoading ? (
              <p className="agenda-empty">Loading events…</p>
            ) : dayEvents.length === 0 ? (
              <div className="agenda-empty-state">
                <CalendarIcon size={28} />
                <p>No events scheduled for this day.</p>
                <small>Use the prompt bar above or click + to add an event.</small>
              </div>
            ) : (
              dayEvents.map(event => {
                const startTimeStr = new Date(event.start_time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
                const endTimeStr = event.end_time ? new Date(event.end_time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : null

                return (
                  <article key={event.id} className="agenda-event-card">
                    <div className="agenda-card-top">
                      <div className="event-time">
                        <Clock size={14} />
                        <span>{event.all_day ? 'All day' : `${startTimeStr}${endTimeStr ? ` - ${endTimeStr}` : ''}`}</span>
                      </div>
                      <button
                        className="delete-event-btn"
                        onClick={() => deleteEvent.mutate(event.id)}
                        title="Delete event"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>

                    <h4>{event.title}</h4>
                    {event.location && (
                      <p className="event-location"><MapPin size={13} /> {event.location}</p>
                    )}

                    <div className="agenda-card-footer">
                      {event.note_id ? (
                        <button
                          className="linked-note-btn"
                          onClick={() => navigate(`/note/${event.note_id}`)}
                        >
                          <FileText size={13} /> View Linked Note
                        </button>
                      ) : (
                        <button
                          className="create-scratchpad-btn"
                          onClick={() => createEventScratchpad(event)}
                        >
                          <FileText size={13} /> Open Scratchpad
                        </button>
                      )}
                    </div>
                  </article>
                )
              })
            )}
          </div>
        </aside>
      </div>

      {/* Manual Event Modal */}
      {manualModal && (
        <div className="command-backdrop" onClick={() => setManualModal(false)}>
          <div className="command manual-modal" onClick={e => e.stopPropagation()}>
            <header>
              <strong>New Calendar Event</strong>
              <button onClick={() => setManualModal(false)}><X size={17} /></button>
            </header>
            <form onSubmit={handleCreateManual} className="manual-form">
              <label>
                <span>Event Title</span>
                <input
                  type="text"
                  required
                  placeholder="e.g. Gym workout, Dentist, Project sync"
                  value={manualTitle}
                  onChange={e => setManualTitle(e.target.value)}
                  autoFocus
                />
              </label>
              <div className="form-row">
                <label>
                  <span>Start Time</span>
                  <input
                    type="time"
                    value={manualTime}
                    onChange={e => setManualTime(e.target.value)}
                  />
                </label>
                <label>
                  <span>Duration (mins)</span>
                  <input
                    type="number"
                    min="15"
                    step="15"
                    value={manualDuration}
                    onChange={e => setManualDuration(e.target.value)}
                  />
                </label>
              </div>
              <label>
                <span>Location (optional)</span>
                <input
                  type="text"
                  placeholder="e.g. Golds Gym, Zoom, Room 4"
                  value={manualLocation}
                  onChange={e => setManualLocation(e.target.value)}
                />
              </label>
              <div className="modal-actions">
                <button type="button" onClick={() => setManualModal(false)} className="cancel-btn">Cancel</button>
                <button type="submit" disabled={createManual.isPending || !manualTitle.trim()} className="save-btn">
                  {createManual.isPending ? 'Saving…' : 'Create Event'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
