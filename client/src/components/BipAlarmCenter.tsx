import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlarmClock, Check, X } from 'lucide-react'
import { api } from '../services/api'
import { robotAudio } from '../services/robot-audio.service'
import { countdownLabel, dueMoment } from '../services/reminders'
import { BipFigure } from './RobotCompanion/BipFigure'
import type { Task } from '../types'

const FIRED_KEY = 'muse-fired-reminders'
const MISSED_WINDOW_MS = 15 * 60_000 // ring for reminders missed while the tab was closed, if recent
const ALARM_MAX_MS = 2 * 60_000 // stop the sound after 2 minutes; the card stays
const BIP_LINES = [
  'Beep boop! Time to get this done ✨',
  'Bzzt! Your reminder is here 🤖',
  'Ding ding! Bip is on duty ⏰',
  "Psst… don't forget this one! 💜"
]

const reminderKey = (task: Task) => `${task.id}@${task.reminder_at}`

function readFired(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(FIRED_KEY) || '{}') } catch { return {} }
}

function markFired(key: string) {
  try {
    const fired = readFired()
    fired[key] = Date.now()
    const cutoff = Date.now() - 7 * 24 * 3600_000
    for (const [k, at] of Object.entries(fired)) if (at < cutoff) delete fired[k]
    localStorage.setItem(FIRED_KEY, JSON.stringify(fired))
  } catch { /* storage unavailable: the alarm may ring again after reload */ }
}

/**
 * Watches task reminders while Muse is open and rings with Bip: an animated
 * card with a live countdown, an alarm sound loop, and a system notification
 * so it is noticed from another tab.
 */
export function BipAlarmCenter() {
  const queryClient = useQueryClient()
  const { data: tasks = [] } = useQuery({ queryKey: ['all-tasks'], queryFn: () => api.listTasks(), refetchInterval: 60_000 })
  const [ringing, setRinging] = useState<Task[]>([])
  const [now, setNow] = useState(Date.now())
  const timer = useRef<number | null>(null)
  const soundTimer = useRef<number | null>(null)
  const soundStarted = useRef(0)

  // Schedule the next reminder precisely; re-check at least every minute.
  useEffect(() => {
    const check = () => {
      const current = Date.now()
      const fired = readFired()
      const due = tasks.filter(task => task.reminder_at && !task.completed && !fired[reminderKey(task)]
        && new Date(task.reminder_at).getTime() <= current + 500
        && new Date(task.reminder_at).getTime() > current - MISSED_WINDOW_MS)
      if (due.length) {
        for (const task of due) {
          markFired(reminderKey(task))
          notify(task)
        }
        setRinging(prev => [...prev.filter(r => !due.some(d => d.id === r.id)), ...due])
      }
      const next = tasks
        .filter(task => task.reminder_at && !task.completed && !readFired()[reminderKey(task)])
        .map(task => new Date(task.reminder_at!).getTime())
        .filter(at => at > current)
        .sort((a, b) => a - b)[0]
      timer.current = window.setTimeout(check, next ? Math.min(Math.max(next - current, 250), 60_000) : 60_000)
    }
    check()
    return () => { if (timer.current) window.clearTimeout(timer.current) }
  }, [tasks])

  // Alarm sound + countdown while anything is ringing.
  useEffect(() => {
    if (!ringing.length) return
    soundStarted.current = Date.now()
    robotAudio.alarmBurst()
    soundTimer.current = window.setInterval(() => {
      setNow(Date.now())
      if (Date.now() - soundStarted.current < ALARM_MAX_MS && Math.floor((Date.now() - soundStarted.current) / 1000) % 2 === 0) robotAudio.alarmBurst()
    }, 1000)
    const title = document.title
    document.title = `⏰ ${ringing[0].text}`
    return () => {
      if (soundTimer.current) window.clearInterval(soundTimer.current)
      document.title = title
    }
  }, [ringing.length])

  function notify(task: Task) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return
    try {
      const notification = new Notification(`Bip ⏰ ${task.text}`, {
        body: `${BIP_LINES[task.text.length % BIP_LINES.length]} · ${countdownLabel(dueMoment(task))}`,
        tag: task.id,
        requireInteraction: true
      })
      notification.onclick = () => { window.focus(); notification.close() }
    } catch { /* some browsers only allow notifications from a service worker */ }
  }

  const dismiss = (id: string) => setRinging(prev => prev.filter(task => task.id !== id))

  async function complete(task: Task) {
    dismiss(task.id)
    await api.updateTask(task.id, { completed: true }).catch(() => {})
    void queryClient.invalidateQueries({ queryKey: ['all-tasks'] })
    robotAudio.play('success')
  }

  async function snooze(task: Task, minutes: number) {
    dismiss(task.id)
    // Stored on the server, so the phone sees the new time too.
    await api.updateTask(task.id, { reminder_at: new Date(Date.now() + minutes * 60_000).toISOString() } as Partial<Task>).catch(() => {})
    void queryClient.invalidateQueries({ queryKey: ['all-tasks'] })
  }

  if (!ringing.length) return null
  return (
    <div className="bip-alarm-backdrop" role="alertdialog" aria-live="assertive" aria-label="Task reminder">
      {ringing.map(task => (
        <div key={task.id} className="bip-alarm-card">
          <div className="bip-alarm-figure"><BipFigure mood="excited" size={92} isSpeaking /></div>
          <span className="bip-alarm-kicker"><AlarmClock size={14} /> Reminder</span>
          <h2>{task.text}</h2>
          <p className="bip-alarm-line">{BIP_LINES[task.text.length % BIP_LINES.length]}</p>
          <div className="bip-alarm-countdown">{countdownLabel(dueMoment(task), now)}</div>
          <div className="bip-alarm-actions">
            <button type="button" className="bip-alarm-done" onClick={() => void complete(task)}><Check size={16} /> Done</button>
            <button type="button" onClick={() => void snooze(task, 5)}>Snooze 5 min</button>
            <button type="button" onClick={() => void snooze(task, 15)}>15 min</button>
            <button type="button" className="bip-alarm-dismiss" onClick={() => dismiss(task.id)} aria-label="Dismiss"><X size={16} /></button>
          </div>
        </div>
      ))}
    </div>
  )
}
