import type { NextFunction, Request, Response } from 'express'
import { z } from 'zod'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON
} from '@simplewebauthn/server'
import { supabase } from '../supabase/client.js'
import { clearSessionCookie, createSession, SESSION_COOKIE, sessionCookie } from '../services/session.service.js'
import { env, webauthn } from '../utils/env.js'
import { decryptIfPresent } from '../utils/crypto.js'
import { notes } from '../services/note.repository.js'
import { challengeHashMatches, challengeIsUsable, counterAdvanced, hashChallenge } from '../services/vault-security.js'

const CHALLENGE_TTL_SECONDS = 5 * 60
const user = (req: Request) => req.userId!

async function createChallenge(userId: string | null, purpose: 'registration' | 'authentication', challenge: string) {
  const { data, error } = await supabase.from('webauthn_challenges').insert({
    user_id: userId,
    purpose,
    challenge_hash: hashChallenge(challenge),
    expires_at: new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000).toISOString()
  }).select('id').single()
  if (error) throw error
  return data.id as string
}

async function challengeMatches(id: string, purpose: 'registration' | 'authentication', userId: string | null, challenge: string) {
  const { data, error } = await supabase.from('webauthn_challenges').select('challenge_hash,user_id,expires_at,used_at').eq('id', id).eq('purpose', purpose).single()
  if (error || !data || !challengeIsUsable(data)) return false
  if (userId && data.user_id !== userId) return false
  return challengeHashMatches(challenge, data.challenge_hash)
}

async function consumeChallenge(id: string) {
  const { error } = await supabase.from('webauthn_challenges').update({ used_at: new Date().toISOString() }).eq('id', id).is('used_at', null)
  if (error) throw error
}

type StoredCredential = { id: string; user_id: string; credential_id: string; public_key: string; counter: number; transports: string[]; name: string; created_at: string; last_used_at: string | null; revoked_at: string | null }

function dbCredential(row: StoredCredential) {
  return { id: row.credential_id, publicKey: new Uint8Array(Buffer.from(row.public_key, 'base64url')), counter: Number(row.counter), transports: row.transports as any }
}

export async function vaultStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const { data, error } = await supabase.from('user_vaults').select('vault_check_ciphertext,encryption_version,setup_completed_at,migration_status,migration_verified_at').eq('user_id', user(req)).maybeSingle()
    if (error) throw error
    const { count, error: countError } = await supabase.from('webauthn_credentials').select('*', { count: 'exact', head: true }).eq('user_id', user(req)).is('revoked_at', null)
    if (countError) throw countError
    res.json({ userId: user(req), email: req.userEmail || null, configured: !!data?.setup_completed_at, vaultCheck: data?.vault_check_ciphertext || null, encryptionVersion: data?.encryption_version || 2, migrationStatus: data?.migration_status || 'legacy', migrationVerifiedAt: data?.migration_verified_at || null, passkeyCount: count || 0 })
  } catch (error) { next(error) }
}

export async function setupVault(req: Request, res: Response, next: NextFunction) {
  try {
    const body = z.object({ vaultCheck: z.string().min(20).max(2000) }).parse(req.body)
    const { data: existing, error: existingError } = await supabase.from('user_vaults').select('setup_completed_at').eq('user_id', user(req)).maybeSingle()
    if (existingError) throw existingError
    if (existing?.setup_completed_at) return res.status(409).json({ error: 'This Secure Vault is already configured. Use your recovery key to unlock it; do not create a replacement key.' })
    const { error } = await supabase.from('user_vaults').upsert({ user_id: user(req), vault_check_ciphertext: body.vaultCheck, encryption_version: 2, setup_completed_at: new Date().toISOString(), migration_status: 'legacy' }, { onConflict: 'user_id' })
    if (error) throw error
    res.status(201).json({ configured: true })
  } catch (error) { next(error) }
}

