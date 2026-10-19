import { GoogleGenAI } from '@google/genai'
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'
import { baseUrl } from './discovery.js'
import { ProviderCallError } from './llm.js'
import type { ResolvedProvider } from './types.js'

// Embeddings, text-to-speech and speech-to-text across providers.

const TIMEOUT_MS = 60_000

async function postJson(url: string, apiKey: string | null, body: unknown): Promise<Response> {
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  } catch {
    throw new ProviderCallError(`Could not reach ${new URL(url).host}.`)
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new ProviderCallError(`${new URL(url).host} ${response.status}: ${text.slice(0, 300)}`, response.status)
  }
  return response
}

// ------------------------------------------------------------- Embeddings

export async function embed(p: ResolvedProvider, model: string, text: string): Promise<number[]> {
  const input = text.slice(0, 8000)
  switch (p.kind) {
    case 'ollama_local':
    case 'ollama_cloud': {
      const data: any = await (await postJson(`${baseUrl(p)}/api/embed`, p.apiKey, { model, input })).json()
      const vector = data.embeddings?.[0] || data.embedding
      if (Array.isArray(vector)) return vector
      break
    }
    case 'openai':
    case 'openai_compatible': {
      const data: any = await (await postJson(`${baseUrl(p)}/embeddings`, p.apiKey, { model, input })).json()
      const vector = data.data?.[0]?.embedding
      if (Array.isArray(vector)) return vector
      break
    }
    case 'gemini': {
      const client = new GoogleGenAI({ apiKey: p.apiKey || '' })
      const response = await client.models.embedContent({ model, contents: input })
      const vector = response.embeddings?.[0]?.values
      if (Array.isArray(vector)) return vector
      break
    }
    default:
      throw new ProviderCallError(`${p.name} has no embedding models.`)
  }
  throw new ProviderCallError(`${model} returned no embedding.`)
}

// ---------------------------------------------------------- Text to speech

export const EDGE_VOICES = ['en-US-JennyNeural', 'en-US-AriaNeural', 'en-US-AvaNeural', 'en-US-GuyNeural', 'en-GB-SoniaNeural', 'en-AU-NatashaNeural', 'fr-FR-DeniseNeural', 'ar-TN-ReemNeural']

/** Suggested voices per provider kind (users can also type any voice name). */
export const VOICE_SUGGESTIONS: Record<string, string[]> = {
  edge: EDGE_VOICES,
  openai: ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'],
  gemini: ['Kore', 'Puck', 'Charon', 'Zephyr', 'Fenrir', 'Leda', 'Aoede', 'Callirrhoe']
}

export type Audio = { data: Buffer; mime: string }

/** 16-bit little-endian mono PCM → WAV (Gemini TTS returns raw PCM). */
export function pcmToWav(pcm: Buffer, sampleRate = 24000): Buffer {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16) // PCM chunk size
  header.writeUInt16LE(1, 20) // PCM format
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28) // byte rate
  header.writeUInt16LE(2, 32) // block align
  header.writeUInt16LE(16, 34) // bits per sample
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

export async function edgeSpeech(text: string, voice?: string | null): Promise<Audio> {
  const tts = new MsEdgeTTS()
  await tts.setMetadata(voice && /Neural$/.test(voice) ? voice : 'en-US-JennyNeural', OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3)
  const { audioStream } = await tts.toStream(text)
  const chunks: Buffer[] = []
  for await (const chunk of audioStream) chunks.push(Buffer.from(chunk))
  return { data: Buffer.concat(chunks), mime: 'audio/mpeg' }
}

