import type { Request, Response, NextFunction } from 'express'
import { chronoReference, localDateString, requestTimezone } from '../utils/timezone.js'
import * as chrono from 'chrono-node'
import { supabase } from '../supabase/client.js'
import { settings } from '../services/settings.repository.js'
import { notes } from '../services/note.repository.js'
import { complete } from '../services/ai.service.js'

export function htmlToPlainText(html: string): string {
  if (!html) return ''
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function normalizeTimePhrases(text: string): string {
  return text
    // 20h30 -> 20:30
    .replace(/\b(\d{1,2})h(\d{2})\b/gi, '$1:$2')
    // 20h -> 20:00, 18h -> 18:00
    .replace(/\b(\d{1,2})\s*h\s*(?:pm|am)?\b/gi, (_match, h) => `${h}:00 `)
}

export async function detectFromNote(req: Request, res: Response, next: NextFunction) {
  try {
    let title = typeof req.body.title === 'string' ? req.body.title : ''
    let content = typeof req.body.content === 'string' ? req.body.content : ''

    // If client didn't supply content, load and decrypt from database
    const paramId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
    if (!content.trim() && paramId) {
      try {
        const note = await notes.get(req.userId!, paramId)
        title = title || note.title || ''
        content = note.content || ''
      } catch (err) {
        return res.status(404).json({ error: 'Note not found' })
      }
    }

    const cleanContent = htmlToPlainText(content)
    const cleanText = `${title}\n\n${cleanContent}`.trim()
    if (!cleanText) {
      return res.json({ events: [], tasks: [] })
    }

    const refDate = new Date()
    const zone = requestTimezone(req)
    let events: any[] = []
    let tasks: any[] = []

    // 1. Always attempt AI extraction (works with local Ollama or cloud key)
    const model = typeof req.body.model === 'string' ? req.body.model : undefined
    const { geminiKey, ollamaKey } = await settings.getEffectiveAiKeys(req.userId!)
    const keyContext = { geminiKey, ollamaKey, userId: req.userId! }
    let aiSucceeded = false

    try {
      const todayIso = localDateString(zone, refDate)
      const prompt = `Current date is ${todayIso} (${refDate.toLocaleDateString('en-US', { weekday: 'long', timeZone: zone })}).
Current time is ${refDate.toLocaleTimeString('en-US', { hour12: false, timeZone: zone })} in ${zone}. Give event times as ISO 8601 with that zone's UTC offset.

Analyze this personal note text and extract:
1. Calendar events, meetings, workouts, appointments, or scheduled sessions.
2. Actionable to-do items, daily goals, or tasks (with due_date YYYY-MM-DD or null, and priority low/medium/high).

Note text:
"""
${cleanText.slice(0, 6000)}
"""

Reply strictly with valid JSON:
{
  "events": [
    {
      "title": "Concise event title",
      "start_time": "${todayIso}THH:MM:00",
      "end_time": null,
      "all_day": false,
      "location": ""
    }
  ],
  "tasks": [
    {
      "text": "Actionable task text",
      "due_date": "${todayIso}",
      "priority": "medium"
    }
  ]
}`

      const aiResponse = await complete(
        'You are an executive assistant extracting calendar events and tasks from personal notes. Reply only with valid JSON.',
        prompt,
        model,
        keyContext,
        'lightweight'
      )

      // Clean markdown code blocks and reasoning tags
      const cleanedJson = aiResponse
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<thought>[\s\S]*?<\/thought>/gi, '')
        .replace(/```json\s*/gi, '')
        .replace(/```\s*/gi, '')
        .trim()

      const match = cleanedJson.match(/\{[\s\S]*\}/)
      if (match) {
        const parsed = JSON.parse(match[0])
        if (Array.isArray(parsed.events)) {
          events = parsed.events.filter((e: any) => e && typeof e.title === 'string' && e.title.trim())
        }
        if (Array.isArray(parsed.tasks)) {
          tasks = parsed.tasks.filter((t: any) => t && typeof t.text === 'string' && t.text.trim())
        }
        if (events.length > 0 || tasks.length > 0) {
          aiSucceeded = true
        }
      }
    } catch (err) {
      console.warn('AI schedule detection failed, falling back to deterministic parser:', err)
    }

    // 2. Deterministic fallback if AI produced nothing
    if (!aiSucceeded || (events.length === 0 && tasks.length === 0)) {
      const normalized = normalizeTimePhrases(cleanText)
      const lines = normalized.split(/\r?\n/).map(l => l.trim()).filter(Boolean)

      for (const line of lines) {
        // Skip obvious section headers or intro lines like "what i have today:", "notes for today:", "today's tasks:"
        if (/^(what\s+i\s+have|notes?\s+for|schedule\s+for|plan\s+for|today's?\s+plan|today's?\s+tasks|today:)\b/i.test(line) && line.endsWith(':')) {
          continue
        }

        const chronoParsed = chrono.parse(line, chronoReference(zone, refDate))
        if (chronoParsed.length > 0) {
          const item = chronoParsed[0]
          // If chrono only parsed "today" or "tomorrow" on a header-like line without time or verb, skip
          const hasSpecificTime = item.start.isCertain('hour')
          const isHeaderOnly = !hasSpecificTime && line.length < 25 && /^(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday):?$/i.test(line)
          if (isHeaderOnly) continue

          const start = item.start.date()
          const end = item.end ? item.end.date() : new Date(start.getTime() + 60 * 60 * 1000)
          const allDay = !hasSpecificTime

          // Clean title by removing time expression
          let cleanTitle = line
            .replace(item.text, '')
            .replace(/\b(at|on|for|in|by|i have|have)\b/gi, ' ')
            .replace(/^[-*•]\s*/, '')
            .replace(/\s+/g, ' ')
            .trim()

          if (!cleanTitle || cleanTitle.length < 2) {
            cleanTitle = line.replace(/^[-*•]\s*/, '').trim()
          }

          events.push({
            title: cleanTitle.charAt(0).toUpperCase() + cleanTitle.slice(1),
            start_time: start.toISOString(),
            end_time: end.toISOString(),
            all_day: allDay,
            location: ''
          })
        } else {
          // If no specific time was parsed, check if line looks like an action item or goal
          const isTaskLike =
            /^[-*•]\s*/.test(line) ||
            /^(i want to|want to|going to|going back to|plan to|planning to|need to|have to|must|finish|complete|call|email|buy|review|do|doing)\b/i.test(line)

          if (isTaskLike) {
            let cleanTask = line
              .replace(/^[-*•]\s*(\[[ x]\])?\s*/i, '')
              .replace(/^(i want to|want to|going back to|going to|plan to|planning to|need to|have to)\s+/i, '')
              .replace(/\s+/g, ' ')
              .trim()

            if (cleanTask.length > 2) {
              tasks.push({
                text: cleanTask.charAt(0).toUpperCase() + cleanTask.slice(1),
                due_date: localDateString(zone, refDate),
                priority: 'medium'
              })
            }
          }
        }
      }
    }

    res.json({ events, tasks })
  } catch (error) {
    next(error)
  }
}