// PostgREST returns ISO 8601 timestamps with a numeric offset (for example
// `2026-08-23T12:34:56.789+00:00`), while Zod's default `.datetime()` only
// accepts the trailing `Z` form. Vault records are read and later written
// back by the browser, so accept either standard UTC representation.
const vaultTimestamp = z.string().trim().refine(value => (
  /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value))
), { message: 'Invalid datetime' })

const recordSchema = z.object({
  id: z.string().uuid(), recordType: z.enum(['note', 'template', 'research_document', 'research_artifact', 'report_metadata', 'attachment']),
  ciphertext: z.string().min(20).max(8_000_000), revision: z.number().int().positive().optional(),
  createdAt: vaultTimestamp.optional(), updatedAt: vaultTimestamp.optional(), deletedAt: vaultTimestamp.nullable().optional()
})

export async function listVaultRecords(req: Request, res: Response, next: NextFunction) {
  try {
    const type = z.enum(['note', 'template', 'research_document', 'research_artifact', 'report_metadata', 'attachment']).optional().parse(req.query.type)
    let query = supabase.from('vault_records').select('id,record_type,ciphertext,encryption_version,revision,created_at,updated_at,deleted_at').eq('user_id', user(req)).order('updated_at', { ascending: false })
    if (type) query = query.eq('record_type', type)
    const { data, error } = await query
    if (error) throw error
    res.json((data || []).map(row => ({ id: row.id, recordType: row.record_type, ciphertext: row.ciphertext, encryptionVersion: row.encryption_version, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at })))
  } catch (error) { next(error) }
}

export async function upsertVaultRecords(req: Request, res: Response, next: NextFunction) {
  try {
    const records = z.object({ records: z.array(recordSchema).min(1).max(100) }).parse(req.body).records
    // The Express client uses the service role, so enforce ownership before an
    // upsert conflict could ever move an opaque record between accounts.
    const { data: existing, error: existingError } = await supabase.from('vault_records').select('id,user_id,revision,created_at').in('id', records.map(record => record.id))
    if (existingError) throw existingError
    if ((existing || []).some(record => record.user_id !== user(req))) return res.status(403).json({ error: 'A vault record belongs to another account.' })
    const existingById = new Map((existing || []).map(record => [record.id, record]))
    if (records.some(record => { const current = existingById.get(record.id); return current && (record.revision || 1) <= Number(current.revision) })) return res.status(409).json({ error: 'This encrypted record changed on another device. Refresh and try again.' })
    const values = records.map(record => {
      const current = existingById.get(record.id)
      return { id: record.id, user_id: user(req), record_type: record.recordType, ciphertext: record.ciphertext, encryption_version: 2, revision: record.revision || 1, created_at: current?.created_at || record.createdAt || new Date().toISOString(), updated_at: record.updatedAt || new Date().toISOString(), deleted_at: record.deletedAt ?? null }
    })
    const { error } = await supabase.from('vault_records').upsert(values, { onConflict: 'id' })
    if (error) throw error
    res.status(201).json({ saved: values.length })
  } catch (error) { next(error) }
}

export async function setMigrationStatus(req: Request, res: Response, next: NextFunction) {
  try {
    if (env.VAULT_LEGACY_MIGRATION !== 'enabled') return res.status(403).json({ error: 'Legacy migration is disabled by configuration.' })
    const body = z.object({ status: z.enum(['copying', 'verified', 'failed']) }).parse(req.body)
    const update: Record<string, unknown> = { migration_status: body.status }
    if (body.status === 'verified') {
      const verifiedAt = new Date().toISOString()
      update.migration_verified_at = verifiedAt
      // Legacy rows remain intact. This additive marker makes it possible to
      // audit which legacy notes have a same-ID encrypted envelope.
      const { data: noteRecords, error: recordsError } = await supabase.from('vault_records').select('id').eq('user_id', user(req)).eq('record_type', 'note')
      if (recordsError) throw recordsError
      const ids = (noteRecords || []).map(record => record.id)
      if (ids.length) {
        const { error: notesError } = await supabase.from('notes').update({ vault_migrated_at: verifiedAt }).eq('user_id', user(req)).in('id', ids)
        if (notesError) throw notesError
      }
    }
    const { error } = await supabase.from('user_vaults').update(update).eq('user_id', user(req))
    if (error) throw error
    res.json({ status: body.status })
  } catch (error) { next(error) }
}

