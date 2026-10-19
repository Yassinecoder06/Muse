import { config } from 'dotenv'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

// Load the repository-level environment file so Docker Compose and Express use
// the same configuration, regardless of the server process working directory.
const rootEnvFile = resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env')
config({ path: rootEnvFile })

const schema = z.object({
  SUPABASE_URL: z.string().url(), SUPABASE_ANON_KEY: z.string().min(1), SUPABASE_SERVICE_ROLE_KEY: z.string().min(1), QDRANT_URL: z.string().url(),
  OLLAMA_EMBEDDING_BASE_URL: z.string().url().default('http://localhost:11434'),
  OLLAMA_CHAT_MODEL: z.string().default('beam:cloud'), OLLAMA_EMBEDDING_MODEL: z.string().default('nomic-embed-text'),
  OLLAMA_NUM_CTX: z.coerce.number().int().min(2048).max(131072).default(32768),
  RAG_TOP_K: z.coerce.number().int().min(1).max(50).default(10),
  PUBLIC_URL: z.string().url().default('http://localhost:8080'),
  PORT: z.coerce.number().default(3002),
  // DATA_ENCRYPTION_KEY remains required while legacy rows are available for
  // migration. New secure-vault records never use it.
  DATA_ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i, 'DATA_ENCRYPTION_KEY must be 64 hex chars (32 random bytes)'),
  WEBAUTHN_RP_ID: z.string().min(1).optional(),
  WEBAUTHN_RP_NAME: z.string().min(1).default('Muse'),
  WEBAUTHN_ORIGINS: z.string().optional(),
  MUSE_SESSION_SECRET: z.string().min(32).default('muse-development-session-secret-change-before-production'),
  VAULT_LEGACY_MIGRATION: z.enum(['enabled', 'disabled']).default('enabled')
})
export const env = schema.parse(process.env)

if (process.env.NODE_ENV === 'production' && env.MUSE_SESSION_SECRET === 'muse-development-session-secret-change-before-production') {
  throw new Error('MUSE_SESSION_SECRET must be set to a unique value in production.')
}

export const webauthn = {
  rpID: env.WEBAUTHN_RP_ID || new URL(env.PUBLIC_URL).hostname,
  rpName: env.WEBAUTHN_RP_NAME,
  origins: (env.WEBAUTHN_ORIGINS || env.PUBLIC_URL).split(',').map(origin => origin.trim()).filter(Boolean)
}
