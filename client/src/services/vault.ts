import { openDB } from 'idb'
import type { Note, Task } from '../types'

const DATABASE = 'muse-secure-vault'
const STORE = 'keys'
const encoder = new TextEncoder()
const decoder = new TextDecoder()

type StoredKey = CryptoKey
export type VaultRecord = { id: string; recordType: 'note' | 'template' | 'research_document' | 'research_artifact' | 'report_metadata' | 'attachment'; ciphertext: string; revision?: number; createdAt?: string; updatedAt?: string; deletedAt?: string | null }
export type SecureNote = Note & { kind: 'note' | 'research' | 'specialized'; specialized?: SpecializedPayload }
export type SpecializedPayload = { category: 'daily' | 'workout' | 'finance' | 'custom'; templateId?: string; fields: Record<string, unknown>; aiInstruction?: string }

let database: ReturnType<typeof openDB> | undefined
let activeUserId: string | null = null
function db() {
  database ||= openDB(DATABASE, 1, { upgrade(value) { if (!value.objectStoreNames.contains(STORE)) value.createObjectStore(STORE) } })
  return database
}

function base64url(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }
function fromBase64url(value: string) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)
  return Uint8Array.from(atob(padded), char => char.charCodeAt(0))
}

export function generateRecoveryKey() { return base64url(crypto.getRandomValues(new Uint8Array(32))) }

export async function saveRecoveryKey(userId: string, recoveryKey: string) {
  const raw = fromBase64url(recoveryKey.trim())
  if (raw.length !== 32) throw new Error('Enter a 32-byte Base64URL recovery key.')
  const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
  await (await db()).put(STORE, key, userId)
}

export async function hasRecoveryKey(userId: string) { return !!await (await db()).get(STORE, userId) }
export async function forgetRecoveryKey(userId: string) { await (await db()).delete(STORE, userId) }
export function activateVault(userId: string) { activeUserId = userId }
export function deactivateVault() { activeUserId = null }
export function activeVaultUser() { return activeUserId }

async function getKey(userId: string) {
  const key = await (await db()).get(STORE, userId) as StoredKey | undefined
  if (!key) throw new Error('Unlock your Secure Vault with your recovery key.')
  return key
}

function aad(userId: string, recordId: string, version = 2) { return encoder.encode(`${userId}:${recordId}:v${version}`) }

export async function encryptVaultValue(userId: string, recordId: string, value: unknown) {
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = encoder.encode(JSON.stringify(value))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: aad(userId, recordId) }, await getKey(userId), plaintext)
  return `v2.${base64url(nonce)}.${base64url(new Uint8Array(encrypted))}`
}

export async function decryptVaultValue<T>(userId: string, recordId: string, envelope: string): Promise<T> {
  const [version, nonce, ciphertext, extra] = envelope.split('.')
  if (version !== 'v2' || !nonce || !ciphertext || extra) throw new Error('This Secure Vault record has an unsupported format.')
  try {
    const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64url(nonce), additionalData: aad(userId, recordId) }, await getKey(userId), fromBase64url(ciphertext))
    return JSON.parse(decoder.decode(clear)) as T
  } catch { throw new Error('Muse could not unlock this record. Check that you used the correct recovery key.') }
}

export async function createVaultCheck(userId: string) { return encryptVaultValue(userId, 'vault-check', { value: 'muse-vault-check', userId }) }
export async function verifyVaultCheck(userId: string, ciphertext: string) {
  const value = await decryptVaultValue<{ value?: string; userId?: string }>(userId, 'vault-check', ciphertext)
  if (value.value !== 'muse-vault-check' || value.userId !== userId) throw new Error('This recovery key does not unlock this Muse vault.')
}

export async function encryptNote(userId: string, note: SecureNote): Promise<VaultRecord> {
  return { id: note.id, recordType: 'note', ciphertext: await encryptVaultValue(userId, note.id, note), revision: 1, createdAt: note.created_at, updatedAt: note.updated_at, deletedAt: note.deleted_at }
}

export async function encryptRecord(userId: string, record: Omit<VaultRecord, 'ciphertext'>, payload: unknown): Promise<VaultRecord> {
  return { ...record, ciphertext: await encryptVaultValue(userId, record.id, payload) }
}

export async function decryptNote(userId: string, record: VaultRecord): Promise<SecureNote> {
  const value = await decryptVaultValue<SecureNote>(userId, record.id, record.ciphertext)
  return { ...value, id: record.id, created_at: record.createdAt || value.created_at, updated_at: record.updatedAt || value.updated_at, deleted_at: record.deletedAt ?? value.deleted_at }
}

export function newSecureNote(input: Partial<SecureNote> = {}): SecureNote {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(), title: '', content: '', summary: null, favorite: false, archived: false, deleted_at: null,
    created_at: now, updated_at: now, kind: 'note', tags: [], tasks: [] as Task[], ...input
  }
}
