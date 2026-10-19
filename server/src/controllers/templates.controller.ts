import type { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { templates } from '../services/template.repository.js'

const fieldSchema = z.object({ name: z.string().trim().min(1).max(80), defaultValue: z.string().max(2000).optional() })
const templateSchema = z.object({
  title: z.string().trim().min(1, 'Title is required for a specialized template.').max(120),
  description: z.string().max(1000).nullable().optional(),
  fields: z.array(fieldSchema).max(40).optional(),
  ai_instruction: z.string().max(2000).nullable().optional(),
  color: z.string().max(20).optional(),
  sync_with_calendar: z.boolean().optional()
})
const templateId = (value: unknown) => z.string().uuid().parse(value)

export async function listTemplates(req: Request, res: Response, next: NextFunction) {
  try {
    const list = await templates.list(req.userId!)
    res.json(list)
  } catch (err) {
    next(err)
  }
}

export async function getTemplate(req: Request, res: Response, next: NextFunction) {
  try {
    const item = await templates.get(req.userId!, templateId(req.params.id))
    res.json(item)
  } catch (err) {
    next(err)
  }
}

export async function createTemplate(req: Request, res: Response, next: NextFunction) {
  try {
    const body = templateSchema.parse(req.body || {})
    const item = await templates.create(req.userId!, { ...body, fields: body.fields || [] })
    res.status(201).json(item)
  } catch (err) {
    next(err)
  }
}

export async function updateTemplate(req: Request, res: Response, next: NextFunction) {
  try {
    const body = templateSchema.partial().parse(req.body || {})
    const item = await templates.update(req.userId!, templateId(req.params.id), body)
    res.json(item)
  } catch (err) {
    next(err)
  }
}

export async function deleteTemplate(req: Request, res: Response, next: NextFunction) {
  try {
    await templates.delete(req.userId!, templateId(req.params.id))
    res.status(204).end()
  } catch (err) {
    next(err)
  }
}
