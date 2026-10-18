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

    const transcriptionPrompt = `You are a professional, high-accuracy speech-to-text transcription engine.
Transcribe the spoken audio verbatim into natural English text.

Rules:
1. Output ONLY the raw transcription without any quotes, preamble, notes, timestamps, speaker labels, or markdown formatting.
2. Accurately transcribe spoken words, math expressions, numbers, and technical terms.
3. Automatically apply correct punctuation and natural capitalization.
4. If the audio is completely silent or contains only background noise, respond with an empty string.`

    const modelsToTry = ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.7-flash']
    let transcribedText = ''
    let lastError: unknown = null

    for (const modelName of modelsToTry) {
      try {
        const response = await client.models.generateContent({
          model: modelName,
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
                  text: transcriptionPrompt
                }
              ]
            }
          ]
        })

        let text = String(response.text || '').trim()
        if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
          text = text.slice(1, -1).trim()
        }

        transcribedText = text

        // Log usage in background
        void settings.logAiUsage({
          userId: req.userId!,
          provider: 'gemini',
          model: modelName,
          taskType: 'transcribe',
          promptTokens: response.usageMetadata?.promptTokenCount || 50,
          candidateTokens: response.usageMetadata?.candidatesTokenCount || 20,
          totalTokens: response.usageMetadata?.totalTokenCount || 70
        }).catch(() => {})

        break
      } catch (err) {
        lastError = err
        console.warn(`[Voice STT] Model ${modelName} failed, attempting next in cascade:`, err)
      }
    }

    if (!transcribedText && lastError) {
      throw lastError
    }

    return res.json({ text: transcribedText })
  } catch (err) {
    next(err)
  }
}
