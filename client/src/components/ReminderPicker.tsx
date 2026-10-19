import { useEffect, useRef, useState } from 'react'
import { Bell, BellOff, BellRing, X } from 'lucide-react'
import type { Task } from '../types'
import { REMINDER_PRESETS, describeReminder, localDateKey } from '../services/reminders'

type ReminderPatch = { due_date?: string | null; due_time?: string | null; reminder_minutes_before?: number | null; reminder_at?: string | null }

function toLocalInput(iso: string | null | undefined) {
  if (!iso) return ''
  const date = new Date(iso)
  return `${localDateKey(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** Bell button + popover to set when Bip should ring for a task. */
export function ReminderPicker({ task, onSave }: { task: Task; onSave: (patch: ReminderPatch) => Promise<unknown> }) {
  const [open, setOpen] = useState(false)
  const [dueTime, setDueTime] = useState((task.due_time || '').slice(0, 5))
  const [mode, setMode] = useState<string>(
    task.reminder_at ? (typeof task.reminder_minutes_before === 'number' ? String(task.reminder_minutes_before) : 'custom') : 'none'
  )
  const [customMinutes, setCustomMinutes] = useState('')
  const [exactAt, setExactAt] = useState(toLocalInput(task.reminder_at))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Start from the task as it is *now* each time the picker opens; the row
  // stays mounted across refetches, so mount-time state goes stale.
  function openPicker() {
    setDueTime((task.due_time || '').slice(0, 5))
    setMode(task.reminder_at ? (typeof task.reminder_minutes_before === 'number' ? String(task.reminder_minutes_before) : 'custom') : 'none')
    setExactAt(toLocalInput(task.reminder_at))
    setCustomMinutes('')
    setError('')
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  async function save() {
    setError('')
    const patch: ReminderPatch = {}
    if (dueTime !== (task.due_time || '').slice(0, 5)) patch.due_time = dueTime || null
    if (mode === 'none') {
      patch.reminder_minutes_before = null
      patch.reminder_at = null
    } else if (mode === 'custom') {
      if (!exactAt) { setError('Pick the date and time to be reminded.'); return }
      patch.reminder_at = new Date(exactAt).toISOString()
    } else {
      const minutes = mode === 'minutes' ? Number(customMinutes) : Number(mode)
      if (!Number.isFinite(minutes) || minutes < 0) { setError('Enter how many minutes before.'); return }
      if (!task.due_date) patch.due_date = localDateKey()
      patch.reminder_minutes_before = Math.round(minutes)
    }
    setSaving(true)
    try {
      await onSave(patch)
      // Ask once, from this click, so alarms can also show outside the tab.
      if (mode !== 'none' && 'Notification' in window && Notification.permission === 'default') void Notification.requestPermission()
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the reminder.')
    } finally {
      setSaving(false)
    }
  }

  const label = describeReminder(task)
  const Icon = task.reminder_at ? BellRing : Bell
  return (
    <div className="reminder-picker" ref={ref}>
      <button
        type="button"
        className={`reminder-trigger${task.reminder_at ? ' active' : ''}`}
        onClick={() => (open ? setOpen(false) : openPicker())}
        title={label ? `Reminder: ${label}` : 'Add a reminder'}
      >
        <Icon size={14} /> {label || 'Remind'}
      </button>
      {open && (
        <div className="reminder-popover" role="dialog" aria-label="Task reminder">
          <header>
            <strong>Bip reminder</strong>
            <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close"><X size={14} /></button>
          </header>
          <label>
            Due time
            <input type="time" value={dueTime} onChange={event => setDueTime(event.target.value)} />
          </label>
          <label>
            Remind me
            <select value={mode} onChange={event => setMode(event.target.value)}>
              <option value="none">No reminder</option>
              {REMINDER_PRESETS.map(preset => <option key={preset.minutes} value={String(preset.minutes)}>{preset.label}</option>)}
              <option value="minutes">Minutes before…</option>
              <option value="custom">At an exact time…</option>
            </select>
          </label>
          {mode === 'minutes' && (
            <label>
              Minutes before due time
              <input type="number" min={0} max={43200} value={customMinutes} onChange={event => setCustomMinutes(event.target.value)} placeholder="e.g. 3" autoFocus />
            </label>
          )}
          {mode === 'custom' && (
            <label>
              Ring at
              <input type="datetime-local" value={exactAt} onChange={event => setExactAt(event.target.value)} autoFocus />
            </label>
          )}
          {!task.due_date && mode !== 'none' && mode !== 'custom' && <small className="reminder-hint">No due date yet: today will be used.</small>}
          {error && <small className="reminder-error" role="alert">{error}</small>}
          <footer>
            {task.reminder_at && (
              <button type="button" className="reminder-clear" onClick={() => { setMode('none') }}>
                <BellOff size={13} /> Remove
              </button>
            )}
            <button type="button" className="reminder-save" disabled={saving} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </footer>
        </div>
      )}
    </div>
  )
}
