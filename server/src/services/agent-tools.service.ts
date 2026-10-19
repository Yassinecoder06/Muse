import * as chrono from 'chrono-node'
import { supabase } from '../supabase/client.js'
import { notes } from './note.repository.js'
import { vectors } from './vector.service.js'
import { templates } from './template.repository.js'
import { normalizeTimePhrases } from '../controllers/detection.controller.js'
import { stripImages } from '../utils/images.js'
import { createConfirmationToken } from './agent-confirmation.service.js'
import { chronoReference, localDateString, normalizeClock, offsetMinutes } from '../utils/timezone.js'
import { resolveReminder } from '../controllers/tasks.controller.js'

export interface AgentActionCard {
  type: 'note' | 'note_updated' | 'task' | 'task_updated' | 'event' | 'memory' | 'template' | 'specialized_note' | 'item_deleted' | 'confirm_required'
  id?: string
  title?: string
  contentSnippet?: string
  tags?: string[]
  text?: string
  completed?: boolean
  dueDate?: string | null
  priority?: string
  startTime?: string
  endTime?: string | null
  location?: string
  fact?: string
  category?: string
  itemType?: string
  status?: string
  data: Record<string, unknown>
}

export interface ToolExecutionResult {
  toolName: string
  args: Record<string, unknown>
  result: Record<string, unknown>
  actionCard?: AgentActionCard
  error?: string
}

