import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { env } from './env.js'

// AES-256-GCM encryption for user text at rest. Each value is self-describing:
// v1:<base64url(nonce || authTag || ciphertext)>. The user id is bound to the
// ciphertext as additional authenticated data so values cannot be swapped
// between users without failing authentication.
const PREFIX = 'v1:'
const ALGORITHM = 'aes-256-gcm'
const NONCE_LENGTH = 12
const TAG_LENGTH = 16

const key = Buffer.from(env.DATA_ENCRYPTION_KEY, 'hex')

export function isEncrypted(value: unknown) {
  return typeof value === 'string' && value.startsWith(PREFIX)
}

export function encrypt(userId: string, value: string) {
  if (isEncrypted(value)) return value
  const nonce = randomBytes(NONCE_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, nonce)
  cipher.setAAD(Buffer.from(userId, 'utf8'))
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return `${PREFIX}${Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString('base64url')}`
}

export function decrypt(userId: string, value: string) {
  if (!isEncrypted(value)) return value
  try {
    const raw = Buffer.from(value.slice(PREFIX.length), 'base64url')
    if (raw.length <= NONCE_LENGTH + TAG_LENGTH) return value
    const nonce = raw.subarray(0, NONCE_LENGTH)
    const tag = raw.subarray(NONCE_LENGTH, NONCE_LENGTH + TAG_LENGTH)
    const ciphertext = raw.subarray(NONCE_LENGTH + TAG_LENGTH)
    const decipher = createDecipheriv(ALGORITHM, key, nonce)
    decipher.setAAD(Buffer.from(userId, 'utf8'))
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  } catch {
    throw new Error('Muse could not decrypt a stored value; the encryption key or data integrity is wrong.')
  }
}

export function encryptIfPresent(userId: string, value: string | null | undefined) {
  if (typeof value !== 'string' || !value) return value
  return encrypt(userId, value)
}

export function decryptIfPresent(userId: string, value: string | null | undefined) {
  if (typeof value !== 'string' || !value) return value
  return decrypt(userId, value)
}
