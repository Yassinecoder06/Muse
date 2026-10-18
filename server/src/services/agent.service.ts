import { GoogleGenAI } from '@google/genai'
import { supabase } from '../supabase/client.js'
import { settings } from './settings.repository.js'
import {
  agentToolDeclarations,
  executeAgentTool,
  type AgentActionCard,
  type ToolExecutionResult
} from './agent-tools.service.js'
import {
  extractKeys,
  getCascadeCandidates,
  isRetryableGeminiError,
  formatFriendlyAgentQuotaError,
  isGeminiModel,
  OLLAMA_CLOUD_URL,
  OLLAMA_LOCAL_URL
} from './ai.service.js'
import { env } from '../utils/env.js'

export interface AgentRunOutput {
  userMessage: {
    id: string
    role: 'user'
    content: string
    created_at: string
  }
  assistantMessage: {
    id: string
    role: 'assistant'
    content: string
    tool_calls?: any[]
    tool_results?: any[]
    action_cards?: AgentActionCard[]
    created_at: string
  }
  sessionTitle?: string
}

function buildSystemInstruction(userName: string, memories: { fact: string; category: string }[]): string {
  const now = new Date()
  const localDateStr = now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
  const localTimeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })

  const memorySection = memories.length > 0
    ? `\n### Known Facts & Preferences about ${userName}:\n${memories.map(m => `- [${m.category}] ${m.fact}`).join('\n')}\n`
    : ''

  return `You are Bip, Muse's proactive autonomous AI companion and personal assistant.
You are warm, intelligent, enthusiastic, and highly capable.
You speak clearly, with an occasional cute robot touch (like "Beep!", "🤖", "✨") when appropriate, but always maintain high utility and clarity.

### Environment & Temporal Context:
- User's Name: ${userName}
- Current Date: ${localDateStr}
- Current Time: ${localTimeStr}
${memorySection}
### Core Capabilities & Instructions:
1. **Autonomous Tool Calling**:
   You have direct access to tools to manage the user's workspace:
   - \`create_note\`: Create notes with title, formatted markdown, and tags.
   - \`update_note\`: Update or append to an existing note.
   - \`search_notes\`: Search the user's notes for knowledge or context.
   - \`create_task\`: Create tasks with due dates, due times, and priority levels.
   - \`update_task\`: Mark tasks complete or update description.
   - \`list_tasks\`: List existing tasks.
   - \`create_calendar_event\`: Schedule calendar events using natural dates (e.g. "tomorrow at 3pm").
   - \`list_calendar_events\`: View upcoming schedule.
   - \`save_memory\`: Save lasting user preferences, projects, or goals.
   - \`get_memories\`: Recall stored memories.

2. **Single-Prompt Multi-Action Execution**:
   When the user asks you to do multiple things (e.g. "Schedule a meeting tomorrow at 3pm, add a task to prepare slides, and write a quick note with the agenda"), you MUST execute all necessary tool calls in parallel/sequence in your turn. Do NOT ask the user for confirmation if you have sufficient details.

3. **Format & Tone**:
   - After tools finish executing, provide a clean, helpful summary of the actions taken.
   - Highlight the created items with clear bullet points.
   - Format cleanly in Markdown with bold titles and neat lists.
   - If the user asks a knowledge question or chats with you, answer directly and use the \`search_notes\` tool if their notes might hold relevant information.
   - If the user shares an important lasting preference or fact about themselves, call \`save_memory\` so you remember it in future sessions.
   - In LaTeX math blocks ($...$ or $$...$$), always escape percent signs as \\% (e.g. \\mathbf{83.3\\%}) so braces are not commented out.`
}

// Convert declarations into GoogleGenAI tool format
function formatGeminiTools(): any[] {
  return [
    {
      functionDeclarations: agentToolDeclarations.map(decl => ({
        name: decl.name,
        description: decl.description,
        parameters: {
          type: decl.parameters.type.toUpperCase(),
          properties: decl.parameters.properties,
          required: decl.parameters.required || []
        }
      }))
    }
  ]
}

// Convert declarations into Ollama JSON schema tools format
function formatOllamaTools() {
  return agentToolDeclarations.map(decl => ({
    type: 'function',
    function: {
      name: decl.name,
      description: decl.description,
      parameters: {
        type: 'object',
        properties: decl.parameters.properties,
        required: decl.parameters.required || []
      }
    }
  }))
}

