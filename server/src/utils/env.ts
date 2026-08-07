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
  OLLAMA_API_KEY: z.string().optional(), OLLAMA_BASE_URL: z.string().url(),
  OLLAMA_EMBEDDING_BASE_URL: z.string().url().default('http://localhost:11434'),
  OLLAMA_CHAT_MODEL: z.string().default('gemma4:31b'), OLLAMA_EMBEDDING_MODEL: z.string().default('nomic-embed-text'),
  OLLAMA_NUM_CTX: z.coerce.number().int().min(2048).max(131072).default(32768),
  RAG_TOP_K: z.coerce.number().int().min(1).max(50).default(10),
  PORT: z.coerce.number().default(3001)
})
export const env = schema.parse(process.env)
