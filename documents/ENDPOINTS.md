# Muse API and system reference

Last reviewed: **2026-08-14**. This reference describes the current
Compose-managed Nginx, Supabase, Resend, and Express setup.

## Architecture

```text
┌────────────────────────────────── Browser ──────────────────────────────────┐
│ React client                                                                  │
└───────────────┬───────────────────────────────────────┬──────────────────────┘
                │ /api/*, /uploads/*                    │ /auth|rest|storage|
                │ Bearer token                           │ realtime/v1/*
                ▼                                       ▼
┌──────────────────────────── Docker Nginx :8080 ─────────────────────────────┐
│ Public entry point · Cloudflare Tunnel may sit in front of this service       │
└──────────────────────────────┬──────────────────────────────┬───────────────┘
                               │                              │
                               ▼                              ▼
┌─────────────────────── Muse application ────────┐  ┌──── Supabase gateway ──┐
│ Express API + queued AI worker (`server`)        │  │ Kong (`kong`)          │
│ • notes, images, documents, reports, exports     │  └──────────┬─────────────┘
│ • report planner, skills, QC, revisions          │             │
└───────┬───────────────┬──────────────────┬───────┘     ┌───────┼───────────────┐
        │               │                  │             ▼       ▼               ▼
        ▼               ▼                  ▼          GoTrue  PostgREST      Realtime /
  Ollama Cloud       Qdrant        host Ollama          Auth    / Storage      Storage API
  chat + reports   note vectors   embeddings                 \      │          /
        │               │                  ▲                     ▼
        │               └──────────────────┴──────────── PostgreSQL + Vault
        │                                  source of truth · named volumes
        └──────────────── signed-in user's encrypted API key ─────────────────┘
```

**Request ownership:** Nginx is the only browser-facing gateway. Kong owns
Supabase paths; Express owns Muse `/api/*` paths. Qdrant stores derived note
vectors only—PostgreSQL stores notes, report inputs, artifacts, and metadata.

During hot-reload development the browser uses Vite at `http://localhost:5173`
and Express at `http://localhost:3001`. The Docker gateway serves the built
frontend at `http://localhost:8080`.

All `/api/*` endpoints require `Authorization: Bearer <GoTrue access token>`
unless the table below says otherwise.

## Express API

### Public and images

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| GET | `/health` | — | `{ "ok": true }` |
| POST | `/api/uploads` | Raw JPEG, PNG, GIF, WebP, or AVIF body (≤5 MB); optional `?noteId=<uuid>` | 201 `{ url: "/api/images/<uuid>" }` |
| GET | `/api/images/:id` | Optional Bearer token or `?token=` | Image bytes; public by unguessable UUID |
| POST | `/api/research/documents` | Raw PDF, DOCX, Markdown/text, or CSV body (≤10 MB), `X-Research-Filename` header | 201 extracted-document metadata |
| GET | `/uploads/*` | — | Legacy files from `server/uploads` |

Both upload endpoints require authentication. Images are stored in
`public.images` as base64 data and are returned with a relative API URL. The
legacy `/uploads/*` route remains only for old filesystem-backed notes.
Research files are parsed server-side and stored as extracted text in
`public.research_documents`; their original binary is not retained.

### Notes

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| GET | `/api/notes` | `?scope=all\|favorites\|archive\|trash` | `Note[]` |
| POST | `/api/notes` | `NoteInput` | 201 `Note` |
| GET | `/api/notes/:id` | — | `Note` |
| PUT | `/api/notes/:id` | Partial `NoteInput` | `Note` |
| DELETE | `/api/notes/:id` | — | 204; soft-delete |
| POST | `/api/notes/:id/restore` | — | `Note` |
| DELETE | `/api/notes/:id/permanent` | — | 204; hard-delete and remove vector |
| DELETE | `/api/notes/bulk` | `{ ids: uuid[] }`, 1–100 | 204 |
| POST | `/api/notes/bulk-restore` | `{ ids: uuid[] }`, 1–100 | 204 |
| DELETE | `/api/notes/trash` | — | 204; permanently remove all trashed notes |
| DELETE | `/api/notes/:id/summary` | — | `Note` with summary cleared |
| DELETE | `/api/notes/:id/tasks` | — | `Note` with tasks cleared |
| POST | `/api/notes/:id/organize` | — | 202 `AiJob` |
| PATCH | `/api/tasks/:taskId` | `{ completed: boolean }` | `Task` |

`NoteInput` is `{ title?, content?, favorite?, archived?, tags? }`. Limits:
title ≤300 characters, content ≤100,000 characters, and up to six tags of at
most 50 characters. `Note` includes `tags` and `tasks` arrays.

### AI jobs and chat

All of these endpoints require an Ollama key saved by the signed-in user. A
missing key returns HTTP 400 with a setup message. Jobs are asynchronous—poll
the returned job using `GET /api/ai/jobs/:id`.

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| POST | `/api/ai/jobs` | `{ noteId?, type, mode?, topic?, depth?, model? }` | 202 `AiJob` + `queuePosition` |
| GET | `/api/ai/jobs/:id` | — | `AiJob` |
| GET | `/api/ai/active` | — | `{ running, type? }` |
| GET | `/api/models` | — | Curated model names |
| GET | `/api/ai/usage` | — | `{ configured, plan?, session?, weekly? }` |
| POST | `/api/chat/note` | `{ noteId, question, history?, model? }` | 202 `AiJob` |
| POST | `/api/chat/search` | `{ question, history?, model? }` | 202 `AiJob` |

