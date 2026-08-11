import { chatWithTools, contextBudgetChars } from './ai.service.js'
import { env } from '../utils/env.js'
import { webSearch, type SearchResult } from '../utils/web-search.js'

export type ResearchDepth = 'concise' | 'standard' | 'in-depth'

export const researchDepths: ResearchDepth[] = ['concise', 'standard', 'in-depth']

const depthProfile: Record<ResearchDepth, { maxRounds: number; target: string }> = {
  concise: { maxRounds: 2, target: 'a concise, focused article of roughly 800 words with 2 to 4 sections' },
  standard: { maxRounds: 3, target: 'a solid article of roughly 1,500 words with 4 to 6 sections' },
  'in-depth': { maxRounds: 5, target: 'a detailed, comprehensive article of roughly 3,000 words with 6 to 10 sections' }
}

const webSearchTool = [{
  type: 'function',
  function: {
    name: 'web_search',
    description: 'Search the web for current, factual information about a topic. Call it whenever you need facts, figures, or details beyond your own knowledge.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'A concise, specific search query' } }, required: ['query'] }
  }
}]

function systemPrompt(depth: ResearchDepth, topic: string) {
  const profile = depthProfile[depth]
  return `You are an expert research writer. Write a complete article note about the topic below.

Requirements:
- Use the web_search tool as needed to gather current facts (up to ${profile.maxRounds} search rounds). Search results are appended to the conversation after each call; use them to enrich the article. You may also write from your own knowledge.
- If a search returns no results, state the gap and continue from your own knowledge.
- Output ONLY the finished article as clean HTML, using only these tags: h1, h2, p, ul, ol, li, strong, em, blockquote, div. No links, images, markdown, or code fences.
- Start with an <h1> containing the article title.
- Cite facts gathered from search results with [n] markers in the text, matching the source list at the end.
- End the article with <h2>Sources</h2> followed by a numbered list of every source URL you used.
- The article must be ${profile.target}.

STOP once the article is complete — do not keep searching after you have enough material.`
}

function escapeHtml(value: string) { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }

export type ResearchResult = { title: string; content: string; sources: SearchResult[] }

export async function research(topic: string, depth: ResearchDepth = 'standard', model?: string, apiKey?: string): Promise<ResearchResult> {
  const profile = depthProfile[depth]
  const messages: any[] = [
    { role: 'system', content: systemPrompt(depth, topic) },
    { role: 'user', content: `Topic: ${topic}` }
  ]
  const sources: SearchResult[] = []
  const seenQueries = new Set<string>()
  const budget = contextBudgetChars()
  let content = ''
  for (let round = 0; round < profile.maxRounds; round++) {
    const response = await chatWithTools(messages, webSearchTool, model, apiKey)
    const toolCalls = (response.tool_calls || []).slice(0, 2)
    if (!toolCalls.length || toolCalls.every(call => call.function?.name !== 'web_search')) { content = response.content; break }
    if (response.content?.trim()) content = response.content
    messages.push({ role: 'assistant', content: response.content, tool_calls: toolCalls })
    if (messages.reduce((total, message) => total + String(message.content || '').length, 0) > budget) break
    for (const call of toolCalls) {
      if (call.function?.name !== 'web_search') continue
      let query = ''
      try { const raw = call.function?.arguments; query = typeof raw === 'string' ? String(JSON.parse(raw)?.query || '') : String((raw as any)?.query || '') } catch { query = '' }
      if (!query) query = topic
      if (seenQueries.has(query)) { messages.push({ role: 'tool', content: 'This query was already searched earlier in this conversation. Continue with the results already gathered.' }); continue }
      seenQueries.add(query)
      let results: SearchResult[] = []
      try { results = await webSearch(query) } catch { results = [] }
      for (const result of results) if (!sources.some(existing => existing.url === result.url)) sources.push(result)
      messages.push({ role: 'tool', content: results.length
        ? results.map((result, index) => `${index + 1}. ${result.title}\n   URL: ${result.url}\n   ${result.snippet}`).join('\n\n')
        : 'No results were found for this query. Continue from your own knowledge.' })
    }
  }
  if (!content.trim()) {
    // The model may be stuck returning tool calls with empty content (e.g.
    // gpt-oss). Reusing that history keeps it in the loop, so retry with a
    // fresh conversation and no tool-calling; fall back to the default model
    // if the selected one still refuses to write.
    const fresh: any[] = [
      { role: 'system', content: systemPrompt(depth, topic) },
      { role: 'user', content: `Topic: ${topic}` }
    ]
    const candidates = [...new Set([model, env.OLLAMA_CHAT_MODEL].filter((item): item is string => !!item))]
    for (const candidate of candidates) {
      const response = await chatWithTools(fresh, [], candidate, apiKey)
      if (response.content?.trim()) { content = response.content; break }
    }
  }
  if (!content.trim()) throw new Error('Muse could not produce a research article for this topic. Try a different model or a clearer topic.')
  const cleaned = content.replace(/```(html|HTML)?/g, '').trim()
  const title = (cleaned.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] || topic).replace(/<[^>]+>/g, '').trim().slice(0, 300)
  let body = cleaned
  if (!/<h2[^>]*>Sources?<\/h2>/i.test(body)) {
    const list = sources.map((source, index) => `<li>${escapeHtml(source.title)} — ${escapeHtml(source.url)}</li>`).join('')
    body += `\n<h2>Sources</h2>\n<ol>${list || '<li>No web sources were retrieved; based on model knowledge.</li>'}</ol>`
  }
  return { title, content: body.slice(0, 100000), sources: sources.slice(0, 20) }
}