// This endpoint is intentionally temporary and is disabled by configuration
// once all accounts have completed their browser-side migration. It exposes
// legacy values only to their authenticated owner over the existing TLS API.
export async function legacyExport(req: Request, res: Response, next: NextFunction) {
  try {
    if (env.VAULT_LEGACY_MIGRATION !== 'enabled') return res.status(403).json({ error: 'Legacy migration is disabled by configuration.' })
    const userId = user(req)
    const legacyNotes = (await Promise.all(['all', 'archive', 'trash'].map(scope => notes.list(userId, scope)))).flat()
    const uniqueNotes = [...new Map(legacyNotes.map(note => [note.id, note])).values()]
    const { data: documents, error: documentsError } = await supabase.from('research_documents').select('id,filename,mime,size,content,created_at,scan_status,scan_notes').eq('user_id', userId)
    if (documentsError) throw documentsError
    const { data: artifacts, error: artifactsError } = await supabase.from('research_artifacts').select('id,job_id,stage,content,created_at').eq('user_id', userId)
    if (artifactsError) throw artifactsError
    const { data: reports, error: reportsError } = await supabase.from('report_metadata').select('*').eq('user_id', userId)
    if (reportsError) throw reportsError
    const { data: images, error: imagesError } = await supabase.from('images').select('id,note_id,mime,size,data,created_at').eq('user_id', userId)
    if (imagesError) throw imagesError
    res.json({
      notes: uniqueNotes,
      documents: (documents || []).map(item => ({ ...item, content: decryptIfPresent(userId, item.content) })),
      artifacts: (artifacts || []).map(item => ({ ...item, content: decryptIfPresent(userId, item.content) })),
      reports: reports || [],
      attachments: images || []
    })
  } catch (error) { next(error) }
}

export async function registrationOptions(req: Request, res: Response, next: NextFunction) {
  try {
    const { data, error } = await supabase.from('webauthn_credentials').select('credential_id,transports').eq('user_id', user(req)).is('revoked_at', null)
    if (error) throw error
    const options = await generateRegistrationOptions({
      rpName: webauthn.rpName,
      rpID: webauthn.rpID,
      userName: req.userEmail || user(req),
      userDisplayName: req.userEmail || 'Muse user',
      userID: new Uint8Array(Buffer.from(user(req))),
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
      excludeCredentials: (data || []).map(item => ({ id: item.credential_id, transports: (item.transports || []) as any }))
    })
    const challengeId = await createChallenge(user(req), 'registration', options.challenge)
    res.json({ options, challengeId })
  } catch (error) { next(error) }
}

export async function verifyRegistration(req: Request, res: Response, next: NextFunction) {
  try {
    const body = z.object({ challengeId: z.string().uuid(), response: z.any(), name: z.string().trim().min(1).max(80).optional() }).parse(req.body)
    const verification = await verifyRegistrationResponse({
      response: body.response as RegistrationResponseJSON,
      expectedChallenge: challenge => challengeMatches(body.challengeId, 'registration', user(req), challenge),
      expectedOrigin: webauthn.origins,
      expectedRPID: webauthn.rpID,
      requireUserVerification: true
    })
    if (!verification.verified || !verification.registrationInfo) return res.status(400).json({ error: 'Muse could not verify this passkey.' })
    const credential = verification.registrationInfo.credential
    const transports = Array.isArray((body.response as any)?.response?.transports) ? (body.response as any).response.transports : []
    const { error } = await supabase.from('webauthn_credentials').insert({
      user_id: user(req), credential_id: credential.id, public_key: Buffer.from(credential.publicKey).toString('base64url'), counter: credential.counter,
      transports, device_type: verification.registrationInfo.credentialDeviceType, backed_up: verification.registrationInfo.credentialBackedUp,
      name: body.name || 'Passkey'
    })
    if (error) throw error
    await consumeChallenge(body.challengeId)
    res.status(201).json({ verified: true })
  } catch (error) { next(error) }
}

