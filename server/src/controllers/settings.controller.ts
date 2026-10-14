import type { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { settings } from '../services/settings.repository.js'
import { validateApiKey } from '../services/ai.service.js'

const user = (req: Request) => req.userId!
export async function getSettings(req: Request, res: Response, next: NextFunction) { try { res.json({ hasApiKey: await settings.hasKey(user(req)) }) } catch (error) { next(error) } }
export async function saveApiKey(req: Request, res: Response, next: NextFunction) {
  try {
    const { apiKey } = z.object({ apiKey: z.string().trim().min(1).max(200) }).parse(req.body)
    const result = await validateApiKey(apiKey)
    if (!result.valid) {
      res.status(400).json({
        error: result.error || 'That API key is not valid for Ollama Cloud (ollama.com). Note: Local Ollama on your machine already works without any API key.'
      })
      return
    }
    await settings.saveKey(user(req), apiKey)
    res.json({ hasApiKey: true })
  } catch (error) { next(error) }
}
export async function deleteApiKey(req: Request, res: Response, next: NextFunction) { try { await settings.deleteKey(user(req)); res.json({ hasApiKey: false }) } catch (error) { next(error) } }