export async function applyDetections(req: Request, res: Response, next: NextFunction) {
  try {
    const paramId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
    const requestedNoteId = paramId || req.body.note_id || null
    // Only link to the caller's own server-side note. Secure-vault notes live
    // in vault_records, so linking them broke the events/tasks foreign key.
    let noteId: string | null = null
    if (typeof requestedNoteId === 'string' && /^[0-9a-f-]{36}$/i.test(requestedNoteId)) {
      const { data: owned } = await supabase.from('notes').select('id').eq('id', requestedNoteId).eq('user_id', req.userId!).maybeSingle()
      noteId = owned?.id ?? null
    }
    const events = Array.isArray(req.body.events) ? req.body.events : []
    const tasks = Array.isArray(req.body.tasks) ? req.body.tasks : []

    let addedEvents = 0
    let addedTasks = 0

    if (events.length > 0) {
      const eventsPayload = events.map((e: any) => {
        let startTimeStr = new Date().toISOString()
        if (e.start_time) {
          const d = new Date(e.start_time)
          if (!isNaN(d.getTime())) startTimeStr = d.toISOString()
        }
        let endTimeStr: string | null = null
        if (e.end_time) {
          const d = new Date(e.end_time)
          if (!isNaN(d.getTime())) endTimeStr = d.toISOString()
        }

        return {
          user_id: req.userId!,
          note_id: noteId,
          title: String(e.title || 'Scheduled Event').slice(0, 150),
          description: e.description || '',
          start_time: startTimeStr,
          end_time: endTimeStr,
          all_day: Boolean(e.all_day),
          location: e.location || ''
        }
      })

      const { data, error } = await supabase.from('events').insert(eventsPayload).select('id')
      if (error) throw error
      addedEvents = data ? data.length : events.length
    }

    if (tasks.length > 0) {
      const tasksPayload = tasks.map((t: any) => {
        let dueDate: string | null = null
        if (t.due_date) {
          const s = String(t.due_date).trim()
          dueDate = s.length >= 10 ? s.slice(0, 10) : s
        }
        const priority = ['low', 'medium', 'high'].includes(String(t.priority).toLowerCase())
          ? String(t.priority).toLowerCase()
          : 'medium'

        return {
          user_id: req.userId!,
          note_id: noteId,
          text: String(t.text || 'Action item').slice(0, 300),
          due_date: dueDate,
          due_time: t.due_time || null,
          priority,
          completed: false
        }
      })

      const { data, error } = await supabase.from('tasks').insert(tasksPayload).select('id')
      if (error) throw error
      addedTasks = data ? data.length : tasks.length
    }

    res.json({
      success: true,
      addedEvents,
      addedTasks
    })
  } catch (error) {
    next(error)
  }
}
