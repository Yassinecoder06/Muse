import type { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { supabase } from '../supabase/client.js'

const taskSchema = z.object({
  text: z.string().trim().min(1, 'Task text is required'),
  completed: z.boolean().optional().default(false),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  due_time: z.string().optional().nullable(),
  priority: z.enum(['low', 'medium', 'high']).optional().default('medium'),
  note_id: z.string().uuid().optional().nullable()
})

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
        priority: body.priority
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

    const { data, error } = await supabase
      .from('tasks')
      .update(body)
      .eq('id', id)
      .eq('user_id', req.userId!)
      .select()
      .single()

    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Task not found' })
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
