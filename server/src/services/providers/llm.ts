import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenAI } from '@google/genai'
import { baseUrl } from './discovery.js'
import type { ResolvedProvider } from './types.js'
import { env } from '../../utils/env.js'

// One chat interface over every provider format: Gemini, OpenAI-style
// (OpenAI and compatibles), Anthropic (and compatibles), and Ollama.
// Tool calls are normalized so Bip's agent loop works on any chat model.

export type ToolCall = { id: string; name: string; args: Record<string, any> }

export type ChatMessage =
  | { role: 'user'; content: string; images?: Array<{ mimeType: string; data: string }> }
  // `raw` keeps the provider's own assistant content (Gemini thought
  // signatures, Anthropic thinking blocks) so it can be sent back unchanged
  // within the same tool loop.
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[]; raw?: { kind: string; value: unknown } }
  | { role: 'tool'; toolCallId: string; name: string; content: string }

/** Tool definition in Gemini style (uppercase types), as agent-tools declares them. */
export type ToolSpec = { name: string; description: string; parameters: Record<string, any> }

export type GenerateRequest = { system?: string; messages: ChatMessage[]; tools?: ToolSpec[]; maxTokens?: number; timeoutMs?: number }
export type GenerateResult = { text: string; toolCalls: ToolCall[]; raw?: { kind: string; value: unknown }; usage?: { input: number; output: number } }

export class ProviderCallError extends Error {
  constructor(message: string, public status?: number) { super(message) }
}

const DEFAULT_TIMEOUT_MS = 120_000
let callCounter = 0
const newCallId = () => `call_${Date.now().toString(36)}_${(callCounter++).toString(36)}`

/** Gemini-style schema ("OBJECT", "STRING") → JSON Schema ("object", "string"). */
export function toJsonSchema(schema: any): any {
  if (Array.isArray(schema)) return schema.map(toJsonSchema)
  if (!schema || typeof schema !== 'object') return schema
  const out: Record<string, any> = {}
  for (const [key, value] of Object.entries(schema)) {
    out[key] = key === 'type' && typeof value === 'string' ? value.toLowerCase() : toJsonSchema(value)
  }
  return out
}

const parseArgs = (value: unknown): Record<string, any> => {
  if (value && typeof value === 'object') return value as Record<string, any>
  if (typeof value !== 'string' || !value.trim()) return {}
  try { return JSON.parse(value) } catch { return { _invalid_json: value } }
}

async function httpJson(url: string, init: RequestInit & { timeoutMs?: number }): Promise<any> {
  let response: Response
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(init.timeoutMs ?? DEFAULT_TIMEOUT_MS) })
  } catch (error) {
    throw new ProviderCallError(`Could not reach ${new URL(url).host} (${(error as Error).name === 'TimeoutError' ? 'timed out' : 'network error'}).`)
  }
  const text = await response.text()
  if (!response.ok) {
    let detail = text.slice(0, 300)
    try { const body = JSON.parse(text); detail = body.error?.message || body.error || body.message || detail } catch { /* keep text */ }
    throw new ProviderCallError(`${new URL(url).host} ${response.status}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`, response.status)
  }
  try { return JSON.parse(text) } catch { throw new ProviderCallError(`${new URL(url).host} returned invalid JSON.`) }
}

// ---------------------------------------------------------------- Gemini

