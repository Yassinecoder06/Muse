# Muse

Muse is a production-oriented AI note application built around one principle: **capture first, organize later**. The browser talks only to an Express API; that API owns Postgres access, AI calls, and semantic search.

## Architecture

```text
React + Vite  ──HTTP──>  Express API  ──> Supabase PostgreSQL (source of truth)
                                  ├──> Ollama Cloud (Gemma 4 + nomic embeddings)
                                  └──> Qdrant (note embeddings and metadata)
```

The API returns note saves immediately. A background processor generates missing titles, tags, summaries, and vectors after the response. Qdrant stores only embeddings and compact metadata; full note text always remains in Supabase.

## Included capabilities

- Premium responsive dashboard, dark mode, keyboard shortcuts, and command palette (`Ctrl/⌘ K`, `Ctrl/⌘ N`)
- Rich editable notes with headings, formatting, lists, checklists, code blocks, quotes, autosave, word count, and save state
- AI title generation, tag extraction, summaries, task extraction, and six rewrite modes
- “Ask this note” constrained to the active note
- RAG-powered “Ask my notes” that embeds the question, retrieves up to eight Qdrant matches, fetches those complete notes, and cites their titles
- Soft deletion with Qdrant vector cleanup, background embedding upserts, REST validation, and toast feedback

## Quick start

1. Copy the environment template and supply real secrets:

   ```bash
   cp .env.example .env
   ```

   `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` must be JWTs made with the configured `JWT_SECRET`. The Express API uses the service-role key only; it is never sent to the browser.

2. Start local infrastructure:

   ```bash
   docker compose up -d
   ```

   This starts Postgres, Kong, GoTrue Auth, PostgREST, Realtime, Storage, Meta, Studio, Edge Runtime, and Qdrant. Qdrant is available at `http://localhost:6333`; Kong/Supabase is exposed at `http://localhost:8000`.

3. Install and run the application:

   ```bash
   npm install
   npm run dev
   ```

   The client runs on `http://localhost:5173`; Express runs on `http://localhost:3001`.

4. Verify production compilation:

   ```bash
   npm run build
   ```

## Database and migration

`supabase/migrations/001_initial.sql` creates `notes`, `tags`, `note_tags`, and `tasks`, their foreign keys, indexes, UUID defaults, and the automatic `updated_at` trigger. It is mounted into the local Postgres initialization path by Docker. For an existing local volume, execute it once manually:

```bash
docker compose exec -T db psql -U postgres -d postgres < supabase/migrations/001_initial.sql
```

## AI configuration

Run Ollama locally, sign in with `ollama signin`, and set both `OLLAMA_BASE_URL` and `OLLAMA_EMBEDDING_BASE_URL` to `http://localhost:11434`. The chat model is `gemma4:31b-cloud`; local Ollama transparently routes that model through your Ollama account. Semantic search uses local `nomic-embed-text:latest`, which produces 768-dimensional vectors matching the Qdrant collection. `OLLAMA_API_KEY` is needed only when the application calls `https://ollama.com` directly, so it is not needed in this configuration.

The Qdrant collection is created at API startup with cosine distance. The included model uses a 768-dimensional embedding; if your Ollama embedding provider emits another size, recreate the `notes` collection with that model's dimension before starting the API.

## REST API

| Area | Endpoints |
| --- | --- |
| Notes | `GET /api/notes`, `GET /api/notes/:id`, `POST /api/notes`, `PUT /api/notes/:id`, `DELETE /api/notes/:id` |
| AI | `POST /api/ai/title`, `/tags`, `/summary`, `/tasks`, `/rewrite` |
| Chat | `POST /api/chat/note`, `POST /api/chat/search` |

## Future improvements

See [multi-user authentication and AI queue](MULTI_USER_AI_QUEUE.md) for the
current ownership, RLS, Qdrant filtering, and single-worker Cloud Gemma design.

- Per-user authentication and row-level security policies
- Object-storage backed image uploads in the editor
- Durable job queue for AI processing and retry history
- Chunk-aware embeddings for very long notes
