import type { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import * as chrono from 'chrono-node'
import { supabase } from '../supabase/client.js'
import { settings } from '../services/settings.repository.js'
import { complete } from '../services/ai.service.js'
import { normalizeTimePhrases } from './detection.controller.js'

const eventSchema = z.object({
  title: z.string().trim().min(1, 'Title is required'),
  description: z.string().optional().default(''),
  start_time: z.string().datetime({ offset: true }),
  end_time: z.string().datetime({ offset: true }).optional().nullable(),
  all_day: z.boolean().optional().default(false),
  location: z.string().optional().default(''),
  note_id: z.string().uuid().optional().nullable()
})

export async function listEvents(req: Request, res: Response, next: NextFunction) {
  try {
    let query = supabase
      .from('events')
      .select('*')
      .eq('user_id', req.userId!)
      .order('start_time', { ascending: true })

    if (typeof req.query.from === 'string') {
      query = query.gte('start_time', req.query.from)
    }
    if (typeof req.query.to === 'string') {
      query = query.lte('start_time', req.query.to)
    }

    const { data, error } = await query
    if (error) throw error
    res.json(data || [])
  } catch (error) {
    next(error)
  }
}

export async function createEvent(req: Request, res: Response, next: NextFunction) {
  try {
    const body = eventSchema.parse(req.body)
    const { data, error } = await supabase
      .from('events')
      .insert({
        user_id: req.userId!,
        title: body.title,
        description: body.description,
        start_time: body.start_time,
        end_time: body.end_time || null,
        all_day: body.all_day,
        location: body.location,
        note_id: body.note_id || null
      })
      .select()
      .single()

    if (error) throw error
    res.status(201).json(data)
  } catch (error) {
    next(error)
  }
}

export async function quickAddEvent(req: Request, res: Response, next: NextFunction) {
  try {
    const prompt = typeof req.body.prompt === 'string' ? req.body.prompt.trim() : ''
    if (!prompt) return res.status(400).json({ error: 'Please enter a prompt' })

    const refDate = req.body.clientDate ? new Date(req.body.clientDate) : new Date()
    const normalizedPrompt = normalizeTimePhrases(prompt)
    const parsedResults = chrono.parse(normalizedPrompt, refDate)

    let title = prompt
    let startTime = new Date(refDate.getTime() + 60 * 60 * 1000) // Default 1 hour from now
    let endTime: Date | null = null
    let allDay = false
    let location = ''

    // Deterministic parsing via chrono
    if (parsedResults.length > 0) {
      const first = parsedResults[0]
      const startDate = first.start.date()
      startTime = startDate
      if (first.end) {
        endTime = first.end.date()
      } else {
        // Default 1 hour duration
        endTime = new Date(startDate.getTime() + 60 * 60 * 1000)
      }

      // Check if time was mentioned or only day
      if (!first.start.isCertain('hour')) {
        allDay = true
      }

      // Strip the date snippet to clean up the title
      const extractedText = normalizedPrompt.replace(first.text, '').replace(/\b(at|on|for|in)\b/gi, '').trim()
      if (extractedText.length > 0) {
        title = extractedText.charAt(0).toUpperCase() + extractedText.slice(1)
      }
    }

    // Attempt AI refinement with local or cloud Ollama
    try {
      const apiKey = await settings.getKey(req.userId!).catch(() => null)
      const aiPrompt = `Given reference date ${refDate.toISOString()} and the event prompt: "${prompt}",
extract the event details and reply strictly with valid JSON (no markdown):
{
  "title": "Clean Event Title",
  "start_time": "ISO 8601 string",
  "end_time": "ISO 8601 string or null",
  "all_day": false,
  "location": ""
}`
      const aiResponse = await complete(
        'You are an expert calendar assistant that returns strictly JSON.',
        aiPrompt,
        undefined,
        apiKey || undefined
      )
      const match = aiResponse.match(/\{[\s\S]*\}/)
      if (match) {
        const parsedAi = JSON.parse(match[0])
        if (parsedAi.title) title = parsedAi.title
        if (parsedAi.start_time) startTime = new Date(parsedAi.start_time)
        if (parsedAi.end_time) endTime = new Date(parsedAi.end_time)
        if (typeof parsedAi.all_day === 'boolean') allDay = parsedAi.all_day
        if (parsedAi.location) location = parsedAi.location
      }
    } catch (err) {
      // Deterministic fallback already set
    }

    // Format title cleanly
    title = title.replace(/\s+/g, ' ').trim() || 'Scheduled Event'

    const { data, error } = await supabase
      .from('events')
      .insert({
        user_id: req.userId!,
        title,
        description: `Created via prompt: "${prompt}"`,
        start_time: startTime.toISOString(),
        end_time: endTime ? endTime.toISOString() : null,
        all_day: allDay,
        location,
        note_id: req.body.note_id || null
      })
      .select()
      .single()

    if (error) throw error
    res.status(201).json(data)
  } catch (error) {
    next(error)
  }
}

export async function updateEvent(req: Request, res: Response, next: NextFunction) {
  try {
    const id = z.string().uuid().parse(req.params.id)
    const body = eventSchema.partial().parse(req.body)

    const { data, error } = await supabase
      .from('events')
      .update(body)
      .eq('id', id)
      .eq('user_id', req.userId!)
      .select()
      .single()

    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Event not found' })
    res.json(data)
  } catch (error) {
    next(error)
  }
}

export async function deleteEvent(req: Request, res: Response, next: NextFunction) {
  try {
    const id = z.string().uuid().parse(req.params.id)
    const { error } = await supabase
      .from('events')
      .delete()
      .eq('id', id)
      .eq('user_id', req.userId!)

    if (error) throw error
    res.status(204).end()
  } catch (error) {
    next(error)
  }
}
