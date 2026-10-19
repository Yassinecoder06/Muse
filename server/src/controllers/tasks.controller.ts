import type { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { supabase } from '../supabase/client.js'
import { reminderInstant, requestTimezone } from '../utils/timezone.js'

const taskSchema = z.object({
  text: z.string().trim().min(1, 'Task text is required').max(2000),
  completed: z.boolean().optional().default(false),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  due_time: z.string().max(20).optional().nullable(),
  priority: z.enum(['low', 'medium', 'high']).optional().default('medium'),
  note_id: z.string().uuid().optional().nullable(),
  // Either "N minutes before the due time" or an exact moment; null clears.
  reminder_minutes_before: z.number().int().min(0).max(43200).optional().nullable(),
  reminder_at: z.string().datetime({ offset: true }).optional().nullable()
})

type TaskRow = { due_date: string | null; due_time: string | null; reminder_minutes_before: number | null; reminder_at: string | null }
type ReminderFields = { reminder_at?: string | null; reminder_minutes_before?: number | null }

class ReminderError extends Error { statusCode = 400 }

/**
 * Works out reminder columns for a create/update. A relative reminder follows
 * the due date/time, so it is recomputed whenever those change.
 */
export function resolveReminder(body: Partial<z.infer<typeof taskSchema>>, current: TaskRow | null, zone: string): ReminderFields {
  const dueDate = body.due_date !== undefined ? body.due_date : current?.due_date ?? null
  const dueTime = body.due_time !== undefined ? body.due_time : current?.due_time ?? null

  if (body.reminder_at !== undefined && body.reminder_minutes_before === undefined) {
    return { reminder_at: body.reminder_at ? new Date(body.reminder_at).toISOString() : null, reminder_minutes_before: null }
  }

  const minutes = body.reminder_minutes_before !== undefined ? body.reminder_minutes_before : current?.reminder_minutes_before ?? null
  const dueChanged = body.due_date !== undefined || body.due_time !== undefined
  if (body.reminder_minutes_before === undefined && !dueChanged) return {}
  if (minutes === null) return body.reminder_minutes_before === null ? { reminder_at: null, reminder_minutes_before: null } : {}
  if (!dueDate) {
    if (body.reminder_minutes_before !== undefined) throw new ReminderError('Give the task a due date first, or pick an exact reminder time.')
    return { reminder_at: null } // due date removed: the relative reminder has nothing to follow
  }
  return { reminder_at: reminderInstant(dueDate, dueTime, minutes, zone).toISOString(), reminder_minutes_before: minutes }
}

export async function listTasks(req: Request, res: Response, next: NextFunction) {
  try {
    let query = supabase
      .from('tasks')
      .select('*')
      .eq('user_id', req.userId!)
      .order('completed', { ascending: true })
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })

    if (typeof req.query.due_date === 'string') {
      query = query.eq('due_date', req.query.due_date)
    }

    const { data, error } = await query
    if (error) throw error
    res.json(data || [])
  } catch (error) {
    next(error)
  }
}

export async function createTask(req: Request, res: Response, next: NextFunction) {
  try {
    const body = taskSchema.parse(req.body)
    const { data, error } = await supabase
      .from('tasks')
      .insert({
        user_id: req.userId!,
        note_id: body.note_id || null,
        text: body.text,
        completed: body.completed,
        due_date: body.due_date || null,
        due_time: body.due_time || null,
        priority: body.priority,
        ...resolveReminder(body, null, requestTimezone(req))
      })
      .select()
      .single()

    if (error) throw error
    res.status(201).json(data)
  } catch (error) {
    next(error)
  }
}

export async function updateTask(req: Request, res: Response, next: NextFunction) {
  try {
    const id = z.string().uuid().parse(req.params.id)
    const body = taskSchema.partial().parse(req.body)

    const { data: current, error: currentError } = await supabase
      .from('tasks')
      .select('due_date, due_time, reminder_minutes_before, reminder_at')
      .eq('id', id)
      .eq('user_id', req.userId!)
      .maybeSingle()
    if (currentError) throw currentError
    if (!current) return res.status(404).json({ error: 'Task not found' })

    const { data, error } = await supabase
      .from('tasks')
      .update({ ...body, ...resolveReminder(body, current, requestTimezone(req)) })
      .eq('id', id)
      .eq('user_id', req.userId!)
      .select()
      .single()

    if (error) throw error
    res.json(data)
  } catch (error) {
    next(error)
  }
}

export async function deleteTask(req: Request, res: Response, next: NextFunction) {
  try {
    const id = z.string().uuid().parse(req.params.id)
    const { error } = await supabase
      .from('tasks')
      .delete()
      .eq('id', id)
      .eq('user_id', req.userId!)

    if (error) throw error
    res.status(204).end()
  } catch (error) {
    next(error)
  }
}
