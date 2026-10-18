import * as chrono from 'chrono-node'
import { supabase } from '../supabase/client.js'
import { notes } from './note.repository.js'
import { vectors } from './vector.service.js'
import { normalizeTimePhrases } from '../controllers/detection.controller.js'
import { stripImages } from '../utils/images.js'

export interface AgentActionCard {
  type: 'note' | 'note_updated' | 'task' | 'task_updated' | 'event' | 'memory'
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
        note_id: { type: 'STRING', description: 'Optional associated note UUID' }
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
    description: 'Update a task text or mark it completed/uncompleted.',
    parameters: {
      type: 'OBJECT',
      properties: {
        id: { type: 'STRING', description: 'The UUID of the task' },
        completed: { type: 'BOOLEAN', description: 'Set true to complete, false to uncomplete' },
        text: { type: 'STRING', description: 'Updated task description (optional)' }
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
  }
]

// Resolve natural or ISO dates into reliable ISO strings
function resolveDateTime(input: string, refDate = new Date()): { date: Date | null; isAllDay: boolean } {
  if (!input) return { date: null, isAllDay: false }
  
  // Try direct ISO parse first
  const parsedDirect = new Date(input)
  if (!isNaN(parsedDirect.getTime()) && input.includes('T')) {
    return { date: parsedDirect, isAllDay: false }
  }

  // Parse using chrono-node
  const normalized = normalizeTimePhrases(input)
  const parsedResults = chrono.parse(normalized, refDate)
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

function resolveDueDate(input: string | undefined): string | null {
  if (!input) return null
  const match = input.match(/^\d{4}-\d{2}-\d{2}$/)
  if (match) return input

  const parsed = chrono.parseDate(normalizeTimePhrases(input), new Date())
  if (parsed) {
    return parsed.toISOString().slice(0, 10)
  }
  return null
}

export async function executeAgentTool(
  userId: string,
  name: string,
  args: Record<string, any>
): Promise<ToolExecutionResult> {
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
        const found = (await Promise.all(ids.slice(0, 5).map(id => notes.get(userId, id).catch(() => null)))).filter(Boolean)
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
        const dueDate = resolveDueDate(args.due_date)
        const dueTime = typeof args.due_time === 'string' ? args.due_time : null
        const priority = ['low', 'medium', 'high'].includes(args.priority) ? args.priority : 'medium'
        const noteId = args.note_id || null

        const { data, error } = await supabase
          .from('tasks')
          .insert({
            user_id: userId,
            text,
            completed: false,
            due_date: dueDate,
            due_time: dueTime,
            priority,
            note_id: noteId
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
          const parsed = resolveDueDate(args.due_date)
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
        const { date: startDate, isAllDay } = resolveDateTime(startRaw)
        if (!startDate) throw new Error(`Could not parse event start time from: "${startRaw}"`)

        let endDate: Date | null = null
        if (args.end_time) {
          const parsedEnd = resolveDateTime(String(args.end_time), startDate)
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
          const { date } = resolveDateTime(String(args.from))
          if (date) q = q.gte('start_time', date.toISOString())
        }
        if (args.to) {
          const { date } = resolveDateTime(String(args.to))
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
