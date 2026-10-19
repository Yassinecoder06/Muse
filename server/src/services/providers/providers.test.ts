import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyGeminiModel, classifyOpenAiModel } from './discovery.js'
import { generate, toJsonSchema, type ChatMessage } from './llm.js'
import { pcmToWav } from './media.js'
import { parseRef, type ResolvedProvider } from './types.js'

const provider = (kind: ResolvedProvider['kind'], base_url: string | null = null): ResolvedProvider => ({
  id: '11111111-1111-1111-1111-111111111111', user_id: 'u', kind, name: kind, base_url, enabled: true, models: [], last_fetched_at: null, last_error: null, key_hint: null, apiKey: 'sk-test'
})

/** Replaces fetch for one test: records requests, answers with `respond`. */
function fakeFetch(respond: (url: string, body: any, init: RequestInit) => unknown) {
  const calls: { url: string; body: any; headers: Record<string, string> }[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = typeof input === 'string' ? input : input.url
    const body = init.body ? JSON.parse(init.body) : undefined
    const headers = Object.fromEntries(new Headers(init.headers).entries())
    calls.push({ url, body, headers })
    return new Response(JSON.stringify(respond(url, body, init)), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  return { calls, restore: () => { globalThis.fetch = original } }
}

const weatherTool = { name: 'get_weather', description: 'Weather for a city', parameters: { type: 'OBJECT', properties: { city: { type: 'STRING' } }, required: ['city'] } }

test('model refs keep model ids that contain colons', () => {
  assert.deepEqual(parseRef('abc:beam:cloud'), { providerId: 'abc', model: 'beam:cloud' })
  assert.equal(parseRef('nocolon'), null)
})

test('OpenAI-style models are sorted by what they do', () => {
  assert.deepEqual(classifyOpenAiModel('gpt-5.5'), ['chat'])
  assert.deepEqual(classifyOpenAiModel('text-embedding-3-small'), ['embedding'])
  assert.deepEqual(classifyOpenAiModel('gpt-4o-mini-tts'), ['tts'])
  assert.deepEqual(classifyOpenAiModel('tts-1-hd'), ['tts'])
  assert.deepEqual(classifyOpenAiModel('whisper-1'), ['stt'])
  assert.deepEqual(classifyOpenAiModel('gpt-4o-transcribe'), ['stt'])
  assert.deepEqual(classifyOpenAiModel('dall-e-3'), [])
  assert.deepEqual(classifyOpenAiModel('omni-moderation-latest'), [])
  assert.deepEqual(classifyOpenAiModel('llama-3.3-70b-versatile'), ['chat']) // Groq etc.
})

test('Gemini models are sorted by their supported methods', () => {
  assert.deepEqual(classifyGeminiModel({ name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] }), ['chat', 'stt'])
  assert.deepEqual(classifyGeminiModel({ name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent'] }), ['embedding'])
  assert.deepEqual(classifyGeminiModel({ name: 'models/gemini-3.5-flash-preview-tts', supportedGenerationMethods: ['generateContent'] }), ['tts'])
  assert.deepEqual(classifyGeminiModel({ name: 'models/gemma-3-27b-it', supportedGenerationMethods: ['generateContent'] }), ['chat'])
  assert.deepEqual(classifyGeminiModel({ name: 'models/gemini-live-x', supportedGenerationMethods: ['bidiGenerateContent'] }), [])
  // Real names from the Gemini catalog that are not chat models.
  for (const name of ['gemini-3-pro-image', 'nano-banana-pro-preview', 'lyria-3.5', 'gemini-robotics-er-2-preview', 'antigravity-preview-latest', 'deep-research-preview-04-2026', 'gemini-2.5-computer-use-preview-10-2025']) {
    assert.deepEqual(classifyGeminiModel({ name: `models/${name}`, supportedGenerationMethods: ['generateContent'] }), [], name)
  }
  assert.deepEqual(classifyGeminiModel({ name: 'models/gemini-3.5-transcribe', supportedGenerationMethods: ['generateContent'] }), ['stt'])
  assert.deepEqual(classifyGeminiModel({ name: 'models/gemini-3.8-flash-tts', supportedGenerationMethods: ['generateContent'] }), ['tts'])
})

test('tool schemas are converted to JSON Schema for non-Gemini providers', () => {
  assert.deepEqual(toJsonSchema(weatherTool.parameters), { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] })
})

test('OpenAI-compatible: tool call round trip', async () => {
  const fake = fakeFetch((_url, body) => body.messages.some((m: any) => m.role === 'tool')
    ? { choices: [{ message: { content: 'It is sunny in Tunis.' } }], usage: { prompt_tokens: 20, completion_tokens: 6 } }
    : { choices: [{ message: { content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Tunis"}' } }] } }] })
  try {
    const p = provider('openai_compatible', 'https://api.groq.com/openai/v1')
    const convo: ChatMessage[] = [{ role: 'user', content: 'Weather in Tunis?' }]
    const first = await generate(p, 'llama-3.3-70b', { system: 'Be brief', messages: convo, tools: [weatherTool] })
    assert.deepEqual(first.toolCalls, [{ id: 'call_1', name: 'get_weather', args: { city: 'Tunis' } }])
    convo.push({ role: 'assistant', content: first.text, toolCalls: first.toolCalls }, { role: 'tool', toolCallId: 'call_1', name: 'get_weather', content: '{"sky":"sunny"}' })
    const second = await generate(p, 'llama-3.3-70b', { system: 'Be brief', messages: convo, tools: [weatherTool] })
    assert.equal(second.text, 'It is sunny in Tunis.')

    const [req1, req2] = fake.calls
    assert.equal(req1.url, 'https://api.groq.com/openai/v1/chat/completions')
    assert.equal(req1.headers.authorization, 'Bearer sk-test')
    assert.deepEqual(req1.body.messages[0], { role: 'system', content: 'Be brief' })
    assert.equal(req1.body.tools[0].function.parameters.type, 'object')
    assert.deepEqual(req2.body.messages.slice(2), [
      { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Tunis"}' } }] },
      { role: 'tool', tool_call_id: 'call_1', content: '{"sky":"sunny"}' }
    ])
  } finally { fake.restore() }
})

test('Ollama: tool calls without ids get ids, results go back as tool messages', async () => {
  const fake = fakeFetch(() => ({ message: { content: '', tool_calls: [{ function: { name: 'get_weather', arguments: { city: 'Sfax' } } }] }, prompt_eval_count: 5, eval_count: 2 }))
  try {
    const result = await generate(provider('ollama_local', 'http://localhost:11434'), 'qwen3', { messages: [{ role: 'user', content: 'hi' }], tools: [weatherTool] })
    assert.equal(result.toolCalls[0].name, 'get_weather')
    assert.deepEqual(result.toolCalls[0].args, { city: 'Sfax' })
    assert.ok(result.toolCalls[0].id)
    assert.equal(fake.calls[0].url, 'http://localhost:11434/api/chat')
    assert.equal(fake.calls[0].body.stream, false)
  } finally { fake.restore() }
})

test('Anthropic: tool_use → tool_result round trip, raw content sent back unchanged', async () => {
  let turn = 0
  const fake = fakeFetch(() => (++turn === 1
    ? { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'tool_use', content: [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { city: 'Tunis' } }], usage: { input_tokens: 30, output_tokens: 10 } }
    : { id: 'msg_2', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Sunny.' }], usage: { input_tokens: 40, output_tokens: 3 } }))
  try {
    const p = provider('anthropic')
    const convo: ChatMessage[] = [{ role: 'user', content: 'Weather?' }]
    const first = await generate(p, 'claude-opus-5-5', { system: 'Be brief', messages: convo, tools: [weatherTool] })
    assert.deepEqual(first.toolCalls, [{ id: 'toolu_1', name: 'get_weather', args: { city: 'Tunis' } }])
    convo.push({ role: 'assistant', content: first.text, toolCalls: first.toolCalls, raw: first.raw }, { role: 'tool', toolCallId: 'toolu_1', name: 'get_weather', content: '{"sky":"sunny"}' })
    const second = await generate(p, 'claude-opus-5-5', { system: 'Be brief', messages: convo, tools: [weatherTool] })
    assert.equal(second.text, 'Sunny.')

    const [req1, req2] = fake.calls
    assert.equal(req1.url, 'https://api.anthropic.com/v1/messages')
    assert.equal(req1.headers['x-api-key'], 'sk-test')
    assert.ok(req1.headers['anthropic-version'])
    assert.equal(req1.body.system, 'Be brief')
    assert.equal(req1.body.tools[0].input_schema.type, 'object')
    // The assistant turn (including its thinking block) is replayed as-is,
    // followed by one user message carrying the tool_result.
    assert.deepEqual(req2.body.messages[1].content[0], { type: 'thinking', thinking: '', signature: 'sig' })
    assert.deepEqual(req2.body.messages[2], { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '{"sky":"sunny"}' }] })
  } finally { fake.restore() }
})

test('Anthropic refusals count as a failure so the next model is tried', async () => {
  const fake = fakeFetch(() => ({ id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'refusal', content: [], usage: { input_tokens: 1, output_tokens: 0 } }))
  try {
    await assert.rejects(generate(provider('anthropic'), 'claude-opus-5-5', { messages: [{ role: 'user', content: 'x' }] }), /declined/)
  } finally { fake.restore() }
})

test('Gemini TTS PCM is wrapped as a valid WAV', () => {
  const wav = pcmToWav(Buffer.alloc(4800), 24000)
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF')
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE')
  assert.equal(wav.readUInt32LE(24), 24000)
  assert.equal(wav.readUInt32LE(40), 4800)
  assert.equal(wav.length, 44 + 4800)
})