async function geminiGenerate(p: ResolvedProvider, model: string, req: GenerateRequest): Promise<GenerateResult> {
  const client = new GoogleGenAI({ apiKey: p.apiKey || '' })
  const contents: any[] = []
  for (const m of req.messages) {
    if (m.role === 'user') {
      const parts: any[] = []
      if (m.images && m.images.length > 0) {
        for (const img of m.images) {
          parts.push({
            inlineData: {
              mimeType: img.mimeType || 'image/png',
              data: img.data
            }
          })
        }
      }
      parts.push({ text: m.content })
      contents.push({ role: 'user', parts })
    }
    else if (m.role === 'assistant') {
      if (m.raw?.kind === 'gemini') contents.push({ role: 'model', parts: m.raw.value })
      else {
        const parts: any[] = []
        if (m.content) parts.push({ text: m.content })
        for (const call of m.toolCalls || []) parts.push({ functionCall: { name: call.name, args: call.args } })
        if (parts.length) contents.push({ role: 'model', parts })
      }
    } else {
      const part = { functionResponse: { name: m.name, response: safeJson(m.content) } }
      const last = contents[contents.length - 1]
      // Consecutive tool results belong in one user turn.
      if (last?.role === 'user' && last.parts.every((x: any) => x.functionResponse)) last.parts.push(part)
      else contents.push({ role: 'user', parts: [part] })
    }
  }
  try {
    const response: any = await client.models.generateContent({
      model,
      contents,
      config: {
        ...(req.system ? { systemInstruction: req.system } : {}),
        ...(req.tools?.length ? { tools: [{ functionDeclarations: req.tools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters })) }] } : {}),
        httpOptions: { timeout: req.timeoutMs ?? DEFAULT_TIMEOUT_MS }
      }
    })
    const parts: any[] = response.candidates?.[0]?.content?.parts || []
    const toolCalls = parts.filter(x => x.functionCall).map(x => ({ id: newCallId(), name: x.functionCall.name, args: x.functionCall.args || {} }))
    const text = parts.filter(x => typeof x.text === 'string' && !x.thought).map(x => x.text).join('').trim()
    return {
      text,
      toolCalls,
      raw: parts.length ? { kind: 'gemini', value: parts } : undefined,
      usage: { input: response.usageMetadata?.promptTokenCount || 0, output: response.usageMetadata?.candidatesTokenCount || 0 }
    }
  } catch (error: any) {
    throw new ProviderCallError(`Gemini: ${String(error?.message || error).slice(0, 300)}`, error?.status)
  }
}

function safeJson(text: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text)
    return value && typeof value === 'object' && !Array.isArray(value) ? value : { result: value }
  } catch {
    return { result: text }
  }
}

// ---------------------------------------------------------- OpenAI-style