`type` is one of `summary`, `tasks`, `title`, `tags`, `rewrite`, or `research`.
Rewrite modes are `improve`, `professional`, `friendly`, `shorter`, `longer`,
and `grammar`. Research depths are `concise`, `standard`, and `in-depth`.
Research requests may additionally include `documentIds`, with up to five IDs
returned by `POST /api/research/documents`. `GET /api/ai/jobs/:id` exposes the
current workflow stage while it runs; `GET /api/ai/jobs/:id/artifacts` returns
the saved stage artifacts for that research job.

For `type: "research"`, optional fields are `title`, `reportType`
(`business`, `technical`, `financial`, `research`, `management`, or `project`),
`objective`, `audience`, `instructions`, and `outputFormat`
(`html`, `pdf`, or `docx`). The planner selects the preset skill set and saves
the plan, QC result, bounded revisions, and stage telemetry with the report.

### Report export

| Method | Path | Response |
| --- | --- | --- |
| GET | `/api/reports/:noteId/export?format=html|pdf|docx` | Authenticated download of a research report |
Chat history holds at most six `{ role: "user"|"assistant", text }` turns.

Only one queued or processing AI job is allowed per user. Standard completed
jobs are retained for one hour and failed jobs for 24 hours; research jobs are
retained with their report artifacts. The worker requeues stuck processing work
after 15 minutes.

### Per-user Ollama key

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| GET | `/api/settings` | — | `{ hasApiKey: boolean }` |
| PUT | `/api/settings` | `{ apiKey: string }` | `{ hasApiKey: true }` |
| DELETE | `/api/settings` | — | `{ hasApiKey: false }` |

The API validates the key before saving. It is never returned to the browser;
it is stored in Supabase Vault and only the Express service-role client can use
the Vault RPC functions.

## Supabase Auth through Kong

The browser uses the Supabase client against `${PUBLIC_URL}/auth/v1`. These
routes are provided by GoTrue through Kong, not Express.

| Operation | Client call | Result |
| --- | --- | --- |
| Sign up | `supabase.auth.signUp({ email, password, options: { data } })` | Sends a Resend confirmation email; sign-in requires confirmation |
| Sign in | `supabase.auth.signInWithPassword({ email, password })` | Returns a session/access token |
| Forgot password | `supabase.auth.resetPasswordForEmail(email, { redirectTo })` | Sends a recovery email without disclosing whether an account exists |
| Complete recovery | `supabase.auth.updateUser({ password })` | Updates the password from the recovery session opened by the emailed link |
| Update name | `supabase.auth.updateUser({ data: { full_name } })` | Updates user metadata immediately |
| Change email | `supabase.auth.updateUser({ email })` | Sends confirmation to current and new addresses |
| Change password | `supabase.auth.updateUser({ password })` | Updates password and sends a security notification |
| Sign out | `supabase.auth.signOut()` | Clears the current session |

GoTrue uses Resend SMTP (`smtp.resend.com:465`, user `resend`) with
`RESEND_API_KEY`, `RESEND_FROM_EMAIL`, and `RESEND_FROM_NAME` from the root
`.env`. Signup and account-change templates live in `supabase/templates` and
are served privately by `mailer-templates`. Recipients should check Spam or
Junk if a message does not arrive.

## Data, migrations, and persistence

| Resource | Docker volume or source | Purpose |
| --- | --- | --- |
| PostgreSQL | `muse_postgres-data` | Auth, notes, uploaded research text, research artifacts, tasks, jobs, images, and Vault data |
| pgsodium root key | `muse_pgsodium-key` | Persistent root key for Vault encryption |
| Storage | `muse_storage-data` | Supabase Storage service data |
| Qdrant | `muse_qdrant-data` | Note embeddings and metadata |
| Supabase roles | `docker/supabase/roles.sql` | Internal database login roles |
| App migrations | `supabase/migrations/001_initial.sql` through `006_modular_reports.sql` | App tables, images, report pipeline data, telemetry, and encrypted API-key RPCs |

The database initialization mounts all six migrations. For a healthy existing
database that predates a migration, apply it once with `psql`. Do not delete
`muse_pgsodium-key` separately from `muse_postgres-data`; saved Vault secrets
depend on both.

## Infrastructure and configuration

| Service | Host port | Purpose |
| --- | --- | --- |
| `nginx` | `127.0.0.1:8080` | Built React client and reverse proxy |
| `kong` | `127.0.0.1:8000`, `8443` | Supabase API gateway |
| `studio` | `127.0.0.1:3000` | Supabase Studio |
| `qdrant` | `127.0.0.1:6333`, `6334` | Vector database |
| `db`, `auth`, `rest`, `storage`, `realtime`, `meta`, `mailer-templates` | Internal only | Supabase services and email templates |

`PUBLIC_URL` must be the exact browser origin served by the Nginx gateway. It
is used at Nginx build time, by GoTrue for email links, and by Express CORS.
After changing it, rebuild Nginx and recreate Auth:

```bash
docker compose up -d --build nginx
docker compose up -d --force-recreate auth
```

The Nginx configuration is `docker/nginx/default.conf`. The Supabase Kong
configuration and database role script are in `docker/supabase`.

## AI pipeline

Chat uses the per-browser selected Ollama Cloud model. Reports automatically
route extraction/citations to `gemma4:31b-cloud`, analysis/planning to
`nemotron-3-super:cloud`, and writing/QC to `gpt-oss:120b-cloud`, using the
signed-in user's encrypted Ollama Cloud API key. Embeddings stay local at
`OLLAMA_EMBEDDING_BASE_URL` using `nomic-embed-text` (768 dimensions), so
semantic search does not spend cloud quota.

Qdrant stores vectors and compact metadata only; PostgreSQL remains the source
of truth for note content. If the embedding dimension changes, delete the
derived `notes` collection and restart the API so it is recreated.
