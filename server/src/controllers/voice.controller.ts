import type { Request, Response, NextFunction } from 'express'
import { GoogleGenAI } from '@google/genai'
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'
import { settings } from '../services/settings.repository.js'
import { speakFor, transcribeFor } from '../services/providers/router.js'
import { extractGeminiTranscription } from '../services/providers/media.js'

const ALLOWED_NEURAL_VOICES = [
  'en-US-JennyNeural',
  'en-US-AriaNeural',
  'en-US-AvaNeural',
  'en-GB-SoniaNeural',
  'en-AU-NatashaNeural'
]

export async function synthesizeSpeech(req: Request, res: Response, next: NextFunction) {
  try {
    const { text, voice = 'en-US-JennyNeural' } = req.body || {}
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({ error: 'Text is required for speech synthesis' })
    }
    if (text.length > 5000) {
      return res.status(413).json({ error: 'Text is too long to read aloud (5000 characters max).' })
    }

    // The user's chosen text-to-speech model (Settings → AI providers).
    const chosen = await speakFor(req.userId!, text.trim(), typeof voice === 'string' ? voice : null)
    if (chosen?.kind === 'browser') {
      return res.status(409).json({ error: 'Your read-aloud voice is set to the browser/phone voice.', useBrowser: true })
    }
    if (chosen?.kind === 'audio') {
      res.setHeader('Content-Type', chosen.audio.mime)
      res.setHeader('Cache-Control', 'private, no-store')
      return res.send(chosen.audio.data)
    }

    const selectedVoice = ALLOWED_NEURAL_VOICES.includes(voice) ? voice : 'en-US-JennyNeural'

    const tts = new MsEdgeTTS()
    await tts.setMetadata(selectedVoice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3)
    const { audioStream } = await tts.toStream(text.trim())

    res.setHeader('Content-Type', 'audio/mpeg')
    // The audio is the user's private note text read aloud.
    res.setHeader('Cache-Control', 'private, no-store')
    audioStream.pipe(res)
  } catch (err) {
    next(err)
  }
}

export async function transcribeAudio(req: Request, res: Response, next: NextFunction) {
  try {
    const buffer = req.body as Buffer
    if (!buffer || buffer.length === 0) {
      return res.status(400).json({ error: 'No audio data provided' })
    }

    const contentType = req.headers['content-type'] || 'audio/webm'
    const mimeType = contentType.split(';')[0].trim()

    // The user's chosen speech-to-text model (Settings → AI providers).
    const chosen = await transcribeFor(req.userId!, buffer, mimeType)
    if (chosen?.kind === 'browser') {
      return res.status(409).json({ error: 'Your dictation is set to the browser/phone speech recognition.', useBrowser: true })
    }
    if (chosen?.kind === 'text') return res.json({ text: chosen.text })
    const geminiKey = await settings.getGeminiKey(req.userId!)

    if (!geminiKey) {
      return res.status(400).json({
        error: 'Gemini API key is required for server-assisted audio transcription. Add your key in Settings or use a browser with native speech recognition.',
        useBrowser: true
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

    const modelsToTry = [
      'gemini-3.5-transcribe',
      'gemini-3.5-flash-lite',
      'gemini-3.5-flash',
      'gemini-3.8-flash',
      'gemini-3.7-flash',
      'gemini-flash-lite-latest'
    ]
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

        const text = extractGeminiTranscription(response)
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
