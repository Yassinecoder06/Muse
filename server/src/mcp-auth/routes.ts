import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { owner } from '../services/owner.service.js'
import { loginLimiter, oauthLimiter } from '../middleware/rate-limit.js'
import { requireAuth } from '../middleware/auth.js'
import { escapeHtml } from '../utils/html.js'
import { mcpPublicUrl } from '../utils/env.js'
import { supabase } from '../supabase/client.js'
// The project does not yet generate Supabase Database types for app tables.
const db = supabase as unknown as { from: (table: string) => any }
import { decideApproval, getApproval, getMcpSettings } from './index.js'
import { DEFAULT_SCOPES, LOCAL_USER_ID, SCOPES, createOpaqueToken, newFamilyId } from './internal.js'
import { constantTimeEqual, notifyModeChange, tokenHash } from './internal-crypto.js'
import { codeCanBeConsumed, downgradedScopes, refreshAction, validDcr, validDcrRedirect, verifyPkce } from './oauth-logic.js'

export const oauthRouter = Router()
export const mcpApiRouter = Router()
const sha = (v: string) => createHash('sha256').update(v).digest('hex')
const modeSchema = z.enum(['trust', 'minimal', 'standard'])
const csrfCookie = 'muse_mcp_csrf'
const setPageHeaders = (res: Response) =>
  res.set({
    // No form-action: after consent the browser must follow the redirect to the
    // MCP client's own callback (claude.ai, chatgpt.com, localhost...).
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  })
function page(res: Response, title: string, body: string) {
  setPageHeaders(res)
  res
    .type('html')
    .send(
      `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)} · Muse</title><style>body{font:16px system-ui;max-width:38rem;margin:3rem auto;padding:0 1rem;background:#f7f6f2;color:#202321}main{background:white;padding:2rem;border:1px solid #ddd;border-radius:12px}label{display:block;margin:1rem 0}input,select,button{font:inherit;padding:.6rem}button{cursor:pointer} .error{color:#a21}</style><main><h1>${escapeHtml(title)}</h1>${body}</main></html>`
    )
}
function csrf(req: Request, res: Response) {
  const value = randomBytes(24).toString('base64url')
  res.cookie(csrfCookie, value, {
    httpOnly: true,
    sameSite: 'strict',
    secure: new URL(mcpPublicUrl).protocol === 'https:',
    maxAge: 10 * 60_000
  })
  return value
}
function csrfValid(req: Request) {
  const a = String(req.cookies?.[csrfCookie] || ''),
    b = String(req.body?.csrf || '')
  return !!a && !!b && constantTimeEqual(a, b)
}
const done = (r: { data: any; error: { message: string } | null }): any => {
  if (r.error) throw new Error(r.error.message)
  return r.data
}
const scopesFrom = (value: unknown) =>
  Array.isArray(value) ? value.filter((s): s is string => typeof s === 'string' && (SCOPES as string[]).includes(s)) : []

