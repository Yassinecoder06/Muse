import type { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { settings } from '../services/settings.repository.js'
import { validateApiKey, validateGeminiApiKey, isGeminiKey } from '../services/ai.service.js'

const user = (req: Request) => req.userId!

export async function getSettings(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = user(req)
    const [hasGeminiKey, hasOllamaKey] = await Promise.all([
      settings.hasGeminiKey(userId),
      settings.hasKey(userId)
    ])
    res.json({
      hasApiKey: hasGeminiKey || hasOllamaKey,
      hasGeminiKey,
      hasOllamaKey,
      activeProvider: hasGeminiKey ? 'gemini' : (hasOllamaKey ? 'ollama' : 'local')
    })
  } catch (error) { next(error) }
}

export async function saveApiKey(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = user(req)
    const { apiKey, provider } = z.object({
      apiKey: z.string().trim().min(1).max(200),
      provider: z.enum(['gemini', 'ollama']).optional()
    }).parse(req.body)

    const isGemini = provider === 'gemini' || (!provider && isGeminiKey(apiKey))

    if (isGemini) {
      const result = await validateGeminiApiKey(apiKey)
      if (!result.valid) {
        res.status(400).json({
          error: result.error || 'That Gemini API key is not valid. Verify it at aistudio.google.com/apikey.'
        })
        return
      }
      await settings.saveGeminiKey(userId, apiKey)
      const hasOllamaKey = await settings.hasKey(userId)
      res.json({
        hasApiKey: true,
        hasGeminiKey: true,
        hasOllamaKey,
        activeProvider: 'gemini'
      })
      return
    }

    const result = await validateApiKey(apiKey)
    if (!result.valid) {
      res.status(400).json({
        error: result.error || 'That API key is not valid for Ollama Cloud (ollama.com). Note: Local Ollama on your machine already works without any API key.'
      })
      return
    }
    await settings.saveKey(userId, apiKey)
    const hasGeminiKey = await settings.hasGeminiKey(userId)
    res.json({
      hasApiKey: true,
      hasGeminiKey,
      hasOllamaKey: true,
      activeProvider: hasGeminiKey ? 'gemini' : 'ollama'
    })
  } catch (error) { next(error) }
}

export async function deleteApiKey(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = user(req)
    const provider = req.query.provider as string || req.body?.provider

    if (provider === 'gemini') {
      await settings.deleteGeminiKey(userId)
    } else if (provider === 'ollama') {
      await settings.deleteKey(userId)
    } else {
      if (await settings.hasGeminiKey(userId)) {
        await settings.deleteGeminiKey(userId)
      } else {
        await settings.deleteKey(userId)
      }
    }

    const [hasGeminiKey, hasOllamaKey] = await Promise.all([
      settings.hasGeminiKey(userId),
      settings.hasKey(userId)
    ])

    res.json({
      hasApiKey: hasGeminiKey || hasOllamaKey,
      hasGeminiKey,
      hasOllamaKey,
      activeProvider: hasGeminiKey ? 'gemini' : (hasOllamaKey ? 'ollama' : 'local')
    })
  } catch (error) { next(error) }
}