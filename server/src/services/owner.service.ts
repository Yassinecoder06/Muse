import { randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto'
import { supabase } from '../supabase/client.js'
import { env } from '../utils/env.js'

// Muse runs as a single-owner, local-first app. The owner unlocks the API with
// a passphrase; its scrypt hash and a random session salt live in app_owner.
// The salt is mixed into the session signing key, so the well-known default
// MUSE_SESSION_SECRET is never enough on its own to forge a session.

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
const KEY_LENGTH = 32

type OwnerRow = { passphrase_hash: string; session_salt: string }

let cached: OwnerRow | null | undefined
let loading: Promise<OwnerRow | null> | null = null
// Shown once in the server log while no passphrase exists, so only someone
// with access to the host (not anyone on the LAN) can claim the instance.
let setupCode: string | null = null

function derive(passphrase: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => scrypt(passphrase.normalize('NFKC'), salt, KEY_LENGTH, SCRYPT, (error, key) => error ? reject(error) : resolve(key)))
}

async function hashPassphrase(passphrase: string) {
  const salt = randomBytes(16)
  const key = await derive(passphrase, salt)
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${key.toString('base64url')}`
}

async function passphraseMatches(passphrase: string, stored: string) {
  const [scheme, , , , salt, expected] = stored.split('$')
  if (scheme !== 'scrypt' || !salt || !expected) return false
  const actual = await derive(passphrase, Buffer.from(salt, 'base64url'))
  const wanted = Buffer.from(expected, 'base64url')
  return actual.length === wanted.length && timingSafeEqual(actual, wanted)
}

function codesMatch(received: string, expected: string) {
  const a = Buffer.from(received.trim().toUpperCase())
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

function newSetupCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const pick = () => Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join('')
  return `${pick()}-${pick()}`
}

async function load(): Promise<OwnerRow | null> {
  if (cached !== undefined) return cached
  loading ??= (async () => {
    const { data, error } = await supabase.from('app_owner').select('passphrase_hash, session_salt').eq('id', 1).maybeSingle()
    if (error) throw error
    cached = data as OwnerRow | null
    return cached
  })().finally(() => { loading = null })
  return loading
}

export class OwnerError extends Error {
  constructor(message: string, public statusCode: number) { super(message) }
}

export const owner = {
  async init() {
    const row = await load()
    if (!row) {
      setupCode = newSetupCode()
      console.log(`\n  Muse setup code: ${setupCode}\n  Enter it in the browser to choose the owner passphrase.\n`)
    }
  },

  async configured() { return !!(await load()) },

  async setup(passphrase: string, code: string) {
    if (await load()) throw new OwnerError('Muse already has an owner passphrase.', 409)
    if (!setupCode || !codesMatch(code, setupCode)) throw new OwnerError('That setup code is not correct. Find it in the Muse server log.', 403)
    const row = { id: 1, passphrase_hash: await hashPassphrase(passphrase), session_salt: randomBytes(32).toString('base64url') }
    const { error } = await supabase.from('app_owner').insert(row)
    if (error) throw error.code === '23505' ? new OwnerError('Muse already has an owner passphrase.', 409) : error
    cached = { passphrase_hash: row.passphrase_hash, session_salt: row.session_salt }
    setupCode = null
  },

  async verify(passphrase: string) {
    const row = await load()
    if (!row) return false
    return passphraseMatches(passphrase, row.passphrase_hash)
  },

  // Synchronous on purpose: callers run `await owner.ready()` first.
  signingKey(purpose: string) {
    if (!cached) return null
    return `${purpose}:${env.MUSE_SESSION_SECRET}:${cached.session_salt}`
  },

  ready() { return load() }
}

/** Tests only: pretend the owner row is loaded, so no database is needed. */
export function primeOwnerForTests(row: OwnerRow | null) {
  cached = row
}
