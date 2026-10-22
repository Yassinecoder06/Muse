import type { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { supabase } from '../supabase/client.js'
import { runAgentConversation } from '../services/agent.service.js'
import { executeAgentTool, CONFIRMATION_REQUIRED_TOOLS } from '../services/agent-tools.service.js'
import { consumeConfirmationToken } from '../services/agent-confirmation.service.js'
import { requestTimezone } from '../utils/timezone.js'
import { parseImageData, type ImageAttachment } from '../services/image-generation.service.js'

const createSessionSchema = z.object({
  title: z.string().trim().max(100).optional().default('New Conversation'),
  context_type: z.string().trim().max(50).optional().default('general'),
  context_id: z.string().uuid().optional().nullable()
})

const updateSessionSchema = z.object({
  title: z.string().trim().min(1).max(100)
})

const imageItemSchema = z.object({
  mimeType: z.string().default('image/png'),
  data: z.string().optional().default(''),
  url: z.string().optional()
})

const sendMessageSchema = z.object({
  message: z.string().max(8000).optional().default(''),
  model: z.string().max(100).optional(),
  userName: z.string().max(80).optional(),
  images: z.array(imageItemSchema).optional().default([])
}).refine(data => data.message.trim().length > 0 || data.images.length > 0, {
  message: 'Message cannot be empty unless an image is attached'
})

async function normalizeImages(
  rawImages: Array<{ mimeType: string; data?: string; url?: string }>,
  userId: string
): Promise<ImageAttachment[]> {
  const result: ImageAttachment[] = []
  for (const item of rawImages) {
    let mimeType = item.mimeType || 'image/png'
    let data = item.data || ''
    let url = item.url

    if (data) {
      const parsed = parseImageData(data, mimeType)
      mimeType = parsed.mimeType
      data = parsed.data

      // If no persistent server URL yet, persist to images table so chat history has permanent URL
      if (!url || !url.startsWith('/api/images/')) {
        try {
          const buffer = Buffer.from(data, 'base64')
          const { data: dbImg, error } = await supabase
            .from('images')
            .insert({
              user_id: userId,
              mime: mimeType,
              size: buffer.length,
              data
            })
            .select('id')
            .single()
          if (!error && dbImg?.id) {
            url = `/api/images/${dbImg.id}`
          }
        } catch (saveErr) {
          console.warn('[Chat] Could not save uploaded image to images table:', saveErr)
        }
      }
      result.push({ mimeType, data, url })
    } else if (url) {
      // If client sent an existing /api/images/:id URL without inline data
      if (url.startsWith('/api/images/')) {
        const id = url.replace('/api/images/', '').split('?')[0].split('/')[0]
        if (z.string().uuid().safeParse(id).success) {
          const { data: dbImg } = await supabase
            .from('images')
            .select('mime, data')
            .eq('id', id)
            .eq('user_id', userId)
            .maybeSingle()
          if (dbImg?.data) {
            result.push({ mimeType: dbImg.mime, data: dbImg.data, url })
            continue
          }
        }
      }
      result.push({ mimeType, data: '', url })
    }
  }
  return result
}

const createMemorySchema = z.object({
  fact: z.string().trim().min(1, 'Memory fact is required').max(1000),
  category: z.string().trim().max(50).optional().default('general')
})

export async function listSessions(req: Request, res: Response, next: NextFunction) {
  try {
    const { data, error } = await supabase
      .from('chat_sessions')
      .select('id, user_id, title, context_type, context_id, created_at, updated_at')
      .eq('user_id', req.userId!)
      .order('updated_at', { ascending: false })

    if (error) throw error
    res.json(data || [])
  } catch (error) {
    next(error)
  }
}

export async function createSession(req: Request, res: Response, next: NextFunction) {
  try {
    const body = createSessionSchema.parse(req.body || {})
    const { data, error } = await supabase
      .from('chat_sessions')
      .insert({
        user_id: req.userId!,
        title: body.title,
        context_type: body.context_type,
        context_id: body.context_id || null
      })
      .select()
      .single()

    if (error) throw error
    res.status(201).json(data)
  } catch (error) {
    next(error)
  }
}

export async function getSession(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params
    const { data: session, error: sessionErr } = await supabase
      .from('chat_sessions')
      .select('*')
      .eq('id', id)
      .eq('user_id', req.userId!)
      .single()

    if (sessionErr || !session) {
      res.status(404).json({ error: 'Chat session not found' })
      return
    }

    const { data: messages, error: messagesErr } = await supabase
      .from('chat_messages')
      .select('id, role, content, tool_calls, tool_results, action_cards, created_at')
      .eq('session_id', id)
      .order('created_at', { ascending: true })

    if (messagesErr) throw messagesErr

    res.json({
      ...session,
      messages: messages || []
    })
  } catch (error) {
    next(error)
  }
}

