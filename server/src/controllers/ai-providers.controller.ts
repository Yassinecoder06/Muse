import type { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { providerRepository } from '../services/providers/repository.js'
import { BUILTIN_MODELS, discoverModels, DiscoveryError, localOllamaUrl } from '../services/providers/discovery.js'
import { generate } from '../services/providers/llm.js'
import { embed, speech, VOICE_SUGGESTIONS, edgeSpeech } from '../services/providers/media.js'
import { routeFor } from '../services/providers/router.js'
import { vectors } from '../services/vector.service.js'
import { KIND_LABEL, NEEDS_KEY, PROVIDER_KINDS, makeRef, type Capability, type Provider, type ProviderKind } from '../services/providers/types.js'

const user = (req: Request) => req.userId!

// Base URLs are user-supplied. Private addresses are allowed on purpose (local
// Ollama, LM Studio or vLLM on the LAN), but Muse's own internal services are
// never valid AI endpoints and must not become reachable through this.
const INTERNAL_HOSTS = new Set(['db', 'postgres', 'kong', 'rest', 'auth', 'realtime', 'storage', 'meta', 'studio', 'qdrant', 'server', 'nginx', 'supabase', 'mailer-templates', 'migrate'])

function validBaseUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  let url: URL
  try { url = new URL(raw.trim()) } catch { throw Object.assign(new Error('That base URL is not a valid address.'), { statusCode: 400 }) }
  if (!['http:', 'https:'].includes(url.protocol)) throw Object.assign(new Error('The base URL must start with http:// or https://.'), { statusCode: 400 })
  if (INTERNAL_HOSTS.has(url.hostname.toLowerCase())) throw Object.assign(new Error('That address belongs to Muse itself, not an AI provider.'), { statusCode: 400 })
  return url.toString().replace(/\/+$/, '')
}

const publicProvider = (p: Provider) => ({
  id: p.id, kind: p.kind, kindLabel: KIND_LABEL[p.kind], name: p.name, baseUrl: p.base_url, enabled: p.enabled,
  hasKey: Boolean(p.key_hint), keyHint: p.key_hint, needsKey: NEEDS_KEY[p.kind],
  models: p.models, lastFetchedAt: p.last_fetched_at, lastError: p.last_error
})

/** Every usable model across providers + built-ins, as refs the defaults can point to. */
function catalog(providers: Provider[]) {
  const models = providers.filter(p => p.enabled).flatMap(p => p.models.map(m => ({
    ref: makeRef(p.id, m.id), providerId: p.id, providerName: p.name, kind: p.kind, model: m.id, label: m.label || m.id, capabilities: m.capabilities
  })))
  const builtins = BUILTIN_MODELS.map(b => ({ ref: b.ref, providerId: 'builtin', providerName: 'Built-in', kind: 'builtin', model: b.ref.slice(8), label: b.label, capabilities: [b.capability], description: b.description }))
  return [...models, ...builtins]
}

async function state(userId: string) {
  await providerRepository.importLegacy(userId)
  const [providers, preferences] = await Promise.all([providerRepository.list(userId), providerRepository.preferences(userId)])
  return {
    providers: providers.map(publicProvider),
    preferences: { chat: preferences.chat, embedding: preferences.embedding, tts: preferences.tts, ttsVoice: preferences.tts_voice, stt: preferences.stt },
    catalog: catalog(providers),
    kinds: PROVIDER_KINDS.map(kind => ({ kind, label: KIND_LABEL[kind], needsKey: NEEDS_KEY[kind], needsBaseUrl: kind.endsWith('_compatible'), defaultBaseUrl: kind === 'ollama_local' ? localOllamaUrl() : null })),
    voices: VOICE_SUGGESTIONS,
    reindex: vectors.reindexStatus(userId)
  }
}

async function fetchOne(userId: string, provider: Provider) {
  const apiKey = await providerRepository.apiKey(provider.id).catch(() => null)
  try {
    const models = await discoverModels({ ...provider, apiKey })
    await providerRepository.saveModels(userId, provider.id, models, null)
  } catch (error) {
    const message = error instanceof DiscoveryError ? error.message : `Fetching models failed: ${(error as Error).message}`
    await providerRepository.saveModels(userId, provider.id, [], message)
  }
}

export async function getProviders(req: Request, res: Response, next: NextFunction) {
  try { res.json(await state(user(req))) } catch (error) { next(error) }
}

const createSchema = z.object({
  kind: z.enum(PROVIDER_KINDS),
  name: z.string().trim().max(60).optional(),
  baseUrl: z.string().trim().max(300).optional().nullable(),
  apiKey: z.string().trim().max(400).optional().nullable()
})

export async function createProvider(req: Request, res: Response, next: NextFunction) {
  try {
    const body = createSchema.parse(req.body)
    const kind = body.kind as ProviderKind
    if (kind.endsWith('_compatible') && !body.baseUrl) return res.status(400).json({ error: 'Give the base URL of the API (for example https://api.groq.com/openai/v1).' })
    if (kind.endsWith('_compatible') && !body.name) return res.status(400).json({ error: 'Give this provider a name (for example "Groq").' })
    if (NEEDS_KEY[kind] && !body.apiKey) return res.status(400).json({ error: 'This provider needs an API key.' })
    // Empty = the kind's default (local Ollama resolves its address at call time).
    const baseUrl = validBaseUrl(body.baseUrl || null)
    const created = await providerRepository.create(user(req), { kind, name: body.name || KIND_LABEL[kind], base_url: baseUrl, apiKey: body.apiKey || null })
    await fetchOne(user(req), created) // validates the key right away
    res.status(201).json(await state(user(req)))
  } catch (error) { next(error) }
}