export async function runAgentConversation({
  userId,
  sessionId,
  messageText,
  model,
  userName = 'Explorer'
}: {
  userId: string
  sessionId: string
  messageText: string
  model?: string
  userName?: string
}): Promise<AgentRunOutput> {
  // 1. Save user message to database
  const { data: userMsg, error: userMsgErr } = await supabase
    .from('chat_messages')
    .insert({
      session_id: sessionId,
      user_id: userId,
      role: 'user',
      content: messageText
    })
    .select()
    .single()

  if (userMsgErr) throw userMsgErr

  // 2. Load active memories for user
  const { data: memoryRows } = await supabase
    .from('user_memories')
    .select('fact, category')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(20)

  const memories = memoryRows || []
  const systemInstruction = buildSystemInstruction(userName, memories)

  // 3. Load recent chat history in session (up to 12 turns)
  const { data: historyRows } = await supabase
    .from('chat_messages')
    .select('role, content, tool_calls, tool_results')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })
    .limit(16)

  // 4. Resolve AI credentials
  const { geminiKey, ollamaKey } = await settings.getEffectiveAiKeys(userId)
  const allActionCards: AgentActionCard[] = []
  const recordedToolCalls: any[] = []
  const recordedToolResults: any[] = []

  let finalResponseText = ''
  let agentError: any = null

  if (geminiKey) {
    // Priority: Run with Gemini Agent Engine using Waterfall Cascade
    const geminiCandidates = getCascadeCandidates(model)
    const client = new GoogleGenAI({ apiKey: geminiKey })

    // Build Gemini contents history
    const contents: any[] = []
    for (const msg of historyRows || []) {
      if (msg.role === 'user') {
        contents.push({ role: 'user', parts: [{ text: msg.content }] })
      } else if (msg.role === 'assistant') {
        const parts: any[] = []
        if (msg.content) parts.push({ text: msg.content })
        if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
          for (const tc of msg.tool_calls) {
            parts.push({ functionCall: { name: tc.name, args: tc.args } })
          }
        }
        if (parts.length > 0) contents.push({ role: 'model', parts })
      }
    }

    // Add current user prompt if not already in contents
    const lastContent = contents[contents.length - 1]
    if (!lastContent || lastContent.role !== 'user' || lastContent.parts[0]?.text !== messageText) {
      contents.push({ role: 'user', parts: [{ text: messageText }] })
    }

    let modelIdx = 0
    try {
      // Multi-turn tool execution loop (max 4 tool call rounds)
      let turns = 0
      while (turns < 4) {
        turns++
        let response: any = null
        let activeModel = geminiCandidates[modelIdx]

        // Model waterfall attempt loop: try active model, tracking back to weaker model on failure
        while (modelIdx < geminiCandidates.length) {
          activeModel = geminiCandidates[modelIdx]
          try {
            response = await client.models.generateContent({
              model: activeModel,
              contents,
              config: {
                systemInstruction,
                tools: formatGeminiTools()
              }
            })
            break // Succeeded with activeModel!
          } catch (err: any) {
            if (isRetryableGeminiError(err)) {
              const nextModel = geminiCandidates[modelIdx + 1]
              if (nextModel) {
                console.warn(`[Agent] Model ${activeModel} quota reached / failed (${err.message?.slice(0, 80)}). Tracking back to weaker model: ${nextModel}`)
                modelIdx++
                continue
              }
            }
            throw err
          }
        }

        if (!response) break

        // Log token usage
        if (response.usageMetadata) {
          void settings.logAiUsage({
            userId,
            provider: 'gemini',
            model: activeModel,
            taskType: 'chat',
            promptTokens: response.usageMetadata.promptTokenCount || 0,
            candidateTokens: response.usageMetadata.candidatesTokenCount || 0,
            totalTokens: response.usageMetadata.totalTokenCount || 0
          })
        }

        const candidate = response.candidates?.[0]
        const modelParts = candidate?.content?.parts || []
        const functionCalls = modelParts.filter((p: any) => p.functionCall).map((p: any) => p.functionCall)

        // Append model response to conversation contents
        contents.push({
          role: 'model',
          parts: modelParts.length > 0 ? modelParts : [{ text: response.text || '' }]
        })

        if (functionCalls.length > 0) {
          const functionResponseParts: any[] = []

          for (const call of functionCalls) {
            recordedToolCalls.push({ name: call.name, args: call.args })
            const execution = await executeAgentTool(userId, call.name, call.args || {})
            recordedToolResults.push({ name: call.name, result: execution.result })
            if (execution.actionCard) {
              allActionCards.push(execution.actionCard)
            }

            functionResponseParts.push({
              functionResponse: {
                name: call.name,
                response: execution.result
              }
            })
          }

          // Send tool results back to model in next loop iteration
          contents.push({
            role: 'user',
            parts: functionResponseParts
          })
        } else {
          // Model provided final answer
          finalResponseText = String(response.text || '').trim()
          break
        }
      }
    } catch (geminiErr: any) {
      console.warn('[Agent] Gemini waterfall cascade exhausted:', geminiErr?.message || geminiErr)
      agentError = geminiErr
    }
  }

  // Fallback to Ollama if Gemini was not used or all Gemini models reached quota
  if (!finalResponseText && (ollamaKey || !geminiKey)) {
    try {
      const fallbackModel = isGeminiModel(model) ? undefined : model
      const baseUrl = ollamaKey ? OLLAMA_CLOUD_URL : OLLAMA_LOCAL_URL
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (ollamaKey) headers['Authorization'] = `Bearer ${ollamaKey}`

      const ollamaMessages: any[] = [{ role: 'system', content: systemInstruction }]
      for (const msg of historyRows || []) {
        if (msg.role === 'user' || msg.role === 'assistant') {
          ollamaMessages.push({ role: msg.role, content: msg.content })
        }
      }

      let turns = 0
      while (turns < 4) {
        turns++
        const res = await fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: fallbackModel || (ollamaKey ? env.OLLAMA_CHAT_MODEL || 'gemma4:31b-cloud' : 'gemma4-ab-qat:e4b'),
            stream: false,
            messages: ollamaMessages,
            tools: formatOllamaTools(),
            options: { num_ctx: env.OLLAMA_NUM_CTX || 16384 }
          })
        })

        if (!res.ok) {
          const errBody = await res.text().catch(() => '')
          throw new Error(`Ollama agent chat error (${res.status}): ${errBody}`)
        }

        const data: any = await res.json()
        const msg = data.message || {}
        ollamaMessages.push(msg)

        if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
          for (const tc of msg.tool_calls) {
            const fnName = tc.function?.name
            const fnArgs = typeof tc.function?.arguments === 'string'
              ? JSON.parse(tc.function.arguments)
              : tc.function?.arguments || {}

            recordedToolCalls.push({ name: fnName, args: fnArgs })
            const execution = await executeAgentTool(userId, fnName, fnArgs)
            recordedToolResults.push({ name: fnName, result: execution.result })
            if (execution.actionCard) {
              allActionCards.push(execution.actionCard)
            }

            ollamaMessages.push({
              role: 'tool',
              content: JSON.stringify(execution.result)
            })
          }
        } else {
          finalResponseText = String(msg.content || '').trim()
          break
        }
      }
    } catch (ollamaErr: any) {
      console.warn('[Agent] Ollama fallback execution failed:', ollamaErr?.message || ollamaErr)
      if (!agentError) agentError = ollamaErr
    }
  }

  if (!finalResponseText) {
    if (allActionCards.length > 0) {
      finalResponseText = 'All set! I have performed the requested actions.'
    } else if (agentError) {
      finalResponseText = formatFriendlyAgentQuotaError(agentError)
    } else {
      finalResponseText = 'Beep boop! ⚠️ Please add an API key in Settings (⚙️) to chat with Bip.'
    }
  }

  // 5. Save assistant response to chat_messages
  const { data: assistantMsg, error: assistantMsgErr } = await supabase
    .from('chat_messages')
    .insert({
      session_id: sessionId,
      user_id: userId,
      role: 'assistant',
      content: finalResponseText,
      tool_calls: recordedToolCalls,
      tool_results: recordedToolResults
    })
    .select()
    .single()

  if (assistantMsgErr) throw assistantMsgErr

  // 6. Update session updated_at and generate title if default
  let sessionTitle: string | undefined
  const { data: currentSession } = await supabase
    .from('chat_sessions')
    .select('title, created_at, updated_at')
    .eq('id', sessionId)
    .single()

  if (currentSession && (currentSession.title === 'New Conversation' || !currentSession.title.trim())) {
    const rawWords = messageText.replace(/[^\w\s]/g, '').trim().split(/\s+/).slice(0, 5).join(' ')
    const generatedTitle = rawWords ? rawWords.charAt(0).toUpperCase() + rawWords.slice(1) : 'Discussion'
    await supabase
      .from('chat_sessions')
      .update({ title: generatedTitle, updated_at: new Date().toISOString() })
      .eq('id', sessionId)
    sessionTitle = generatedTitle
  } else {
    await supabase
      .from('chat_sessions')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', sessionId)
  }

  return {
    userMessage: {
      id: userMsg.id,
      role: 'user',
      content: userMsg.content,
      created_at: userMsg.created_at
    },
    assistantMessage: {
      id: assistantMsg.id,
      role: 'assistant',
      content: assistantMsg.content,
      tool_calls: recordedToolCalls,
      tool_results: recordedToolResults,
      action_cards: allActionCards,
      created_at: assistantMsg.created_at
    },
    sessionTitle
  }
}