export async function updateSession(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params
    const body = updateSessionSchema.parse(req.body)

    const { data, error } = await supabase
      .from('chat_sessions')
      .update({
        title: body.title,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .eq('user_id', req.userId!)
      .select()
      .single()

    if (error) throw error
    if (!data) {
      res.status(404).json({ error: 'Chat session not found' })
      return
    }

    res.json(data)
  } catch (error) {
    next(error)
  }
}

export async function deleteSession(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params
    const { error } = await supabase
      .from('chat_sessions')
      .delete()
      .eq('id', id)
      .eq('user_id', req.userId!)

    if (error) throw error
    res.json({ success: true })
  } catch (error) {
    next(error)
  }
}

export async function sendMessage(req: Request, res: Response, next: NextFunction) {
  try {
    const sessionId = String(req.params.id)
    const body = sendMessageSchema.parse(req.body)

    // Ensure session exists and belongs to user
    const { data: session, error: sessionErr } = await supabase
      .from('chat_sessions')
      .select('id')
      .eq('id', sessionId)
      .eq('user_id', req.userId!)
      .single()

    if (sessionErr || !session) {
      res.status(404).json({ error: 'Chat session not found' })
      return
    }

    const resolvedUserName = body.userName || (req.headers['x-muse-user-name'] ? decodeURIComponent(req.headers['x-muse-user-name'] as string) : undefined)
    const normalizedImages = await normalizeImages(body.images || [], req.userId!)

    const output = await runAgentConversation({
      userId: req.userId!,
      sessionId,
      messageText: body.message,
      model: body.model,
      userName: resolvedUserName,
      timezone: requestTimezone(req),
      images: normalizedImages
    })

    const reply = output.assistantMessage.content
    res.json({
      ...output,
      reply,
      response: reply,
      sessionId,
      actionCards: output.assistantMessage.action_cards || [],
      action_cards: output.assistantMessage.action_cards || [],
      toolCalls: output.assistantMessage.tool_calls || [],
      tool_calls: output.assistantMessage.tool_calls || []
    })
  } catch (error) {
    next(error)
  }
}

const updateMessageSchema = z.object({
  content: z.string().trim().min(1, 'Message cannot be empty').max(8000)
})

export async function updateMessage(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params
    const body = updateMessageSchema.parse(req.body)

    const { data: existing, error: findErr } = await supabase
      .from('chat_messages')
      .select('id, user_id, session_id, role')
      .eq('id', id)
      .eq('user_id', req.userId!)
      .single()

    if (findErr || !existing) {
      res.status(404).json({ error: 'Message not found' })
      return
    }

    const { data, error } = await supabase
      .from('chat_messages')
      .update({
        content: body.content
      })
      .eq('id', id)
      .eq('user_id', req.userId!)
      .select()
      .single()

    if (error) throw error
    res.json(data)
  } catch (error) {
    next(error)
  }
}

export async function deleteMessage(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params
    const { error } = await supabase
      .from('chat_messages')
      .delete()
      .eq('id', id)
      .eq('user_id', req.userId!)

    if (error) throw error
    res.json({ success: true })
  } catch (error) {
    next(error)
  }
}

export async function listMemories(req: Request, res: Response, next: NextFunction) {
  try {
    const { data, error } = await supabase
      .from('user_memories')
      .select('*')
      .eq('user_id', req.userId!)
      .order('updated_at', { ascending: false })

    if (error) throw error
    res.json(data || [])
  } catch (error) {
    next(error)
  }
}