export async function authenticationOptions(_req: Request, res: Response, next: NextFunction) {
  try {
    const options = await generateAuthenticationOptions({ rpID: webauthn.rpID, userVerification: 'required' })
    const challengeId = await createChallenge(null, 'authentication', options.challenge)
    res.json({ options, challengeId })
  } catch (error) { next(error) }
}

export async function verifyAuthentication(req: Request, res: Response, next: NextFunction) {
  try {
    const body = z.object({ challengeId: z.string().uuid(), response: z.any() }).parse(req.body)
    const response = body.response as AuthenticationResponseJSON
    const { data, error } = await supabase.from('webauthn_credentials').select('id,user_id,credential_id,public_key,counter,transports,name,created_at,last_used_at,revoked_at').eq('credential_id', response.id).is('revoked_at', null).single()
    if (error || !data) return res.status(401).json({ error: 'This passkey is not registered with Muse.' })
    const credential = data as StoredCredential
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge => challengeMatches(body.challengeId, 'authentication', null, challenge),
      expectedOrigin: webauthn.origins,
      expectedRPID: webauthn.rpID,
      credential: dbCredential(credential),
      requireUserVerification: true
    })
    if (!verification.verified) return res.status(401).json({ error: 'Muse could not verify this passkey.' })
    if (!counterAdvanced(Number(credential.counter), verification.authenticationInfo.newCounter)) return res.status(401).json({ error: 'This passkey counter moved backwards. Revoke this credential and add the device again.' })
    const { error: updateError } = await supabase.from('webauthn_credentials').update({ counter: verification.authenticationInfo.newCounter, last_used_at: new Date().toISOString(), device_type: verification.authenticationInfo.credentialDeviceType, backed_up: verification.authenticationInfo.credentialBackedUp }).eq('id', credential.id)
    if (updateError) throw updateError
    await consumeChallenge(body.challengeId)
    const { data: account } = await supabase.auth.admin.getUserById(credential.user_id)
    const email = account.user?.email || undefined
    const token = createSession(credential.user_id, email)
    res.cookie(SESSION_COOKIE, token, sessionCookie(token)).json({ authenticated: true, userId: credential.user_id, email: email || null })
  } catch (error) { next(error) }
}

export async function createFallbackSession(req: Request, res: Response, next: NextFunction) {
  try {
    const token = createSession(user(req), req.userEmail)
    res.cookie(SESSION_COOKIE, token, sessionCookie(token)).json({ authenticated: true, userId: user(req), email: req.userEmail || null })
  } catch (error) { next(error) }
}

export async function sessionStatus(req: Request, res: Response) {
  res.json({ authenticated: true, userId: user(req), email: req.userEmail || null, method: req.authMethod || 'session' })
}

export async function logout(_req: Request, res: Response) {
  res.clearCookie(SESSION_COOKIE, clearSessionCookie).status(204).end()
}

export async function listPasskeys(req: Request, res: Response, next: NextFunction) {
  try {
    const { data, error } = await supabase.from('webauthn_credentials').select('id,name,device_type,backed_up,created_at,last_used_at,revoked_at').eq('user_id', user(req)).order('created_at', { ascending: false })
    if (error) throw error
    res.json(data || [])
  } catch (error) { next(error) }
}

export async function revokePasskey(req: Request, res: Response, next: NextFunction) {
  try {
    const id = z.string().uuid().parse(req.params.id)
    const { error } = await supabase.from('webauthn_credentials').update({ revoked_at: new Date().toISOString() }).eq('id', id).eq('user_id', user(req)).is('revoked_at', null)
    if (error) throw error
    res.status(204).end()
  } catch (error) { next(error) }
}