// Declarations in standard JSON schema format compatible with both Google GenAI & Ollama
export const agentToolDeclarations = [
  {
    name: 'create_note',
    description: 'Create a new note in Muse with a title and Markdown content. Can include topic tags.',
    parameters: {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING', description: 'The title of the note' },
        content: { type: 'STRING', description: 'The note content written in Markdown' },
        tags: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'Optional list of lowercase tags (e.g. ["project", "meeting", "ideas"])'
        }
      },
      required: ['title', 'content']
    }
  },
  {
    name: 'update_note',
    description: 'Update an existing note title or replace/append to its content.',
    parameters: {
      type: 'OBJECT',
      properties: {
        id: { type: 'STRING', description: 'The UUID of the note to update' },
        title: { type: 'STRING', description: 'Updated title (optional)' },
        content: { type: 'STRING', description: 'New content to replace existing content (optional)' },
        append_content: { type: 'STRING', description: 'Text to append to the end of the note (optional)' }
      },
      required: ['id']
    }
  },
  {
    name: 'search_notes',
    description: 'Search the user\'s notes by keywords, concepts, or queries.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: 'The search term or question to find relevant notes' }
      },
      required: ['query']
    }
  },
  {
    name: 'create_task',
    description: 'Create an actionable task item with optional due date, time, and priority.',
    parameters: {
      type: 'OBJECT',
      properties: {
        text: { type: 'STRING', description: 'The task description (e.g. "Prepare slides for team sync")' },
        due_date: {
          type: 'STRING',
          description: 'Due date in YYYY-MM-DD format (or natural terms like "tomorrow", "next Monday")'
        },
        due_time: { type: 'STRING', description: 'Optional time string e.g. "15:00" or "3:00 PM"' },
        priority: {
          type: 'STRING',
          enum: ['low', 'medium', 'high'],
          description: 'Task priority level'
        },
        note_id: { type: 'STRING', description: 'Optional associated note UUID' },
        remind_minutes_before: { type: 'NUMBER', description: 'Alert this many minutes before the due time (0 = at the due time). Needs a due date.' },
        remind_at: { type: 'STRING', description: 'Exact alert time instead, e.g. "today at 7:45pm" or an ISO datetime' },
      },
      required: ['text']
    }
  },
  {
    name: 'list_tasks',
    description: 'List user tasks, optionally filtering by completion status or specific due date.',
    parameters: {
      type: 'OBJECT',
      properties: {
        due_date: { type: 'STRING', description: 'Optional date YYYY-MM-DD to filter tasks' },
        completed: { type: 'BOOLEAN', description: 'Optional filter for completed (true) or open (false) tasks' }
      }
    }
  },
  {
    name: 'update_task',
    description: 'Update a task: text, completion, due date/time, or its reminder (set remind_minutes_before to -1 to remove the reminder).',
    parameters: {
      type: 'OBJECT',
      properties: {
        id: { type: 'STRING', description: 'The UUID of the task' },
        completed: { type: 'BOOLEAN', description: 'Set true to complete, false to uncomplete' },
        text: { type: 'STRING', description: 'Updated task description (optional)' },
        due_date: { type: 'STRING', description: 'New due date (YYYY-MM-DD or natural, e.g. "tomorrow")' },
        due_time: { type: 'STRING', description: 'New due time, e.g. "15:00"' },
        remind_minutes_before: { type: 'NUMBER', description: 'Alert this many minutes before the due time (0 = at the due time). Needs a due date.' },
        remind_at: { type: 'STRING', description: 'Exact alert time instead, e.g. "today at 7:45pm" or an ISO datetime' },
      },
      required: ['id']
    }
  },
  {
    name: 'create_calendar_event',
    description: 'Schedule a calendar event with a date, start time, optional end time, location, and description.',
    parameters: {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING', description: 'Title or summary of the event (e.g. "Meeting with Alex")' },
        start_time: {
          type: 'STRING',
          description: 'ISO 8601 datetime (e.g. "2026-10-19T14:00:00Z") or natural language phrase (e.g. "tomorrow at 2pm", "Friday at 10am")'
        },
        end_time: {
          type: 'STRING',
          description: 'Optional ISO 8601 end datetime (e.g. "2026-10-19T15:00:00Z") or duration'
        },
        all_day: { type: 'BOOLEAN', description: 'Whether this is an all-day event' },
        location: { type: 'STRING', description: 'Optional location or video call link' },
        description: { type: 'STRING', description: 'Optional description or agenda details' }
      },
      required: ['title', 'start_time']
    }
  },
  {
    name: 'list_calendar_events',
    description: 'Retrieve calendar events between specified date ranges (or upcoming events).',
    parameters: {
      type: 'OBJECT',
      properties: {
        from: { type: 'STRING', description: 'Start datetime ISO string' },
        to: { type: 'STRING', description: 'End datetime ISO string' }
      }
    }
  },
  {
    name: 'save_memory',
    description: 'Remember a lasting fact, preference, or goal about the user across conversations.',
    parameters: {
      type: 'OBJECT',
      properties: {
        fact: {
          type: 'STRING',
          description: 'The fact or preference to remember (e.g. "User prefers bullet-point summaries", "User is launching Muse v2 in Q4")'
        },
        category: {
          type: 'STRING',
          enum: ['preference', 'project', 'personal', 'goal', 'general'],
          description: 'The memory category'
        }
      },
      required: ['fact']
    }
  },
  {
    name: 'get_memories',
    description: 'Retrieve stored facts and preferences about the user.',
    parameters: {
      type: 'OBJECT',
      properties: {
        category: { type: 'STRING', description: 'Optional category filter' }
      }
    }
  },
  {
    name: 'list_specialized_templates',
    description: 'List all available specialized note templates (including built-in: workout, daily, finance, and user custom templates). Use this to see existing templates before determining if a specialized template exists.',
    parameters: {
      type: 'OBJECT',
      properties: {}
    }
  },
  {
    name: 'create_specialized_template',
    description: 'Create and save a new specialized note template for future reuse. ONLY call this when the user explicitly instructs you to create/save a template (e.g. "create a template for recipes", "make a specialized template for meeting notes", "save a template for next time"). Do NOT call this automatically if the user simply asked for a note on an unsupported topic.',
    parameters: {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING', description: 'Name of the template (e.g. "Book Review", "Recipe Tracker", "Meeting Notes")' },
        description: { type: 'STRING', description: 'Brief description of what this template is for' },
        fields: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              name: { type: 'STRING', description: 'Name of the field' },
              defaultValue: { type: 'STRING', description: 'Optional default value' }
            },
            required: ['name']
          },
          description: 'List of fields for this template'
        },
        ai_instruction: { type: 'STRING', description: 'Optional AI prompt guidance for this template' },
        color: {
          type: 'STRING',
          enum: ['blue', 'purple', 'emerald', 'amber', 'rose', 'teal', 'indigo'],
          description: 'Color accent for the template'
        },
        sync_with_calendar: {
          type: 'BOOLEAN',
          description: 'Optional flag: whether notes created with this template should sync with the calendar (default false)'
        }
      },
      required: ['title', 'fields']
    }
  },
  {
    name: 'create_specialized_note',
    description: 'Create a specialized structured note using an existing template (e.g. "workout", "daily", "finance", or any user custom template title). Use this when the user requests a specialized note that matches an existing template.',
    parameters: {
      type: 'OBJECT',
      properties: {
        template_name: {
          type: 'STRING',
          description: 'Name or category of the template to use (e.g. "workout", "daily", "finance", or custom template name like "Book Review")'
        },
        title: { type: 'STRING', description: 'Title of the specialized note' },
        fields: {
          type: 'OBJECT',
          description: 'Key-value pairs matching the template fields (e.g. {"date": "2026-10-19", "name": "Leg Day"} or {"Author": "Orwell", "Rating": "5/5"})'
        },
        content: { type: 'STRING', description: 'Optional rich markdown body content for the note' },
        tags: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'Optional list of lowercase tags'
        },
        sync_with_calendar: {
          type: 'BOOLEAN',
          description: 'Optional flag: whether this specialized note should sync to the calendar (defaults to the template setting)'
        }
      },
      required: ['template_name', 'title']
    }
  },
  {
    name: 'trash_note',
    description: 'Move a note to trash (soft delete). Can find the note by id or by searching its title/keywords. Use this whenever the user asks to delete or trash a note.',
    parameters: {
      type: 'OBJECT',
      properties: {
        id: { type: 'STRING', description: 'The UUID of the note to move to trash (optional if title_query is provided)' },
        title_query: { type: 'STRING', description: 'Title or search keywords to find the note to move to trash (e.g. "Meeting Notes", "Gym Workout")' }
      }
    }
  },
  {
    name: 'permanently_delete_note',
    description: 'Permanently and irreversibly delete a note from Muse (cannot be restored from trash). Can find the note by id or by searching its title.',
    parameters: {
      type: 'OBJECT',
      properties: {
        id: { type: 'STRING', description: 'The UUID of the note to permanently delete (optional if title_query is provided)' },
        title_query: { type: 'STRING', description: 'Title or search query to find the note to permanently delete' }
      }
    }
  },
  {
    name: 'empty_trash',
    description: 'Permanently delete all notes currently in the trash bin.',
    parameters: {
      type: 'OBJECT',
      properties: {}
    }
  },
  {
    name: 'delete_task',
    description: 'Delete a task from the user\'s tasks list. Can find the task by id or by matching its text description.',
    parameters: {
      type: 'OBJECT',
      properties: {
        id: { type: 'STRING', description: 'The UUID of the task to delete (optional if text_query is provided)' },
        text_query: { type: 'STRING', description: 'Task text keywords to find and delete (e.g. "buy milk", "slides")' }
      }
    }
  },
  {
    name: 'delete_calendar_event',
    description: 'Delete or cancel a calendar event. Can find the event by id or by searching its title or date.',
    parameters: {
      type: 'OBJECT',
      properties: {
        id: { type: 'STRING', description: 'The UUID of the event to delete (optional if title_query is provided)' },
        title_query: { type: 'STRING', description: 'Event title or keywords to find and delete (e.g. "Doctor", "Sync with team")' }
      }
    }
  },
  {
    name: 'delete_memory',
    description: 'Delete a remembered fact or preference about the user (makes the assistant forget it). Can find the memory by id or by searching its content.',
    parameters: {
      type: 'OBJECT',
      properties: {
        id: { type: 'STRING', description: 'The UUID of the memory to delete (optional if fact_query is provided)' },
        fact_query: { type: 'STRING', description: 'Keywords from the fact to forget (e.g. "vegan", "coffee", "night owl")' }
      }
    }
  },
  {
    name: 'delete_specialized_template',
    description: 'Delete a user-created custom specialized note template. Built-in templates (workout, daily, finance) cannot be deleted.',
    parameters: {
      type: 'OBJECT',
      properties: {
        id: { type: 'STRING', description: 'The UUID of the custom template to delete (optional if title is provided)' },
        title: { type: 'STRING', description: 'Name of the custom template to delete (e.g. "Book Review", "Recipe Tracker")' }
      }
    }
  },
  {
    name: 'delete_chat_session',
    description: 'Delete a chat conversation session and its history.',
    parameters: {
      type: 'OBJECT',
      properties: {
        id: { type: 'STRING', description: 'The UUID of the session to delete (optional if title_query is provided)' },
        title_query: { type: 'STRING', description: 'Title or keywords of the chat session to delete' }
      }
    }
  }
]