export async function createMemory(req: Request, res: Response, next: NextFunction) {
  try {
    const body = createMemorySchema.parse(req.body)
    const { data, error } = await supabase
      .from('user_memories')
      .insert({
        user_id: req.userId!,
        fact: body.fact,
        category: body.category
      })
      .select()
      .single()

    if (error) throw error
    res.status(201).json(data)
  } catch (error) {
    next(error)
  }
}

export async function deleteMemory(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params
    const { error } = await supabase
      .from('user_memories')
      .delete()
      .eq('id', id)
      .eq('user_id', req.userId!)

    if (error) throw error
    res.json({ success: true })
  } catch (error) {
    next(error)
  }
}

export async function directChat(req: Request, res: Response, next: NextFunction) {
  try {
    const directChatSchema = z.object({
      message: z.string().max(8000).optional().default(''),
      sessionId: z.string().trim().uuid().optional().nullable().or(z.literal('')).transform(val => (val ? val : undefined)),
      model: z.string().max(100).optional(),
      userName: z.string().max(80).optional(),
      images: z.array(imageItemSchema).optional().default([])
    }).refine(data => data.message.trim().length > 0 || data.images.length > 0, {
      message: 'Message cannot be empty unless an image is attached'
    })

    const body = directChatSchema.parse(req.body)

    let sessionId = body.sessionId

    if (sessionId) {
      const { data: owned } = await supabase
        .from('chat_sessions')
        .select('id')
        .eq('id', sessionId)
        .eq('user_id', req.userId!)
        .maybeSingle()
      if (!owned) {
        res.status(404).json({ error: 'Chat session not found' })
        return
      }
    } else {
      const { data: existing } = await supabase
        .from('chat_sessions')
        .select('id')
        .eq('user_id', req.userId!)
        .eq('context_type', 'mobile')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (existing) {
        sessionId = existing.id
      } else {
        const { data: created, error: createErr } = await supabase
          .from('chat_sessions')
          .insert({
            user_id: req.userId!,
            title: 'Mobile Companion',
            context_type: 'mobile'
          })
          .select('id')
          .single()

        if (createErr) throw createErr
        sessionId = created.id
      }
    }

    const resolvedUserName = body.userName || (req.headers['x-muse-user-name'] ? decodeURIComponent(req.headers['x-muse-user-name'] as string) : undefined)
    const normalizedImages = await normalizeImages(body.images || [], req.userId!)

    const output = await runAgentConversation({
      userId: req.userId!,
      sessionId: sessionId!,
      messageText: body.message,
      model: body.model,
      userName: resolvedUserName,
      timezone: requestTimezone(req),
      images: normalizedImages
    })

    const reply = output.assistantMessage.content
    res.json({
      reply,
      response: reply,
      sessionId,
      sessionTitle: output.sessionTitle,
      actionCards: output.assistantMessage.action_cards || [],
      action_cards: output.assistantMessage.action_cards || [],
      toolCalls: output.assistantMessage.tool_calls || [],
      tool_calls: output.assistantMessage.tool_calls || [],
      userMessage: output.userMessage,
      assistantMessage: output.assistantMessage
    })
  } catch (error) {
    next(error)
  }
}

// Runs a destructive tool the agent proposed, after the user pressed Confirm.
export async function confirmAgentAction(req: Request, res: Response, next: NextFunction) {
  try {
    const { token } = z.object({ token: z.string().min(1).max(4000) }).parse(req.body)
    const pending = consumeConfirmationToken(req.userId!, token)
    if (!pending || !CONFIRMATION_REQUIRED_TOOLS.has(pending.tool)) {
      res.status(410).json({ error: 'This confirmation expired or was already used. Ask Bip again.' })
      return
    }
    const execution = await executeAgentTool(req.userId!, pending.tool, pending.args, { confirmed: true, timezone: requestTimezone(req) })
    if (execution.error) {
      res.status(400).json({ error: execution.error })
      return
    }
    res.json({ result: execution.result, actionCard: execution.actionCard })
  } catch (error) {
    next(error)
  }
}
