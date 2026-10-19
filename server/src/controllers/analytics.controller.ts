import type { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { supabase } from '../supabase/client.js'

// Raw activity the browser can't derive from notes and tasks on its own: when
// you talked to Bip, and which AI models did the work. Rows are returned
// un-bucketed so the client groups them in the viewer's own timezone, the same
// way it groups notes and tasks (and the same way it does in Secure Vault mode).

const PAGE = 1000 // PostgREST's default max rows per request
const MAX_ROWS = 20_000

async function pages<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const rows: T[] = []
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await fetchPage(from, from + PAGE - 1)
    if (error) throw error
    rows.push(...(data || []))
    if (!data || data.length < PAGE) break
  }
  return rows
}

export async function activity(req: Request, res: Response, next: NextFunction) {
  try {
    const days = z.coerce.number().int().min(1).max(400).catch(30).parse(req.query.days)
    const since = new Date(Date.now() - days * 86_400_000).toISOString()
    const userId = req.userId!

    const [chats, usage] = await Promise.all([
      pages<{ created_at: string }>((from, to) => supabase.from('chat_messages').select('created_at')
        .eq('user_id', userId).eq('role', 'user').gte('created_at', since).order('created_at').range(from, to)),
      pages<{ created_at: string; provider: string; model: string; task_type: string; total_tokens: number }>((from, to) => supabase.from('ai_usage_logs')
        .select('created_at,provider,model,task_type,total_tokens')
        .eq('user_id', userId).gte('created_at', since).order('created_at').range(from, to))
    ])

    res.json({
      since,
      chats: chats.map(row => row.created_at),
      ai: usage.map(row => ({ at: row.created_at, provider: row.provider, model: row.model, task: row.task_type, tokens: row.total_tokens || 0 }))
    })
  } catch (error) {
    next(error)
  }
}
