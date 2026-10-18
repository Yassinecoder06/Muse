import type { Request, Response, NextFunction } from 'express'
import { GoogleGenAI } from '@google/genai'
import { settings } from '../services/settings.repository.js'

export async function transcribeAudio(req: Request, res: Response, next: NextFunction) {
  try {
    const buffer = req.body as Buffer
    if (!buffer || buffer.length === 0) {
      return res.status(400).json({ error: 'No audio data provided' })
    }

    const contentType = req.headers['content-type'] || 'audio/webm'
    const mimeType = contentType.split(';')[0].trim()
    const geminiKey = await settings.getGeminiKey(req.userId!)

    if (!geminiKey) {
      return res.status(400).json({
        error: 'Gemini API key is required for server-assisted audio transcription. Add your key in Settings or use a browser with native speech recognition.'
      })
    }

    const client = new GoogleGenAI({ apiKey: geminiKey })
    const base64Data = buffer.toString('base64')

    const response = await client.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType,
                data: base64Data
              }
            },
            {
              text: 'Transcribe the spoken English speech verbatim. Return ONLY the transcription with appropriate punctuation and capitalization. Do not include introductory notes, timestamps, explanations, or quotes.'
            }
          ]
        }
      ]
    })

    const text = String(response.text || '').trim()
    return res.json({ text })
  } catch (err) {
    next(err)
  }
}