// Resolve natural or ISO dates into reliable ISO strings
// Dates are resolved in the user's timezone, not the server's (UTC in Docker).
function resolveDateTime(input: string, zone: string, refDate = new Date()): { date: Date | null; isAllDay: boolean } {
  if (!input) return { date: null, isAllDay: false }

  // ISO first. A wall-clock ISO without Z/offset ("2026-10-19T14:00") means
  // that time where the user is.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(input)) {
    const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(input)
    const parsed = hasZone ? new Date(input) : new Date(Date.parse(`${input}Z`) - offsetMinutes(zone, refDate) * 60_000)
    if (!isNaN(parsed.getTime())) return { date: parsed, isAllDay: false }
  }
  const parsedDirect = new Date(input)

  // Parse using chrono-node
  const normalized = normalizeTimePhrases(input)
  const parsedResults = chrono.parse(normalized, chronoReference(zone, refDate))
  if (parsedResults.length > 0) {
    const first = parsedResults[0]
    const hasCertainHour = first.start.isCertain('hour')
    const date = first.start.date()
    return { date, isAllDay: !hasCertainHour }
  }

  if (!isNaN(parsedDirect.getTime())) {
    return { date: parsedDirect, isAllDay: !input.includes(':') }
  }

  return { date: null, isAllDay: false }
}

function resolveDueDate(input: string | undefined, zone: string): string | null {
  if (!input) return null
  const match = input.match(/^\d{4}-\d{2}-\d{2}$/)
  if (match) return input

  const parsed = chrono.parseDate(normalizeTimePhrases(input), chronoReference(zone))
  return parsed ? localDateString(zone, parsed) : null
}

// Irreversible tools. The model can only propose these; the user confirms on
// the action card (POST /api/agent/confirm), which re-runs the tool with
// `confirmed: true` and the exact id that was shown. trash_note stays direct
// because a trashed note can be restored.
export const CONFIRMATION_REQUIRED_TOOLS = new Set([
  'permanently_delete_note', 'empty_trash', 'delete_task', 'delete_calendar_event',
  'delete_memory', 'delete_specialized_template', 'delete_chat_session'
])

// Finds the one note a title phrase refers to. Exact title wins; otherwise a
// substring match is used only when it is unambiguous. Never falls back to
// "closest embedding", which always returns *something* and trashed the wrong
// note.
export function matchNoteByTitle<T extends { id: string; title: string }>(candidates: T[], rawQuery: string): { match?: T; ambiguous?: T[] } {
  const query = rawQuery.trim().toLowerCase()
  if (!query) return {}
  const exact = candidates.filter(note => note.title.trim().toLowerCase() === query)
  if (exact.length === 1) return { match: exact[0] }
  const partial = exact.length > 1 ? exact : candidates.filter(note => note.title.toLowerCase().includes(query))
  if (partial.length === 1) return { match: partial[0] }
  if (partial.length > 1) return { ambiguous: partial.slice(0, 8) }
  return {}
}

function ambiguityResult(name: string, args: Record<string, any>, matches: { id: string; title: string }[]): ToolExecutionResult {
  return {
    toolName: name,
    args,
    result: {
      ambiguous: true,
      message: 'Several notes match. Ask the user which one they mean, then call the tool again with its id.',
      candidates: matches.map(note => ({ id: note.id, title: note.title }))
    }
  }
}

// Turns Bip's reminder arguments into the API's reminder fields.
function reminderArgs(args: Record<string, any>, zone: string): { reminder_minutes_before?: number | null; reminder_at?: string | null } {
  if (typeof args.remind_minutes_before === 'number') {
    return { reminder_minutes_before: args.remind_minutes_before < 0 ? null : Math.round(args.remind_minutes_before) }
  }
  if (typeof args.remind_at === 'string' && args.remind_at.trim()) {
    const { date } = resolveDateTime(args.remind_at, zone)
    if (!date) throw new Error(`Could not understand the reminder time "${args.remind_at}".`)
    return { reminder_at: date.toISOString() }
  }
  return {}
}

function confirmationRequest(
  userId: string,
  name: string,
  args: Record<string, any>,
  target: { id?: string; title: string; itemType: string; status: string }
): ToolExecutionResult {
  const token = createConfirmationToken(userId, name, target.id ? { id: target.id } : {})
  return {
    toolName: name,
    args,
    result: {
      requires_confirmation: true,
      message: `Nothing was deleted yet. The user must press Confirm on the card to ${target.status.toLowerCase()} "${target.title}". Tell them that, and do not say it was deleted.`
    },
    actionCard: {
      type: 'confirm_required',
      id: target.id,
      title: target.title,
      itemType: target.itemType,
      status: target.status,
      data: { token, tool: name, id: target.id, title: target.title, itemType: target.itemType, status: target.status }
    }
  }
}

