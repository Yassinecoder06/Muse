import type { Task } from '../types'

// Shared helpers for task reminders (picker labels, alarm timing).

export const REMINDER_PRESETS: { label: string; minutes: number }[] = [
  { label: 'At due time', minutes: 0 },
  { label: '1 min before', minutes: 1 },
  { label: '2 min before', minutes: 2 },
  { label: '5 min before', minutes: 5 },
  { label: '10 min before', minutes: 10 },
  { label: '15 min before', minutes: 15 },
  { label: '30 min before', minutes: 30 },
  { label: '1 hour before', minutes: 60 },
  { label: '2 hours before', minutes: 120 },
  { label: '1 day before', minutes: 1440 }
]

export function describeMinutes(minutes: number) {
  if (minutes === 0) return 'At due time'
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? '' : 's'} before`
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? '' : 's'} before`
  return `${minutes} min before`
}

export function describeReminder(task: Pick<Task, 'reminder_at' | 'reminder_minutes_before'>) {
  if (!task.reminder_at) return null
  if (typeof task.reminder_minutes_before === 'number') return describeMinutes(task.reminder_minutes_before)
  return new Date(task.reminder_at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
}

/** The task's due moment in local time (09:00 for date-only tasks). */
export function dueMoment(task: Pick<Task, 'due_date' | 'due_time'>) {
  if (!task.due_date) return null
  const [hour, minute] = (task.due_time || '09:00').split(':').map(Number)
  const [year, month, day] = task.due_date.split('-').map(Number)
  return new Date(year, month - 1, day, hour || 0, minute || 0)
}

/** "Due in 01:58", "Due now", "Overdue by 3 min". */
export function countdownLabel(due: Date | null, now = Date.now()) {
  if (!due) return 'Reminder'
  const diff = Math.round((due.getTime() - now) / 1000)
  if (Math.abs(diff) < 30) return 'Due now'
  const abs = Math.abs(diff)
  const hours = Math.floor(abs / 3600)
  const minutes = Math.floor((abs % 3600) / 60)
  const seconds = abs % 60
  const clock = hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  return diff > 0 ? `Due in ${clock}` : `Overdue by ${clock}`
}

/** "YYYY-MM-DD" for a Date in local time (toISOString would use UTC). */
export function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