export async function updateProvider(req: Request, res: Response, next: NextFunction) {
  try {
    const id = z.string().uuid().parse(req.params.id)
    const body = z.object({
      name: z.string().trim().min(1).max(60).optional(),
      baseUrl: z.string().trim().max(300).optional().nullable(),
      apiKey: z.string().trim().min(1).max(400).optional(),
      enabled: z.boolean().optional()
    }).parse(req.body)
    const updated = await providerRepository.update(user(req), id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.baseUrl !== undefined ? { base_url: validBaseUrl(body.baseUrl) } : {}),
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      ...(body.apiKey ? { apiKey: body.apiKey } : {})
    })
    if (body.apiKey || body.baseUrl !== undefined) await fetchOne(user(req), updated)
    res.json(await state(user(req)))
  } catch (error) { next(error) }
}

export async function deleteProvider(req: Request, res: Response, next: NextFunction) {
  try {
    await providerRepository.remove(user(req), z.string().uuid().parse(req.params.id))
    res.json(await state(user(req)))
  } catch (error) { next(error) }
}

/** "Fetch models": asks every enabled provider (or one) what it offers now. */
export async function fetchModels(req: Request, res: Response, next: NextFunction) {
  try {
    const only = z.object({ providerId: z.string().uuid().optional() }).parse(req.body || {}).providerId
    const providers = (await providerRepository.list(user(req))).filter(p => p.enabled && (!only || p.id === only))
    await Promise.all(providers.map(p => fetchOne(user(req), p)))
    res.json(await state(user(req)))
  } catch (error) { next(error) }
}

const refSchema = z.string().trim().min(3).max(300)

export async function savePreferences(req: Request, res: Response, next: NextFunction) {
  try {
    const body = z.object({
      chat: z.array(refSchema).max(10),
      embedding: refSchema.nullable(),
      tts: refSchema.nullable(),
      ttsVoice: z.string().trim().max(80).nullable(),
      stt: refSchema.nullable()
    }).parse(req.body)
    const providers = await providerRepository.list(user(req))
    const available = catalog(providers)
    const check = (ref: string | null, capability: Capability) => {
      if (ref && !available.some(m => m.ref === ref && m.capabilities.includes(capability))) {
        throw Object.assign(new Error(`"${ref}" is not an available ${capability} model. Fetch models and pick again.`), { statusCode: 400 })
      }
    }
    body.chat.forEach(ref => check(ref, 'chat'))
    check(body.embedding, 'embedding')
    check(body.tts, 'tts')
    check(body.stt, 'stt')

    const previous = await providerRepository.preferences(user(req))
    await providerRepository.savePreferences(user(req), { chat: body.chat, embedding: body.embedding, tts: body.tts, tts_voice: body.ttsVoice, stt: body.stt })
    // New embedding model = new vector space: rebuild the index in the background.
    if ((previous.embedding || null) !== (body.embedding || null)) void vectors.reindexUser(user(req))
    res.json(await state(user(req)))
  } catch (error) { next(error) }
}

/** Quick check that a chosen model actually answers with this key. */
export async function testModel(req: Request, res: Response, next: NextFunction) {
  try {
    const { ref, capability } = z.object({ ref: refSchema, capability: z.enum(['chat', 'embedding', 'tts', 'stt']) }).parse(req.body)
    const started = Date.now()
    const ok = (detail: string) => res.json({ ok: true, detail, ms: Date.now() - started })
    try {
      if (ref === 'builtin:browser') return ok('Runs in your browser or phone; nothing to test on the server.')
      if (ref === 'builtin:edge') {
        const audio = await edgeSpeech('Beep boop, this is Bip.')
        return ok(`Spoke a test sentence (${Math.round(audio.data.length / 1024)} KB).`)
      }
      if (ref === 'builtin:default') return ok('Uses the embedding model found on local Ollama.')
      const route = await routeFor(user(req), ref)
      if (!route) return res.status(400).json({ ok: false, error: 'That model is not available. Fetch models and pick again.' })
      if (capability === 'chat') {
        const result = await generate(route.provider, route.model, { messages: [{ role: 'user', content: 'Reply with exactly: OK' }], maxTokens: 512, timeoutMs: 45_000 })
        return ok(`Answered: "${result.text.slice(0, 60)}"`)
      }
      if (capability === 'embedding') return ok(`Returned a ${(await embed(route.provider, route.model, 'Muse test')).length}-dimension vector.`)
      if (capability === 'tts') {
        const audio = await speech(route.provider, route.model, 'Beep boop, this is Bip.', req.body?.voice || null)
        return ok(`Spoke a test sentence (${Math.round(audio.data.length / 1024)} KB).`)
      }
      return ok('Speech-to-text is tested by dictating: tap the mic anywhere in Muse.')
    } catch (error) {
      res.json({ ok: false, error: (error as Error).message, ms: Date.now() - started })
    }
  } catch (error) { next(error) }
}

export async function reindexStatus(req: Request, res: Response) {
  res.json(vectors.reindexStatus(user(req)))
}