async function openAiGenerate(p: ResolvedProvider, model: string, req: GenerateRequest): Promise<GenerateResult> {
  const messages: any[] = []
  if (req.system) messages.push({ role: 'system', content: req.system })
  for (const m of req.messages) {
    if (m.role === 'user') {
      if (m.images && m.images.length > 0) {
        const parts: any[] = []
        if (m.content) parts.push({ type: 'text', text: m.content })
        for (const img of m.images) {
          parts.push({
            type: 'image_url',
            image_url: {
              url: `data:${img.mimeType || 'image/png'};base64,${img.data}`
            }
          })
        }
        messages.push({ role: 'user', content: parts })
      } else {
        messages.push({ role: 'user', content: m.content })
      }
    }
    else if (m.role === 'assistant') {
      messages.push({
        role: 'assistant',
        content: m.content || null,
        ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) } : {})
      })
    } else messages.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content })
  }
  const data = await httpJson(`${baseUrl(p)}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {}) },
    body: JSON.stringify({
      model,
      messages,
      ...(req.tools?.length ? { tools: req.tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: toJsonSchema(t.parameters) } })) } : {})
    }),
    timeoutMs: req.timeoutMs
  })
  const message = data.choices?.[0]?.message || {}
  const toolCalls = (message.tool_calls || []).map((c: any) => ({ id: c.id || newCallId(), name: c.function?.name, args: parseArgs(c.function?.arguments) }))
  return { text: String(message.content || '').trim(), toolCalls, usage: { input: data.usage?.prompt_tokens || 0, output: data.usage?.completion_tokens || 0 } }
}

// --------------------------------------------------------------- Anthropic

async function anthropicGenerate(p: ResolvedProvider, model: string, req: GenerateRequest): Promise<GenerateResult> {
  const client = new Anthropic({ apiKey: p.apiKey || '', baseURL: baseUrl(p), timeout: req.timeoutMs ?? DEFAULT_TIMEOUT_MS, maxRetries: 1 })
  const messages: Anthropic.MessageParam[] = []
  for (const m of req.messages) {
    if (m.role === 'user') {
      if (m.images && m.images.length > 0) {
        const content: Anthropic.ContentBlockParam[] = []
        for (const img of m.images) {
          content.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: (img.mimeType || 'image/png') as any,
              data: img.data
            }
          })
        }
        if (m.content) content.push({ type: 'text', text: m.content })
        messages.push({ role: 'user', content })
      } else {
        messages.push({ role: 'user', content: m.content })
      }
    }
    else if (m.role === 'assistant') {
      if (m.raw?.kind === 'anthropic') messages.push({ role: 'assistant', content: m.raw.value as Anthropic.ContentBlockParam[] })
      else {
        const content: Anthropic.ContentBlockParam[] = []
        if (m.content) content.push({ type: 'text', text: m.content })
        for (const c of m.toolCalls || []) content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args })
        if (content.length) messages.push({ role: 'assistant', content })
      }
    } else {
      const block: Anthropic.ToolResultBlockParam = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content }
      const last = messages[messages.length - 1]
      // All results for one assistant turn go back in a single user message.
      if (last?.role === 'user' && Array.isArray(last.content) && last.content.every(b => b.type === 'tool_result')) (last.content as Anthropic.ContentBlockParam[]).push(block)
      else messages.push({ role: 'user', content: [block] })
    }
  }
  try {
    const response = await client.messages.create({
      model,
      max_tokens: req.maxTokens ?? 16000,
      ...(req.system ? { system: req.system } : {}),
      ...(req.tools?.length ? { tools: req.tools.map(t => ({ name: t.name, description: t.description, input_schema: toJsonSchema(t.parameters) as Anthropic.Tool.InputSchema })) } : {}),
      messages
    })
    if (response.stop_reason === 'refusal') throw new ProviderCallError(`${model} declined this request.`)
    const toolCalls = response.content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      .map(b => ({ id: b.id, name: b.name, args: (b.input || {}) as Record<string, any> }))
    const text = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('').trim()
    return { text, toolCalls, raw: { kind: 'anthropic', value: response.content }, usage: { input: response.usage.input_tokens, output: response.usage.output_tokens } }
  } catch (error) {
    if (error instanceof ProviderCallError) throw error
    if (error instanceof Anthropic.APIError) throw new ProviderCallError(`Anthropic ${error.status ?? ''}: ${error.message}`.trim(), error.status)
    throw error
  }
}

// ------------------------------------------------------------------ Ollama

async function ollamaGenerate(p: ResolvedProvider, model: string, req: GenerateRequest): Promise<GenerateResult> {
  const messages: any[] = []
  if (req.system) messages.push({ role: 'system', content: req.system })
  for (const m of req.messages) {
    if (m.role === 'user') {
      if (m.images && m.images.length > 0) {
        messages.push({
          role: 'user',
          content: m.content,
          images: m.images.map(img => img.data)
        })
      } else {
        messages.push({ role: 'user', content: m.content })
      }
    }
    else if (m.role === 'assistant') messages.push({ role: 'assistant', content: m.content, ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map(c => ({ function: { name: c.name, arguments: c.args } })) } : {}) })
    else messages.push({ role: 'tool', content: m.content, tool_name: m.name })
  }
  const data = await httpJson(`${baseUrl(p)}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {}) },
    body: JSON.stringify({
      model,
      stream: false,
      messages,
      ...(req.tools?.length ? { tools: req.tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: toJsonSchema(t.parameters) } })) } : {}),
      options: { num_ctx: env.OLLAMA_NUM_CTX || 32768 }
    }),
    timeoutMs: req.timeoutMs
  })
  const message = data.message || {}
  const toolCalls = (message.tool_calls || []).map((c: any) => ({ id: newCallId(), name: c.function?.name, args: parseArgs(c.function?.arguments) }))
  return { text: String(message.content || '').trim(), toolCalls, usage: { input: data.prompt_eval_count || 0, output: data.eval_count || 0 } }
}

export function generate(p: ResolvedProvider, model: string, req: GenerateRequest): Promise<GenerateResult> {
  switch (p.kind) {
    case 'gemini': return geminiGenerate(p, model, req)
    case 'openai':
    case 'openai_compatible': return openAiGenerate(p, model, req)
    case 'anthropic':
    case 'anthropic_compatible': return anthropicGenerate(p, model, req)
    case 'ollama_cloud':
    case 'ollama_local': return ollamaGenerate(p, model, req)
  }
}
