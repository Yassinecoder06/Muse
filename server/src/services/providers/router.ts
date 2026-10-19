import { createHash } from 'node:crypto'
import { settings } from '../settings.repository.js'
import { baseUrl } from './discovery.js'
import { generate, type GenerateRequest, type GenerateResult } from './llm.js'
import { edgeSpeech, embed, speech, transcribe, type Audio } from './media.js'
import { providerRepository } from './repository.js'
import { parseRef, type ResolvedProvider } from './types.js'

// Turns the user's model choices into calls. Every function returns null when
// the user hasn't chosen a model for that job, so callers keep Muse's previous
// behavior (Gemini cascade, local Ollama, Edge voices) until they do.

export type Route = { ref: string; provider: ResolvedProvider; model: string }

async function routeFor(userId: string, ref: string | null | undefined): Promise<Route | null> {
  if (!ref) return null
  const parsed = parseRef(ref)
  if (!parsed) return null
  const { providers } = await providerRepository.resolved(userId)
  const provider = providers.find(p => p.id === parsed.providerId)
  return provider ? { ref, provider, model: parsed.model } : null
}

/** Chat routes in order: an explicitly requested model first, then defaults + fallbacks. */
export async function chatRoutes(userId: string, requested?: string): Promise<Route[]> {
  const { prefs } = await providerRepository.resolved(userId)
  const refs = [...new Set([...(requested ? [requested] : []), ...prefs.chat])]
  const routes = await Promise.all(refs.map(ref => routeFor(userId, ref)))
  return routes.filter((r): r is Route => r !== null)
}

function logUsage(userId: string, route: Route, taskType: string, result: GenerateResult) {
  if (!result.usage) return
  void settings.logAiUsage({
    userId,
    provider: route.provider.kind,
    model: route.model,
    taskType,
    promptTokens: result.usage.input,
    candidateTokens: result.usage.output,
    totalTokens: result.usage.input + result.usage.output
  })
}

/** Tries each route in order; throws the last error if all fail. */
export async function generateChain(userId: string, routes: Route[], req: GenerateRequest, taskType = 'chat'): Promise<{ result: GenerateResult; route: Route }> {
  let lastError: unknown = new Error('No chat model is configured.')
  for (const route of routes) {
    try {
      const result = await generate(route.provider, route.model, req)
      logUsage(userId, route, taskType, result)
      return { result, route }
    } catch (error) {
      lastError = error
      console.warn(`[providers] ${route.provider.name} / ${route.model} failed, trying the next model: ${(error as Error).message}`)
    }
  }
  throw lastError
}

/** Plain text generation through the user's chat models, or null if none are chosen / all failed. */
export async function generateText(userId: string, req: GenerateRequest, requested?: string, taskType = 'general'): Promise<string | null> {
  const routes = await chatRoutes(userId, requested)
  if (!routes.length) return null
  try {
    return (await generateChain(userId, routes, req, taskType)).result.text
  } catch {
    return null // caller falls back to Muse's built-in routing
  }
}

// ------------------------------------------------------------- Embeddings

/**
 * Which vector space notes live in. Different embedding models make
 * incompatible vectors, so each model gets its own Qdrant collection. The
 * identity uses the provider address + model (not the provider id), so
 * removing and re-adding the same provider keeps the index.
 */
export async function embeddingIdentity(userId: string): Promise<string | null> {
  const { prefs } = await providerRepository.resolved(userId)
  const route = await routeFor(userId, prefs.embedding)
  if (!route) return null
  return `${route.provider.kind}|${baseUrl(route.provider)}|${route.model}`
}

export const collectionName = (identity: string | null) =>
  identity ? `notes_${createHash('sha256').update(identity).digest('hex').slice(0, 12)}` : 'notes'

export async function embedFor(userId: string, text: string): Promise<number[] | null> {
  const { prefs } = await providerRepository.resolved(userId)
  const route = await routeFor(userId, prefs.embedding)
  return route ? embed(route.provider, route.model, text) : null
}

// ------------------------------------------------------------------ Voice

export type SpeechChoice = { kind: 'browser' } | { kind: 'audio'; audio: Audio } | null

export async function speakFor(userId: string, text: string, voiceOverride?: string | null): Promise<SpeechChoice> {
  const { prefs } = await providerRepository.resolved(userId)
  if (!prefs.tts) return null
  if (prefs.tts === 'builtin:browser') return { kind: 'browser' }
  if (prefs.tts === 'builtin:edge') return { kind: 'audio', audio: await edgeSpeech(text, voiceOverride || prefs.tts_voice) }
  const route = await routeFor(userId, prefs.tts)
  if (!route) return null
  return { kind: 'audio', audio: await speech(route.provider, route.model, text, prefs.tts_voice) }
}

export type TranscriptChoice = { kind: 'browser' } | { kind: 'text'; text: string } | null

export async function transcribeFor(userId: string, audio: Buffer, mime: string): Promise<TranscriptChoice> {
  const { prefs } = await providerRepository.resolved(userId)
  if (!prefs.stt) return null
  if (prefs.stt === 'builtin:browser') return { kind: 'browser' }
  const route = await routeFor(userId, prefs.stt)
  if (!route) return null
  return { kind: 'text', text: await transcribe(route.provider, route.model, audio, mime) }
}

export { routeFor }