export async function executeAgentTool(
  userId: string,
  name: string,
  args: Record<string, any>,
  options: { confirmed?: boolean; timezone?: string } = {}
): Promise<ToolExecutionResult> {
  const zone = options.timezone || 'UTC'
  const today = localDateString(zone)
  try {
    switch (name) {
      case 'create_note': {
        let title = String(args.title || '').trim()
        const content = String(args.content || '')
        const tags = Array.isArray(args.tags) ? args.tags.map(String) : []

        if (!title || title.toLowerCase() === 'untitled note' || title.toLowerCase() === 'untitled') {
          const headerMatch = content.match(/^\s*#\s+([^\n#]+)/)
          if (headerMatch) {
            title = headerMatch[1].replace(/[*_`]/g, '').trim()
          } else {
            title = 'Untitled Note'
          }
        }
        const created = await notes.create(userId, { title, content, tags }, 'note')
        try {
          await vectors.upsertVector(created)
        } catch (err) {
          console.warn('[AgentTools] Note vector indexing failed (continuing):', err)
        }
        return {
          toolName: name,
          args,
          result: { success: true, id: created.id, title: created.title },
          actionCard: {
            type: 'note',
            id: created.id,
            title: created.title,
            contentSnippet: stripImages(created.content).slice(0, 160),
            tags: created.tags,
            data: {
              id: created.id,
              title: created.title,
              snippet: stripImages(created.content).slice(0, 160),
              tags: created.tags
            }
          }
        }
      }

      case 'update_note': {
        const id = String(args.id)
        const current = await notes.get(userId, id)
        let updatedContent = current.content
        if (typeof args.content === 'string') {
          updatedContent = args.content
        } else if (typeof args.append_content === 'string') {
          updatedContent = `${current.content}\n\n${args.append_content}`
        }
        const updated = await notes.update(userId, id, {
          title: typeof args.title === 'string' ? args.title : current.title,
          content: updatedContent
        })
        try {
          await vectors.upsertVector(updated)
        } catch {}
        return {
          toolName: name,
          args,
          result: { success: true, id: updated.id, title: updated.title },
          actionCard: {
            type: 'note_updated',
            id: updated.id,
            title: updated.title,
            contentSnippet: stripImages(updated.content).slice(0, 160),
            tags: updated.tags,
            data: { id: updated.id, title: updated.title }
          }
        }
      }

      case 'search_notes': {
        const query = String(args.query || '').trim()
        const ids = await vectors.searchSimilarNotes(userId, query)
        const found = (await Promise.all(ids.map(id => notes.get(userId, id).catch(() => null))))
          .filter(note => note && !note.deleted_at)
          .slice(0, 5)
        const snippets = found.map((n: any) => ({
          id: n.id,
          title: n.title,
          snippet: stripImages(n.content).slice(0, 200)
        }))
        return {
          toolName: name,
          args,
          result: { count: snippets.length, notes: snippets }
        }
      }

      case 'create_task': {
        const text = String(args.text || '').trim()
        if (!text) throw new Error('Task text cannot be empty')
        const dueDate = resolveDueDate(args.due_date, zone)
        // Store "3pm" as "15:00" so reminders compute from the right time.
        const dueTime = typeof args.due_time === 'string' ? normalizeClock(args.due_time) : null
        const priority = ['low', 'medium', 'high'].includes(args.priority) ? args.priority : 'medium'
        let noteId: string | null = null
        if (args.note_id) {
          const linked = await notes.get(userId, String(args.note_id)).catch(() => null)
          if (!linked) throw new Error('That note does not exist, so the task was not linked to it.')
          noteId = linked.id
        }

        const { data, error } = await supabase
          .from('tasks')
          .insert({
            user_id: userId,
            text,
            completed: false,
            due_date: dueDate,
            due_time: dueTime,
            priority,
            note_id: noteId,
            ...resolveReminder({ due_date: dueDate, due_time: dueTime, ...reminderArgs(args, zone) }, null, zone)
          })
          .select()
          .single()

        if (error) throw error
        return {
          toolName: name,
          args,
          result: { success: true, task: data },
          actionCard: {
            type: 'task',
            id: data.id,
            text: data.text,
            completed: data.completed,
            dueDate: data.due_date,
            priority: data.priority,
            data: data
          }
        }
      }

      case 'list_tasks': {
        let q = supabase.from('tasks').select('*').eq('user_id', userId).order('created_at', { ascending: false })
        if (typeof args.due_date === 'string') {
          const parsed = resolveDueDate(args.due_date, zone)
          if (parsed) q = q.eq('due_date', parsed)
        }
        if (typeof args.completed === 'boolean') {
          q = q.eq('completed', args.completed)
        }
        const { data, error } = await q.limit(20)
        if (error) throw error
        return {
          toolName: name,
          args,
          result: { tasks: data || [] }
        }
      }

      case 'update_task': {
        const id = String(args.id)
        const patch: Record<string, any> = {}
        if (typeof args.completed === 'boolean') patch.completed = args.completed
        if (typeof args.text === 'string') patch.text = args.text
        if (typeof args.due_date === 'string' && args.due_date.trim()) {
          const dueDate = resolveDueDate(args.due_date, zone)
          if (!dueDate) throw new Error(`Could not understand the date "${args.due_date}". Nothing was changed.`)
          patch.due_date = dueDate
        }
        if (typeof args.due_time === 'string' && args.due_time.trim()) {
          const dueTime = normalizeClock(args.due_time)
          if (!dueTime) throw new Error(`Could not understand the time "${args.due_time}". Nothing was changed.`)
          patch.due_time = dueTime
        }
        const reminder = reminderArgs(args, zone)
        if (Object.keys(reminder).length || patch.due_date !== undefined || patch.due_time !== undefined) {
          const { data: current } = await supabase.from('tasks').select('due_date, due_time, reminder_minutes_before, reminder_at').eq('id', id).eq('user_id', userId).maybeSingle()
          if (!current) throw new Error('Task not found.')
          Object.assign(patch, resolveReminder({ ...patch, ...reminder }, current, zone))
        }

        const { data, error } = await supabase
          .from('tasks')
          .update(patch)
          .eq('id', id)
          .eq('user_id', userId)
          .select()
          .single()

        if (error) throw error
        return {
          toolName: name,
          args,
          result: { success: true, task: data },
          actionCard: {
            type: 'task_updated',
            id: data.id,
            text: data.text,
            completed: data.completed,
            dueDate: data.due_date,
            priority: data.priority,
            data: data
          }
        }
      }

      case 'create_calendar_event': {
        const title = String(args.title || 'Untitled Event').trim()
        const startRaw = String(args.start_time || '')
        const { date: startDate, isAllDay } = resolveDateTime(startRaw, zone)
        if (!startDate) throw new Error(`Could not parse event start time from: "${startRaw}"`)

        let endDate: Date | null = null
        if (args.end_time) {
          const parsedEnd = resolveDateTime(String(args.end_time), zone, startDate)
          endDate = parsedEnd.date
        } else if (!isAllDay) {
          // Default 1 hour duration
          endDate = new Date(startDate.getTime() + 60 * 60 * 1000)
        }

        const allDay = typeof args.all_day === 'boolean' ? args.all_day : isAllDay
        const location = typeof args.location === 'string' ? args.location : ''
        const description = typeof args.description === 'string' ? args.description : ''

        const { data, error } = await supabase
          .from('events')
          .insert({
            user_id: userId,
            title,
            start_time: startDate.toISOString(),
            end_time: endDate ? endDate.toISOString() : null,
            all_day: allDay,
            location,
            description
          })
          .select()
          .single()

        if (error) throw error
        return {
          toolName: name,
          args,
          result: { success: true, event: data },
          actionCard: {
            type: 'event',
            id: data.id,
            title: data.title,
            startTime: data.start_time,
            endTime: data.end_time,
            location: data.location,
            data: data
          }
        }
      }

      case 'list_calendar_events': {
        let q = supabase.from('events').select('*').eq('user_id', userId).order('start_time', { ascending: true })
        if (args.from) {
          const { date } = resolveDateTime(String(args.from), zone)
          if (date) q = q.gte('start_time', date.toISOString())
        }
        if (args.to) {
          const { date } = resolveDateTime(String(args.to), zone)
          if (date) q = q.lte('start_time', date.toISOString())
        }
        const { data, error } = await q.limit(20)
        if (error) throw error
        return {
          toolName: name,
          args,
          result: { events: data || [] }
        }
      }

      case 'save_memory': {
        const fact = String(args.fact || '').trim()
        if (!fact) throw new Error('Memory fact cannot be empty')
        const category = ['preference', 'project', 'personal', 'goal', 'general'].includes(args.category)
          ? args.category
          : 'general'

        const { data, error } = await supabase
          .from('user_memories')
          .insert({
            user_id: userId,
            fact,
            category
          })
          .select()
          .single()

        if (error) throw error
        return {
          toolName: name,
          args,
          result: { success: true, memory: data },
          actionCard: {
            type: 'memory',
            id: data.id,
            fact: data.fact,
            category: data.category,
            data: data
          }
        }
      }

      case 'get_memories': {
        let q = supabase.from('user_memories').select('*').eq('user_id', userId).order('updated_at', { ascending: false })
        if (typeof args.category === 'string') {
          q = q.eq('category', args.category)
        }
        const { data, error } = await q.limit(30)
        if (error) throw error
        return {
          toolName: name,
          args,
          result: { memories: data || [] }
        }
      }

      case 'list_specialized_templates': {
        const builtins = [
          {
            id: 'builtin-workout',
            category: 'workout',
            title: 'Gym Workout',
            description: 'Log workout date, time, workout name, and exercises',
            fields: [
              { name: 'date', defaultValue: today },
              { name: 'time', defaultValue: '10:00' },
              { name: 'name', defaultValue: 'Gym Workout' },
              { name: 'exerciseCount', defaultValue: '4' }
            ],
            color: 'blue'
          },
          {
            id: 'builtin-daily',
            category: 'daily',
            title: 'Daily Plan & Reflection',
            description: 'Plan tasks, reflect, track wins, blockers, and focus',
            fields: [
              { name: 'date', defaultValue: today },
              { name: 'feedback', defaultValue: '' },
              { name: 'wins', defaultValue: '' },
              { name: 'blockers', defaultValue: '' },
              { name: 'nextFocus', defaultValue: '' }
            ],
            color: 'emerald'
          },
          {
            id: 'builtin-finance',
            category: 'finance',
            title: 'Expense & Decision',
            description: 'Capture spending, merchants, rationales, and compare financial choices',
            fields: [
              { name: 'date', defaultValue: today },
              { name: 'amount', defaultValue: '' },
              { name: 'currency', defaultValue: 'USD' },
              { name: 'category', defaultValue: '' },
              { name: 'merchant', defaultValue: '' },
              { name: 'decision', defaultValue: '' },
              { name: 'rationale', defaultValue: '' },
              { name: 'outcome', defaultValue: '' }
            ],
            color: 'amber'
          }
        ]

        const custom = await templates.list(userId).catch(() => [])
        return {
          toolName: name,
          args,
          result: {
            builtInTemplates: builtins,
            customTemplates: custom,
            totalTemplates: builtins.length + custom.length
          }
        }
      }

      case 'create_specialized_template': {
        const title = String(args.title || '').trim()
        if (!title) {
          throw new Error('Template title is required.')
        }
        const description = args.description ? String(args.description).trim() : null
        const rawFields = Array.isArray(args.fields) ? args.fields : []
        const formattedFields = rawFields
          .map((f: any) => {
            if (typeof f === 'string') return { name: f.trim(), defaultValue: '' }
            return { name: String(f.name || '').trim(), defaultValue: f.defaultValue ? String(f.defaultValue) : '' }
          })
          .filter((f: any) => f.name.length > 0)

        if (formattedFields.length === 0) {
          throw new Error('At least one field name is required to create a template.')
        }

        const syncWithCalendar = args.sync_with_calendar === true || String(args.sync_with_calendar).toLowerCase() === 'true'
        const created = await templates.create(userId, {
          title,
          description,
          fields: formattedFields,
          ai_instruction: args.ai_instruction ? String(args.ai_instruction).trim() : null,
          color: args.color || 'purple',
          sync_with_calendar: syncWithCalendar
        })

        return {
          toolName: name,
          args,
          result: { success: true, template: created },
          actionCard: {
            type: 'template',
            id: created.id,
            title: created.title,
            contentSnippet: created.description || `${created.fields.length} fields: ${created.fields.map(f => f.name).join(', ')}`,
            category: 'custom',
            data: created as unknown as Record<string, unknown>
          }
        }
      }

      case 'create_specialized_note': {
        const templateQuery = String(args.template_name || '').toLowerCase().trim()
        let title = String(args.title || '').trim()
        const content = String(args.content || '')
        const tags = Array.isArray(args.tags) ? args.tags.map(String) : []
        const userFields = typeof args.fields === 'object' && args.fields !== null ? args.fields : {}

        let category: 'workout' | 'daily' | 'finance' | 'custom' = 'custom'
        let templateId: string | undefined = undefined
        let aiInstruction = ''
        let color = 'blue'
        let finalFields: Record<string, unknown> = {}

        let matchedTemplate: any = null
        if (
          templateQuery.includes('workout') ||
          templateQuery.includes('gym') ||
          templateQuery.includes('fitness') ||
          templateQuery.includes('exercise')
        ) {
          category = 'workout'
          aiInstruction = 'Help structure workouts, track exercises, sets, and analyze progress without medical claims.'
          color = 'blue'
          finalFields = {
            date: today,
            time: new Date().toLocaleTimeString('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false }),
            name: title || 'Gym Workout',
            exerciseCount: '4',
            ...userFields
          }
        } else if (
          templateQuery.includes('daily') ||
          templateQuery.includes('plan') ||
          templateQuery.includes('routine') ||
          templateQuery.includes('reflection')
        ) {
          category = 'daily'
          aiInstruction = 'Help plan tasks and provide concise daily feedback.'
          color = 'emerald'
          finalFields = {
            date: today,
            feedback: '',
            wins: '',
            blockers: '',
            nextFocus: '',
            ...userFields
          }
        } else if (
          templateQuery.includes('finance') ||
          templateQuery.includes('expense') ||
          templateQuery.includes('budget') ||
          templateQuery.includes('spending')
        ) {
          category = 'finance'
          aiInstruction = 'Help categorize expenses and compare financial decisions; state assumptions clearly.'
          color = 'amber'
          finalFields = {
            date: today,
            amount: '',
            currency: 'USD',
            category: '',
            merchant: '',
            decision: '',
            rationale: '',
            outcome: '',
            ...userFields
          }
        } else {
          const userTemplates = await templates.list(userId).catch(() => [])
          const match = userTemplates.find(
            t =>
              t.title.toLowerCase().includes(templateQuery) ||
              templateQuery.includes(t.title.toLowerCase())
          )

          if (match) {
            matchedTemplate = match
            category = 'custom'
            templateId = match.title
            aiInstruction = match.ai_instruction || 'Follow this template’s fields and propose only supported updates.'
            color = match.color || 'purple'
            const seeded: Record<string, unknown> = {}
            for (const f of match.fields) {
              seeded[f.name] = f.defaultValue || ''
            }
            finalFields = { ...seeded, ...userFields }
          } else {
            return {
              toolName: name,
              args,
              result: {
                error: `No specialized template found matching "${args.template_name}". Built-in templates: Gym Workout, Daily Plan, Expense & Decision. If the user wants a template for "${args.template_name}", ask them if they would like you to create one, or use create_note for a standard note.`
              },
              error: `No specialized template found matching "${args.template_name}".`
            }
          }
        }

        if (!title) {
          title = `${templateId || category.charAt(0).toUpperCase() + category.slice(1)} Note`
        }

        const syncWithCalendar = args.sync_with_calendar === true || String(args.sync_with_calendar).toLowerCase() === 'true'

        const noteInput = {
          title,
          content:
            content ||
            (category === 'workout' ? '<h3>Workout Log</h3><p><strong>Exercises & Sets:</strong></p><p>• </p>' : ''),
          tags,
          kind: 'specialized' as const,
          specialized: {
            category,
            templateId,
            fields: finalFields,
            aiInstruction,
            color,
            syncWithCalendar
          }
        }

        const created = await notes.create(userId, noteInput, 'specialized')
        try {
          await vectors.upsertVector(created)
        } catch (err) {
          console.warn('[Agent Tools] Vector upsert failed for specialized note:', err)
        }

        if (syncWithCalendar) {
          try {
            let eventDateStr = String(finalFields.date || finalFields.Date || '')
            let eventTimeStr = String(finalFields.time || finalFields.Time || '')
            if (!eventDateStr) {
              for (const [k, v] of Object.entries(finalFields)) {
                if (k.toLowerCase().includes('date') || k.toLowerCase().includes('day')) {
                  eventDateStr = String(v || '')
                  break
                }
              }
            }
            if (!eventTimeStr) {
              for (const [k, v] of Object.entries(finalFields)) {
                if (k.toLowerCase().includes('time') || k.toLowerCase().includes('hour')) {
                  eventTimeStr = String(v || '')
                  break
                }
              }
            }
            if (eventDateStr) {
              const start = new Date(eventDateStr)
              if (!isNaN(start.getTime())) {
                if (eventTimeStr && eventTimeStr.includes(':')) {
                  const [hh, mm] = eventTimeStr.split(':').map(Number)
                  start.setHours(isNaN(hh) ? 10 : hh, isNaN(mm) ? 0 : mm, 0, 0)
                } else {
                  start.setHours(9, 0, 0, 0)
                }
                const end = new Date(start.getTime() + 60 * 60 * 1000)
                await supabase.from('events').insert({
                  user_id: userId,
                  note_id: created.id,
                  title: created.title,
                  start_time: start.toISOString(),
                  end_time: end.toISOString(),
                  all_day: !eventTimeStr,
                  description: `${created.title} (${category})`
                })
              }
            }
          } catch (calErr) {
            console.warn('[Agent Tools] Auto calendar sync error:', calErr)
          }
        }

        return {
          toolName: name,
          args,
          result: { success: true, note: created },
          actionCard: {
            type: 'specialized_note',
            id: created.id,
            title: created.title,
            contentSnippet: stripImages(created.content || '').slice(0, 160) || `Specialized ${category} note`,
            tags: created.tags,
            category,
            data: created as unknown as Record<string, unknown>
          }
        }
      }

      case 'trash_note': {
        let targetId = args.id ? String(args.id) : null
        let targetTitle = ''

        if (!targetId && args.title_query) {
          const activeNotes = await notes.list(userId, 'all').catch(() => [])
          const { match, ambiguous } = matchNoteByTitle(activeNotes, String(args.title_query))
          if (ambiguous) return ambiguityResult(name, args, ambiguous)
          if (match) {
            targetId = match.id
            targetTitle = match.title
          }
        }

        if (!targetId) {
          throw new Error(`Could not find any active note matching "${args.title_query || args.id}".`)
        }

        if (!targetTitle) {
          const existing = await notes.get(userId, targetId).catch(() => null)
          targetTitle = existing?.title || 'Note'
        }

        await notes.trash(userId, targetId)
        return {
          toolName: name,
          args,
          result: { success: true, id: targetId, title: targetTitle, movedToTrash: true },
          actionCard: {
            type: 'item_deleted',
            id: targetId,
            title: targetTitle,
            category: 'note',
            itemType: 'Note',
            status: 'Moved to trash',
            data: { id: targetId, title: targetTitle, itemType: 'Note', status: 'Moved to trash' }
          }
        }
      }

      case 'permanently_delete_note': {
        let targetId = args.id ? String(args.id) : null
        let targetTitle = ''

        if (!targetId && args.title_query) {
          const allNotes = [
            ...(await notes.list(userId, 'all').catch(() => [])),
            ...(await notes.list(userId, 'trash').catch(() => []))
          ]
          const { match, ambiguous } = matchNoteByTitle(allNotes, String(args.title_query))
          if (ambiguous) return ambiguityResult(name, args, ambiguous)
          if (match) {
            targetId = match.id
            targetTitle = match.title
          }
        }

        if (!targetId) {
          throw new Error(`Could not find any note matching "${args.title_query || args.id}".`)
        }

        if (!targetTitle) {
          const existing = await notes.get(userId, targetId).catch(() => null)
          targetTitle = existing?.title || 'Note'
        }

        if (!options.confirmed) return confirmationRequest(userId, name, args, { id: targetId, title: targetTitle, itemType: 'Note', status: 'Permanently delete' })
        await notes.deletePermanently(userId, targetId)
        void vectors.deleteVector(targetId, userId)

        return {
          toolName: name,
          args,
          result: { success: true, id: targetId, title: targetTitle, permanentlyDeleted: true },
          actionCard: {
            type: 'item_deleted',
            id: targetId,
            title: targetTitle,
            category: 'note',
            itemType: 'Note',
            status: 'Permanently deleted',
            data: { id: targetId, title: targetTitle, itemType: 'Note', status: 'Permanently deleted' }
          }
        }
      }

      case 'empty_trash': {
        const ids = await notes.trashIds(userId)
        if (!ids.length) {
          return {
            toolName: name,
            args,
            result: { success: true, count: 0, message: 'Trash is already empty.' }
          }
        }

        if (!options.confirmed) return confirmationRequest(userId, name, args, { title: `${ids.length} note${ids.length === 1 ? '' : 's'} in trash`, itemType: 'Trash', status: 'Permanently delete' })
        await notes.deleteMany(userId, ids)
        void vectors.deleteVectors(ids, userId)

        return {
          toolName: name,
          args,
          result: { success: true, count: ids.length, message: `Permanently deleted ${ids.length} note(s) from trash.` },
          actionCard: {
            type: 'item_deleted',
            title: 'Trash Bin Emptied',
            category: 'trash',
            itemType: 'Trash',
            status: `Permanently deleted ${ids.length} note${ids.length === 1 ? '' : 's'}`,
            data: { count: ids.length, itemType: 'Trash', status: `Permanently deleted ${ids.length} notes` }
          }
        }
      }

      case 'delete_task': {
        let targetId = args.id ? String(args.id) : null
        let targetText = ''

        if (!targetId && args.text_query) {
          const query = String(args.text_query).trim().toLowerCase()
          const { data: userTasks } = await supabase
            .from('tasks')
            .select('id, text')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(50)

          const match = (userTasks || []).find(t => t.text.toLowerCase().includes(query))
          if (match) {
            targetId = match.id
            targetText = match.text
          }
        }

        if (!targetId) {
          throw new Error(`Could not find any task matching "${args.text_query || args.id}".`)
        }

        if (!targetText) {
          const { data } = await supabase.from('tasks').select('text').eq('id', targetId).eq('user_id', userId).single()
          targetText = data?.text || 'Task'
        }

        if (!options.confirmed) return confirmationRequest(userId, name, args, { id: targetId, title: targetText, itemType: 'Task', status: 'Delete' })
        const { error } = await supabase.from('tasks').delete().eq('id', targetId).eq('user_id', userId)
        if (error) throw error

        return {
          toolName: name,
          args,
          result: { success: true, id: targetId, text: targetText },
          actionCard: {
            type: 'item_deleted',
            id: targetId,
            title: targetText,
            category: 'task',
            itemType: 'Task',
            status: 'Task deleted',
            data: { id: targetId, title: targetText, itemType: 'Task', status: 'Task deleted' }
          }
        }
      }

      case 'delete_calendar_event': {
        let targetId = args.id ? String(args.id) : null
        let targetTitle = ''

        if (!targetId && args.title_query) {
          const query = String(args.title_query).trim().toLowerCase()
          const { data: userEvents } = await supabase
            .from('events')
            .select('id, title, start_time')
            .eq('user_id', userId)
            .order('start_time', { ascending: false })
            .limit(50)

          const match = (userEvents || []).find(e => e.title.toLowerCase().includes(query))
          if (match) {
            targetId = match.id
            targetTitle = match.title
          }
        }

        if (!targetId) {
          throw new Error(`Could not find any calendar event matching "${args.title_query || args.id}".`)
        }

        if (!targetTitle) {
          const { data } = await supabase.from('events').select('title').eq('id', targetId).eq('user_id', userId).single()
          targetTitle = data?.title || 'Calendar Event'
        }

        if (!options.confirmed) return confirmationRequest(userId, name, args, { id: targetId, title: targetTitle, itemType: 'Calendar Event', status: 'Delete' })
        const { error } = await supabase.from('events').delete().eq('id', targetId).eq('user_id', userId)
        if (error) throw error

        return {
          toolName: name,
          args,
          result: { success: true, id: targetId, title: targetTitle },
          actionCard: {
            type: 'item_deleted',
            id: targetId,
            title: targetTitle,
            category: 'event',
            itemType: 'Calendar Event',
            status: 'Event cancelled & deleted',
            data: { id: targetId, title: targetTitle, itemType: 'Calendar Event', status: 'Event cancelled & deleted' }
          }
        }
      }

      case 'delete_memory': {
        let targetId = args.id ? String(args.id) : null
        let targetFact = ''

        if (!targetId && args.fact_query) {
          const query = String(args.fact_query).trim().toLowerCase()
          const { data: userMems } = await supabase
            .from('user_memories')
            .select('id, fact')
            .eq('user_id', userId)
            .order('updated_at', { ascending: false })

          const match = (userMems || []).find(m => m.fact.toLowerCase().includes(query))
          if (match) {
            targetId = match.id
            targetFact = match.fact
          }
        }

        if (!targetId) {
          throw new Error(`Could not find any memory matching "${args.fact_query || args.id}".`)
        }

        if (!targetFact) {
          const { data } = await supabase.from('user_memories').select('fact').eq('id', targetId).eq('user_id', userId).single()
          targetFact = data?.fact || 'Memory'
        }

        if (!options.confirmed) return confirmationRequest(userId, name, args, { id: targetId, title: targetFact, itemType: 'Memory', status: 'Forget' })
        const { error } = await supabase.from('user_memories').delete().eq('id', targetId).eq('user_id', userId)
        if (error) throw error

        return {
          toolName: name,
          args,
          result: { success: true, id: targetId, fact: targetFact },
          actionCard: {
            type: 'item_deleted',
            id: targetId,
            title: targetFact,
            category: 'memory',
            itemType: 'Memory',
            status: 'Memory deleted (forgotten)',
            data: { id: targetId, title: targetFact, itemType: 'Memory', status: 'Memory deleted (forgotten)' }
          }
        }
      }

      case 'delete_specialized_template': {
        const query = String(args.title || args.id || '').trim().toLowerCase()
        if (
          query.includes('workout') ||
          query.includes('daily') ||
          query.includes('finance') ||
          String(args.id || '').startsWith('builtin-')
        ) {
          throw new Error('Built-in templates (Gym Workout, Daily Plan & Reflection, Expense & Decision) are system defaults and cannot be deleted.')
        }

        const userTemplates = await templates.list(userId).catch(() => [])
        let targetTemplate = args.id ? userTemplates.find(t => t.id === args.id) : null
        if (!targetTemplate && args.title) {
          const titleLower = String(args.title).toLowerCase().trim()
          targetTemplate = userTemplates.find(
            t => t.title.toLowerCase() === titleLower || t.title.toLowerCase().includes(titleLower)
          )
        }

        if (!targetTemplate) {
          throw new Error(`Could not find any custom template matching "${args.title || args.id}".`)
        }

        if (!options.confirmed) return confirmationRequest(userId, name, args, { id: targetTemplate.id, title: targetTemplate.title, itemType: 'Specialized Template', status: 'Delete' })
        await templates.delete(userId, targetTemplate.id)

        return {
          toolName: name,
          args,
          result: { success: true, id: targetTemplate.id, title: targetTemplate.title },
          actionCard: {
            type: 'item_deleted',
            id: targetTemplate.id,
            title: targetTemplate.title,
            category: 'template',
            itemType: 'Specialized Template',
            status: 'Template deleted',
            data: { id: targetTemplate.id, title: targetTemplate.title, itemType: 'Specialized Template', status: 'Template deleted' }
          }
        }
      }

      case 'delete_chat_session': {
        let targetId = args.id ? String(args.id) : null
        let targetTitle = ''

        if (!targetId && args.title_query) {
          const query = String(args.title_query).trim().toLowerCase()
          const { data: userSessions } = await supabase
            .from('chat_sessions')
            .select('id, title')
            .eq('user_id', userId)
            .order('updated_at', { ascending: false })

          const match = (userSessions || []).find(s => s.title.toLowerCase().includes(query))
          if (match) {
            targetId = match.id
            targetTitle = match.title
          }
        }

        if (!targetId) {
          throw new Error(`Could not find any conversation matching "${args.title_query || args.id}".`)
        }

        if (!targetTitle) {
          const { data } = await supabase.from('chat_sessions').select('title').eq('id', targetId).eq('user_id', userId).single()
          targetTitle = data?.title || 'Conversation'
        }

        if (!options.confirmed) return confirmationRequest(userId, name, args, { id: targetId, title: targetTitle, itemType: 'Conversation', status: 'Delete' })
        const { error } = await supabase.from('chat_sessions').delete().eq('id', targetId).eq('user_id', userId)
        if (error) throw error

        return {
          toolName: name,
          args,
          result: { success: true, id: targetId, title: targetTitle },
          actionCard: {
            type: 'item_deleted',
            id: targetId,
            title: targetTitle,
            category: 'chat_session',
            itemType: 'Conversation',
            status: 'Conversation deleted',
            data: { id: targetId, title: targetTitle, itemType: 'Conversation', status: 'Conversation deleted' }
          }
        }
      }

      default:
        throw new Error(`Unknown tool: ${name}`)
    }
  } catch (err: any) {
    return {
      toolName: name,
      args,
      result: { error: err?.message || String(err) },
      error: err?.message || String(err)
    }
  }
}