oauthRouter.get('/.well-known/oauth-protected-resource', (_req, res) =>
  res.json({ resource: `${mcpPublicUrl}/mcp`, authorization_servers: [mcpPublicUrl], scopes_supported: SCOPES, bearer_methods_supported: ['header'] })
)
oauthRouter.get('/.well-known/oauth-authorization-server', (_req, res) =>
  res.json({
    issuer: mcpPublicUrl,
    authorization_endpoint: `${mcpPublicUrl}/oauth/authorize`,
    token_endpoint: `${mcpPublicUrl}/oauth/token`,
    registration_endpoint: `${mcpPublicUrl}/oauth/register`,
    revocation_endpoint: `${mcpPublicUrl}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none']
  })
)

oauthRouter.post('/oauth/register', oauthLimiter, async (req, res, next) => {
  try {
    const body = z
      .object({
        client_name: z.string().trim().min(1).max(100),
        redirect_uris: z.array(z.string().url()).min(1).max(10),
        scope: z.string().optional()
      })
      .parse(req.body)
    if (!validDcr(body) || body.redirect_uris.some(uri => !validDcrRedirect(uri)))
      return res.status(400).json({ error: 'invalid_redirect_uri' })
    const scopes = scopesFrom(body.scope?.split(/\s+/) || DEFAULT_SCOPES)
    const clientId = randomUUID()
    done(
      await db
        .from('mcp_clients')
        .insert({ client_id: clientId, name: body.client_name, redirect_uris: body.redirect_uris, scopes, user_id: LOCAL_USER_ID })
        .select('client_id')
        .single()
    )
    res
      .status(201)
      .json({
        client_id: clientId,
        client_name: body.client_name,
        redirect_uris: body.redirect_uris,
        scope: scopes.join(' '),
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code']
      })
  } catch (e) {
    next(e)
  }
})

oauthRouter.get('/oauth/authorize', async (req, res, next) => {
  try {
    const clientId = String(req.query.client_id || ''),
      redirect = String(req.query.redirect_uri || ''),
      challenge = String(req.query.code_challenge || ''),
      method = String(req.query.code_challenge_method || ''),
      responseType = String(req.query.response_type || ''),
      state = String(req.query.state || '')
    if (!clientId || !redirect || !/^[-_A-Za-z0-9]{43}$/.test(challenge) || method !== 'S256' || responseType !== 'code')
      return res.status(400).send('Invalid OAuth authorization request.')
    const client = done(
      await db
        .from('mcp_clients')
        .select('client_id,name,redirect_uris,scopes,approval_mode,remembered')
        .eq('client_id', clientId)
        .maybeSingle()
    )
    if (!client || !(client.redirect_uris as string[]).includes(redirect)) return res.status(400).send('Unknown client or redirect URI.')
    const token = csrf(req, res)
    // Offer exactly what this request asks for (or the safe defaults), never more
    // than the client registered for.
    const registered = scopesFrom(client.scopes)
    const asked = typeof req.query.scope === 'string' && req.query.scope.trim() ? scopesFrom(req.query.scope.trim().split(/\s+/)) : DEFAULT_SCOPES
    const requested = asked.filter(scope => registered.includes(scope))
    if (!requested.length) return res.status(400).send('This app did not request any scope Muse can grant.')
    const options = requested.map(scope => `<label><input type="checkbox" name="scope" value="${scope}" checked> ${scope}</label>`).join('')
    page(
      res,
      'Connect an app',
      `<p><strong>${escapeHtml(client.name)}</strong> requests access to Muse.</p><form method="post" action="/oauth/authorize"><input type="hidden" name="csrf" value="${token}"><input type="hidden" name="client_id" value="${escapeHtml(clientId)}"><input type="hidden" name="redirect_uri" value="${escapeHtml(redirect)}"><input type="hidden" name="challenge" value="${escapeHtml(challenge)}"><input type="hidden" name="state" value="${escapeHtml(state)}">${options}<label>Approval mode <select name="mode"><option value="minimal" selected>Minimal: the app asks before deleting</option><option value="standard">Standard: deletions also need approval in Muse</option><option value="trust">Trust: never asks (deletions keep a 7-day undo)</option></select></label><p><small>You can change the mode and scopes any time in Muse → Settings → Connected apps.</small></p><label><input type="checkbox" name="remember" value="yes" ${client.remembered ? 'checked' : ''}> Remember this client</label><label>Muse passphrase <input type="password" name="passphrase" required autocomplete="current-password"></label><button>Authorize</button></form>`
    )
  } catch (e) {
    next(e)
  }
})
oauthRouter.post('/oauth/authorize', loginLimiter, async (req, res, next) => {
  try {
    if (!csrfValid(req)) return res.status(403).send('Form expired. Reload and try again.')
    const clientId = String(req.body.client_id || ''),
      redirect = String(req.body.redirect_uri || ''),
      challenge = String(req.body.challenge || ''),
      state = String(req.body.state || '')
    const client = done(await db.from('mcp_clients').select('client_id,redirect_uris,scopes').eq('client_id', clientId).maybeSingle())
    if (!client || !(client.redirect_uris as string[]).includes(redirect) || !/^[-_A-Za-z0-9]{43}$/.test(challenge))
      return res.status(400).send('Invalid authorization request.')
    if (!(await owner.verify(String(req.body.passphrase || ''))))
      return res.status(401).send('Passphrase is not correct. Go back and try again.')
    const scopes = downgradedScopes(req.body.scope, client.scopes)
    const mode = modeSchema.parse(req.body.mode)
    done(
      await db
        .from('mcp_clients')
        .update({ user_id: LOCAL_USER_ID, approval_mode: mode, remembered: req.body.remember === 'yes' })
        .eq('client_id', clientId)
    )
    notifyModeChange(LOCAL_USER_ID, clientId, mode)
    const code = createOpaqueToken(),
      expires = new Date(Date.now() + 5 * 60_000).toISOString()
    done(
      await db
        .from('mcp_auth_codes')
        .insert({
          code_hash: sha(code),
          user_id: LOCAL_USER_ID,
          client_id: clientId,
          redirect_uri: redirect,
          scopes,
          code_challenge: challenge,
          state,
          approval_mode: mode,
          expires_at: expires
        })
    )
    const dest = new URL(redirect)
    dest.searchParams.set('code', code)
    if (state) dest.searchParams.set('state', state)
    res.clearCookie(csrfCookie)
    res.redirect(dest.toString())
  } catch (e) {
    next(e)
  }
})

oauthRouter.post('/oauth/token', oauthLimiter, async (req, res, next) => {
  try {
    res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' })
    const grant = String(req.body.grant_type || '')
    if (grant === 'authorization_code') {
      const code = String(req.body.code || ''),
        redirect = String(req.body.redirect_uri || ''),
        clientId = String(req.body.client_id || ''),
        verifier = String(req.body.code_verifier || '')
      const row = done(await db.from('mcp_auth_codes').select('*').eq('code_hash', sha(code)).maybeSingle())
      if (
        !codeCanBeConsumed(row) ||
        row.client_id !== clientId ||
        row.redirect_uri !== redirect ||
        !verifyPkce(verifier, row.code_challenge)
      )
        return res.status(400).json({ error: 'invalid_grant' })
      const consumed = done(
        await db
          .from('mcp_auth_codes')
          .update({ consumed_at: new Date().toISOString() })
          .eq('code_hash', row.code_hash)
          .is('consumed_at', null)
          .select('code_hash')
          .maybeSingle()
      )
      if (!consumed) return res.status(400).json({ error: 'invalid_grant' })
      const access = createOpaqueToken(),
        refresh = createOpaqueToken(),
        family = newFamilyId(),
        expires = Date.now() + 15 * 60_000
      done(
        await db.from('mcp_tokens').insert([
          {
            user_id: row.user_id,
            client_id: clientId,
            token_hash: tokenHash(access),
            type: 'oauth_access',
            scopes: row.scopes,
            expires_at: new Date(expires).toISOString(),
            family_id: family
          },
          {
            user_id: row.user_id,
            client_id: clientId,
            token_hash: tokenHash(refresh),
            type: 'oauth_refresh',
            scopes: row.scopes,
            family_id: family
          }
        ])
      )
      res.json({ access_token: access, token_type: 'Bearer', expires_in: 900, refresh_token: refresh, scope: row.scopes.join(' ') })
      return
    }
    if (grant === 'refresh_token') {
      const refresh = String(req.body.refresh_token || ''),
        digest = tokenHash(refresh),
        row = done(await db.from('mcp_tokens').select('*').eq('token_hash', digest).maybeSingle())
      const action = refreshAction(row)
      if (action === 'reject') return res.status(400).json({ error: 'invalid_grant' })
      // A refresh token only works for the client it was issued to.
      if (req.body.client_id && String(req.body.client_id) !== row.client_id) return res.status(400).json({ error: 'invalid_grant' })
      if (action === 'revoke-family') {
        done(await db.from('mcp_tokens').update({ revoked_at: new Date().toISOString() }).eq('family_id', row.family_id))
        return res.status(400).json({ error: 'invalid_grant' })
      }
      const nextAccess = createOpaqueToken(),
        nextRefresh = createOpaqueToken(),
        now = new Date().toISOString(),
        exp = new Date(Date.now() + 15 * 60_000).toISOString()
      const used = done(
        await db.from('mcp_tokens').update({ revoked_at: now }).eq('id', row.id).is('revoked_at', null).select('id').maybeSingle()
      )
      if (!used) {
        done(await db.from('mcp_tokens').update({ revoked_at: now }).eq('family_id', row.family_id))
        return res.status(400).json({ error: 'invalid_grant' })
      }
      done(
        await db.from('mcp_tokens').insert([
          {
            user_id: row.user_id,
            client_id: row.client_id,
            token_hash: tokenHash(nextAccess),
            type: 'oauth_access',
            scopes: row.scopes,
            expires_at: exp,
            family_id: row.family_id
          },
          {
            user_id: row.user_id,
            client_id: row.client_id,
            token_hash: tokenHash(nextRefresh),
            type: 'oauth_refresh',
            scopes: row.scopes,
            family_id: row.family_id
          }
        ])
      )
      res.json({ access_token: nextAccess, token_type: 'Bearer', expires_in: 900, refresh_token: nextRefresh, scope: row.scopes.join(' ') })
      return
    }
    res.status(400).json({ error: 'unsupported_grant_type' })
  } catch (e) {
    next(e)
  }
})
oauthRouter.post('/oauth/revoke', oauthLimiter, async (req, res, next) => {
  try {
    const token = String(req.body.token || '')
    const row = done(await db.from('mcp_tokens').select('id').eq('token_hash', tokenHash(token)).maybeSingle())
    if (row) done(await db.from('mcp_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', row.id))
    res.status(200).send()
  } catch (e) {
    next(e)
  }
})

oauthRouter.get('/approve/:id', async (req, res, next) => {
  try {
    const row = await getApproval(String(req.params.id))
    if (!row || row.status !== 'pending') return res.status(404).send('Approval link expired or already used.')
    const target = String(row.args.target || row.args.note_id || row.args.id || 'Not specified')
    const token = csrf(req, res)
    page(
      res,
      'Approve this action',
      `<p><strong>Tool:</strong> ${escapeHtml(row.tool)}</p><p><strong>Target:</strong> ${escapeHtml(target)}</p><p>${escapeHtml(row.summary)}</p><form method="post" action="/approve/${escapeHtml(row.id)}"><input type="hidden" name="csrf" value="${token}"><label>Muse passphrase <input type="password" name="passphrase" required autocomplete="current-password"></label><button name="decision" value="approve">Approve</button> <button name="decision" value="deny">Deny</button></form>`
    )
  } catch (e) {
    next(e)
  }
})
oauthRouter.post('/approve/:id', loginLimiter, async (req, res, next) => {
  try {
    if (!csrfValid(req)) return res.status(403).send('Form expired. Reload and try again.')
    if (!(await owner.verify(String(req.body.passphrase || '')))) return res.status(401).send('Passphrase is not correct.')
    const decision = req.body.decision === 'approve' ? 'approve' : 'deny'
    const changed = await decideApproval(String(req.params.id), decision)
    res.clearCookie(csrfCookie)
    page(res, changed ? 'Decision recorded' : 'Link expired', '<p>You can close this page.</p>')
  } catch (e) {
    next(e)
  }
})

mcpApiRouter.use(requireAuth)
mcpApiRouter.get('/status', async (req, res, next) => {
  try {
    const [settings, tokens, clients, approvals] = await Promise.all([
      getMcpSettings(req.userId!),
      db.from('mcp_tokens').select('id', { count: 'exact', head: true }).eq('user_id', req.userId!).is('revoked_at', null),
      db.from('mcp_clients').select('client_id', { count: 'exact', head: true }).eq('user_id', req.userId!),
      db.from('mcp_approvals').select('id', { count: 'exact', head: true }).eq('user_id', req.userId!).eq('status', 'pending')
    ])
    res.json({ mcpUrl: `${mcpPublicUrl}/mcp`, settings, tokens: tokens.count || 0, clients: clients.count || 0, pendingApprovals: approvals.count || 0 })
  } catch (e) {
    next(e)
  }
})
mcpApiRouter.get('/settings', async (req, res, next) => {
  try {
    res.json(await getMcpSettings(req.userId!))
  } catch (e) {
    next(e)
  }
})
mcpApiRouter.put('/settings', async (req, res, next) => {
  try {
    const b = z.object({ defaultMode: modeSchema, timezone: z.string().min(1).max(100) }).parse(req.body)
    done(
      await db
        .from('mcp_settings')
        .upsert({ user_id: req.userId!, default_mode: b.defaultMode, timezone: b.timezone, updated_at: new Date().toISOString() })
    )
    notifyModeChange(req.userId!, null, b.defaultMode)
    res.json(b)
  } catch (e) {
    next(e)
  }
})
mcpApiRouter.get('/tokens', async (req, res, next) => {
  try {
    res.json(
      done(
        await db
          .from('mcp_tokens')
          .select('id,label,type,scopes,expires_at,revoked_at,created_at,last_used_at')
          .eq('user_id', req.userId!)
          .order('created_at', { ascending: false })
      )
    )
  } catch (e) {
    next(e)
  }
})
mcpApiRouter.post('/tokens', async (req, res, next) => {
  try {
    const b = z
      .object({
        label: z.string().trim().min(1).max(100),
        scopes: z.array(z.string().refine(scope => (SCOPES as string[]).includes(scope))).min(1),
        expiresInDays: z.number().int().min(1).max(365).optional()
      })
      .parse(req.body)
    const token = createOpaqueToken('muse_mcp_'),
      clientId = `pat:${randomUUID()}`
    const c = done(
      await db
        .from('mcp_clients')
        .insert({ user_id: req.userId!, client_id: clientId, name: b.label, scopes: b.scopes, redirect_uris: [] })
        .select('client_id')
        .single()
    )
    done(
      await db
        .from('mcp_tokens')
        .insert({
          user_id: req.userId!,
          client_id: c.client_id,
          token_hash: tokenHash(token),
          type: 'pat',
          scopes: b.scopes,
          expires_at: b.expiresInDays ? new Date(Date.now() + b.expiresInDays * 864e5).toISOString() : null,
          label: b.label,
          family_id: newFamilyId()
        })
    )
    res.status(201).json({ token, label: b.label })
  } catch (e) {
    next(e)
  }
})
mcpApiRouter.delete('/tokens/:id', async (req, res, next) => {
  try {
    done(await db.from('mcp_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', req.params.id).eq('user_id', req.userId!))
    res.status(204).send()
  } catch (e) {
    next(e)
  }
})
mcpApiRouter.get('/clients', async (req, res, next) => {
  try {
    res.json(
      done(
        await db
          .from('mcp_clients')
          .select('client_id,name,scopes,approval_mode,remembered,created_at,last_used_at')
          .eq('user_id', req.userId!)
          .order('created_at', { ascending: false })
      )
    )
  } catch (e) {
    next(e)
  }
})
mcpApiRouter.patch('/clients/:id', async (req, res, next) => {
  try {
    const b = z
      .object({ mode: modeSchema.optional(), scopes: z.array(z.string().refine(scope => (SCOPES as string[]).includes(scope))).optional() })
      .refine(v => v.mode !== undefined || v.scopes !== undefined)
      .parse(req.body)
    const patch = { ...(b.mode ? { approval_mode: b.mode } : {}), ...(b.scopes ? { scopes: b.scopes } : {}) }
    done(await db.from('mcp_clients').update(patch).eq('client_id', req.params.id).eq('user_id', req.userId!))
    if (b.mode) notifyModeChange(req.userId!, req.params.id, b.mode)
    res.json({ ok: true })
  } catch (e) {
    next(e)
  }
})
mcpApiRouter.delete('/clients/:id', async (req, res, next) => {
  try {
    done(
      await db.from('mcp_tokens').update({ revoked_at: new Date().toISOString() }).eq('client_id', req.params.id).eq('user_id', req.userId!)
    )
    done(await db.from('mcp_clients').delete().eq('client_id', req.params.id).eq('user_id', req.userId!))
    res.status(204).send()
  } catch (e) {
    next(e)
  }
})
mcpApiRouter.get('/approvals', async (req, res, next) => {
  try {
    res.json(
      done(await db.from('mcp_approvals').select('*').eq('user_id', req.userId!).order('created_at', { ascending: false }).limit(100))
    )
  } catch (e) {
    next(e)
  }
})
for (const decision of ['approve', 'deny'] as const)
  mcpApiRouter.post(`/approvals/:id/${decision}`, async (req, res, next) => {
    try {
      const row = await getApproval(String(req.params.id))
      if (!row || row.userId !== req.userId) return res.status(404).json({ error: 'Not found' })
      res.json({ ok: await decideApproval(String(req.params.id), decision) })
    } catch (e) {
      next(e)
    }
  })
mcpApiRouter.get('/activity', async (req, res, next) => {
  try {
    res.json(
      done(await db.from('mcp_activity').select('*').eq('user_id', req.userId!).order('created_at', { ascending: false }).limit(100))
    )
  } catch (e) {
    next(e)
  }
})
mcpApiRouter.post('/activity/:id/undo', async (req, res, next) => {
  try {
    const activity = done(await db.from('mcp_activity').select('undo_id').eq('id', req.params.id).eq('user_id', req.userId!).maybeSingle())
    if (!activity?.undo_id) return res.status(404).json({ error: 'Undo snapshot unavailable' })
    const row = done(
      await db.from('mcp_undo').select('id,expires_at,used_at,snapshot').eq('id', activity.undo_id).eq('user_id', req.userId!).maybeSingle()
    )
    if (!row || row.used_at || Date.parse(row.expires_at) <= Date.now())
      return res.status(410).json({ error: 'Undo snapshot expired or already used' })
    const groups = row.snapshot as { table: string; rows: Record<string, unknown>[] }[]
    const allowed = new Set(['notes', 'tasks', 'events', 'user_memories', 'specialized_templates', 'chat_sessions', 'chat_messages'])
    if (
      !Array.isArray(groups) ||
      groups.some(
        group =>
          !group || !allowed.has(group.table) || !Array.isArray(group.rows) || group.rows.some(item => !item || typeof item.id !== 'string')
      )
    )
      return res.status(400).json({ error: 'Undo snapshot format is invalid' })
    if (groups.some(group => group.rows.some(item => item.user_id !== undefined && item.user_id !== req.userId)))
      return res.status(400).json({ error: 'Undo snapshot format is invalid' })
    const claimed = done(
      await db
        .from('mcp_undo')
        .update({ used_at: new Date().toISOString() })
        .eq('id', row.id)
        .is('used_at', null)
        .select('id')
        .maybeSingle()
    )
    if (!claimed) return res.status(410).json({ error: 'Undo snapshot expired or already used' })
    try {
      // Upserts are idempotent, so a failed restore can be retried.
      for (const group of groups) done(await db.from(group.table).upsert(group.rows, { onConflict: 'id' }))
    } catch (error) {
      await db.from('mcp_undo').update({ used_at: null }).eq('id', row.id)
      throw error
    }
    res.json({ ok: true })
  } catch (e) {
    next(e)
  }
})
mcpApiRouter.get('/events', async (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
  res.flushHeaders()
  const send = async () => {
    const [activity, approvals] = await Promise.all([
      db.from('mcp_activity').select('*').eq('user_id', req.userId!).order('created_at', { ascending: false }).limit(10),
      db.from('mcp_approvals').select('*').eq('user_id', req.userId!).eq('status', 'pending').order('created_at', { ascending: false })
    ])
    res.write(`event: snapshot\ndata: ${JSON.stringify({ activity: activity.data || [], approvals: approvals.data || [] })}\n\n`)
  }
  // A failed poll must never become an unhandled rejection (that would crash the server).
  const safeSend = () => send().catch(() => {})
  await safeSend()
  const timer = setInterval(() => void safeSend(), 15000)
  req.on('close', () => clearInterval(timer))
})