export async function speech(p: ResolvedProvider, model: string, text: string, voice?: string | null): Promise<Audio> {
  switch (p.kind) {
    case 'openai':
    case 'openai_compatible': {
      const response = await postJson(`${baseUrl(p)}/audio/speech`, p.apiKey, { model, input: text, voice: voice || 'alloy', response_format: 'mp3' })
      return { data: Buffer.from(await response.arrayBuffer()), mime: response.headers.get('content-type') || 'audio/mpeg' }
    }
    case 'gemini': {
      const client = new GoogleGenAI({ apiKey: p.apiKey || '' })
      const response: any = await client.models.generateContent({
        model,
        contents: text,
        config: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice || 'Kore' } } } }
      })
      const inline = response.candidates?.[0]?.content?.parts?.find((part: any) => part.inlineData?.data)?.inlineData
      if (!inline) throw new ProviderCallError(`${model} returned no audio.`)
      const rate = Number(/rate=(\d+)/.exec(inline.mimeType || '')?.[1]) || 24000
      return { data: pcmToWav(Buffer.from(inline.data, 'base64'), rate), mime: 'audio/wav' }
    }
    default:
      throw new ProviderCallError(`${p.name} has no text-to-speech models.`)
  }
}

// ---------------------------------------------------------- Speech to text

const TRANSCRIBE_PROMPT = 'Transcribe the spoken audio verbatim. Output only the transcription: no quotes, labels, timestamps or notes. If there is no speech, output nothing.'

export function extractGeminiTranscription(response: any): string {
  if (!response) return ''

  const parts = response.candidates?.[0]?.content?.parts
  if (Array.isArray(parts) && parts.length > 0) {
    const pieces: string[] = []
    for (const part of parts) {
      if (typeof part.text === 'string' && !part.thought && part.text.trim()) {
        pieces.push(part.text.trim())
      } else if (part.audioTranscription && typeof part.audioTranscription.text === 'string' && part.audioTranscription.text.trim()) {
        pieces.push(part.audioTranscription.text.trim())
      }
    }
    if (pieces.length > 0) {
      return pieces.join(' ').trim().replace(/^["']|["']$/g, '')
    }
  }

  try {
    const text = String(response.text || '').trim().replace(/^["']|["']$/g, '')
    if (text) return text
  } catch {}

  return ''
}

export async function transcribe(p: ResolvedProvider, model: string, audio: Buffer, mime: string): Promise<string> {
  switch (p.kind) {
    case 'openai':
    case 'openai_compatible': {
      const extension = /webm/.test(mime) ? 'webm' : /ogg/.test(mime) ? 'ogg' : /wav/.test(mime) ? 'wav' : /mp4|m4a|aac/.test(mime) ? 'm4a' : 'mp3'
      const form = new FormData()
      form.append('file', new Blob([new Uint8Array(audio)], { type: mime }), `audio.${extension}`)
      form.append('model', model)
      let response: Response
      try {
        response = await fetch(`${baseUrl(p)}/audio/transcriptions`, {
          method: 'POST',
          headers: p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {},
          body: form,
          signal: AbortSignal.timeout(TIMEOUT_MS)
        })
      } catch {
        throw new ProviderCallError(`Could not reach ${new URL(baseUrl(p)).host}.`)
      }
      if (!response.ok) throw new ProviderCallError(`${new URL(baseUrl(p)).host} ${response.status}: ${(await response.text()).slice(0, 300)}`, response.status)
      const data: any = await response.json()
      return String(data.text || '').trim()
    }
    case 'gemini': {
      const client = new GoogleGenAI({ apiKey: p.apiKey || '' })
      const modelsToTry = [model, 'gemini-3.5-transcribe', 'gemini-3.5-flash-lite', 'gemini-3.5-flash'].filter((m, i, arr) => arr.indexOf(m) === i)
      let lastErr: unknown = null
      for (const m of modelsToTry) {
        try {
          const response = await client.models.generateContent({
            model: m,
            contents: [{ role: 'user', parts: [{ inlineData: { mimeType: mime, data: audio.toString('base64') } }, { text: TRANSCRIBE_PROMPT }] }]
          })
          const extracted = extractGeminiTranscription(response)
          return extracted
        } catch (err) {
          lastErr = err
          console.warn(`[Gemini STT] Model ${m} failed, trying next:`, (err as Error)?.message || err)
        }
      }
      throw lastErr || new ProviderCallError('Gemini speech transcription failed.')
    }
    default:
      throw new ProviderCallError(`${p.name} has no speech-to-text models.`)
  }
}
