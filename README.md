# Muse

Muse is a production-oriented AI note application built around one principle: **capture first, organize later**. The browser talks only to an Express API; that API owns Postgres access, AI calls, and semantic search.

## Architecture

```text
React + Vite  ──HTTP──>  Express API  ──> Supabase PostgreSQL (source of truth)
                                  ├──> Ollama Cloud (research and chat) + local Ollama (embeddings)
                                  └──> Qdrant (note embeddings and metadata)
```

The API returns note saves immediately. A background processor generates missing titles, tags, summaries, and vectors after the response. Qdrant stores only embeddings and compact metadata; full note text always remains in Supabase.

## Included capabilities

- Premium responsive dashboard, dark mode, keyboard shortcuts, and command palette (`Ctrl/⌘ K`, `Ctrl/⌘ N`)
- Rich editable notes with headings, formatting, lists, checklists, code blocks, quotes, autosave, word count, and save state
- A **note graph**: every note becomes a node connected to meaningfully similar notes and notes that share tags (see the Graph entry in the sidebar)
- AI title generation, tag extraction, summaries, task extraction, and six rewrite modes
- "Ask this note" constrained to the active note
- RAG-powered "Ask my notes" that embeds the question, retrieves up to eight Qdrant matches, fetches those complete notes, and cites their titles
- **Security-scanned research uploads**: documents are checked at upload time; dangerous structures are rejected outright and prompt-injection patterns are flagged so you see a warning before the text feeds an AI run
- Soft deletion with Qdrant vector cleanup, background embedding upserts, REST validation, and toast feedback

## Prerequisites

- **Node.js 20 or newer (22 LTS recommended).** The API will not start on Node 18: `@supabase/supabase-js` v2.49+ requires native WebSocket support, which only exists in Node 22+. Node 18 is end-of-life and insecure.
- **Docker + Docker Compose** for the local Supabase stack and Qdrant.
- npm 9+.

## Quick start

1. Copy the environment template and supply real secrets:

   ```bash
   cp .env.example .env
   ```

   `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` must be JWTs made with the configured `JWT_SECRET` (see "Environment file" below). The Express API uses the service-role key only; it is never sent to the browser.

2. Create the pgsodium Vault root key **before the first start**. The database
   pins its Vault encryption key to this host file; without it the container
   cannot initialize. This is the same command the Supabase image's
   `pgsodium_getkey.sh` runs when the file is absent:

   ```bash
   head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > docker/pgsodium_root.key
   chmod 644 docker/pgsodium_root.key
   ```

   The file must be readable by the database process (uid 105 in the
   container), so keep it at least `644` (or `600` with `chown 105:106`).
   Never delete `docker/pgsodium_root.key` while the `postgres-data` volume
   exists — encrypted Vault secrets become unrecoverable without it.

3. Start the Docker services:

   ```bash
   docker compose up -d --build
   ```

   This starts Postgres, Kong, GoTrue Auth, PostgREST, Realtime, Storage,
   Meta, Studio, Qdrant, the private mail-template server, the Express/AI
   worker, and the Docker Nginx gateway. This builds the server image and the
   Nginx image containing the bundled React client. Nginx
   is available at `http://localhost:8080`; Qdrant is available at
   `http://localhost:6333`; Kong/Supabase stays on `http://localhost:8000`.
   (*Edge Runtime is intentionally not included:* Muse never uses edge
   functions.)

4. Install and run Muse for hot-reload development:

   ```bash
   npm install
   npm run dev
   ```

   Open `http://localhost:5173` for the Vite client; Express runs on
   `http://localhost:3001`. The Docker Nginx gateway at
   `http://localhost:8080` will also work while Express is running, but it
   serves the client bundle built when Compose last ran.

   Use `http://localhost:8080` when you want to exercise the same Nginx proxy
   topology used in deployment. Rebuild that bundle after frontend or Nginx
   configuration edits:

   ```bash
   docker compose up -d --build nginx
   ```

5. Verify production compilation:

   ```bash
   npm run build
   ```

6. Sanity-check the running infrastructure:

   ```bash
   curl -s http://localhost:8080/health     # {"ok":true}
   curl -sI http://localhost:8080/ | head -n 1
   docker compose ps                        # db, server, kong, and nginx should be healthy
   ```

### Environment file

`.env.example` ships with the public Supabase demo keys. For a real deployment:

- Set `JWT_SECRET` to a random value **at least 32 characters** long.
- Generate `ANON_KEY` and `SERVICE_ROLE_KEY` as JWTs **signed with that same `JWT_SECRET`**, with `"role": "anon"` / `"role": "service_role"` claims. Kong accepts them as `apikey` credentials; GoTrue issues session tokens signed with `JWT_SECRET`, so all three components must agree.
- Set `DATA_ENCRYPTION_KEY` to 64 hex characters (32 random bytes) — see "Encryption at rest" below. **Back it up; it cannot be recovered.**
- Never put `POSTGRES_PASSWORD`, `JWT_SECRET`, `SERVICE_ROLE_KEY`, SMTP,
  or Ollama credentials in a `VITE_*` variable. Vite embeds those variables in
  browser JavaScript at build time. The Nginx image receives only
  `VITE_SUPABASE_ANON_KEY`, which is intentionally public.

### Encryption at rest

All user text is encrypted with **AES-256-GCM** before it reaches the database:

- **Encrypted:** note titles, note content, AI-generated summaries, extracted
  research-document text, research artifacts, and the note metadata stored in
  the Qdrant search index.
- **Encryption key:** `DATA_ENCRYPTION_KEY` in the root `.env` (64 hex
  characters = 32 bytes). Generate one with `openssl rand -hex 32`.
- **Format:** each value is stored as `v1:<base64url(nonce + auth tag +
  ciphertext)>`, bound to its owner's user id, so ciphertext cannot be swapped
  between accounts. Values fail loudly (never silently) if the key changes or
  the data was tampered with.
- **Where it happens:** the Express API encrypts on write and decrypts on
  read — the browser and the database never see the same value, and no SQL,
  search, or client change was needed.

The server validates the key at startup and refuses to start without it. For an
existing database, run the one-time idempotent backfill (it skips rows that are
already encrypted) from the server workspace:

```bash
cd server && npx tsx src/scripts/backfill-encrypt.ts
```

> **Back up `DATA_ENCRYPTION_KEY`** (e.g. in a password manager). Losing it
> while keeping the database makes every note permanently unreadable. The key
> is never sent to the browser and never committed to the repository.

### Transactional email with SMTP

Muse routes Supabase Auth's database-triggered emails through your SMTP provider. This
covers signup verification, password-reset links, secure email changes,
password-change alerts, and email-change alerts. Each message is addressed to
the account email involved: an email change sends confirmation links to both
the old and new addresses.

1. Configure an SMTP account with a sender address you are allowed to use.
   Resend, Postmark, Amazon SES, Mailgun, and a company mail relay all work.
2. Add these values to the root `.env` file. Do not put the password in any
   `VITE_*` variable or commit it.

   ```dotenv
   DISABLE_SIGNUP=false
   ENABLE_EMAIL_AUTOCONFIRM=false
   SMTP_ADMIN_EMAIL=notifications@updates.example.com
   SMTP_HOST=smtp.example.com
   SMTP_PORT=587
   SMTP_USER=your-smtp-user
   SMTP_PASS=your-smtp-password
   SMTP_SENDER_NAME=Muse
   ```

3. Recreate the Auth service so it receives the new SMTP credentials:

   ```bash
   docker compose up -d --force-recreate auth mailer-templates
   ```

4. Create a test account from Muse. The confirmation email is sent to the
   entered address. If it is not visible after a moment, check Spam or Junk.
   The same reminder appears in Muse and in the email templates.

The mailer uses the provider-neutral SMTP values from the root `.env`. The
`supabase/templates` directory is mounted by the private `mailer-templates` service, which serves
the five templates only to GoTrue on the Docker network; it has no public port.

### Updating account information

Signed-in users can open **Settings** and update their name, email address, or
password. A name change saves immediately. An email change must be confirmed
from both the current and replacement email address before it takes effect. A
password change sends a security notice to the account's email address.
Signed-out users can select **Forgot your password?** from sign-in; the emailed
recovery link opens a dedicated new-password form before returning to Muse.

## Database and migration

`supabase/migrations/001_initial.sql` creates `notes`, `tags`, `note_tags`, `tasks`, and `ai_jobs`, their foreign keys, indexes, UUID defaults, RLS policies, and the automatic `updated_at` trigger. It is mounted into the local Postgres initialization path by Docker. For an existing local volume, execute it once manually:

```bash
docker compose exec -T db sh -ec 'PGPASSWORD="$POSTGRES_PASSWORD" psql -U supabase_admin -d postgres' < supabase/migrations/001_initial.sql
```

`002_images.sql` adds the `images` table (base64-encoded binaries) behind `POST /api/uploads` / `GET /api/images/:id`. Apply it to an existing database the same way:

```bash
docker compose exec -T db sh -ec 'PGPASSWORD="$POSTGRES_PASSWORD" psql -U supabase_admin -d postgres' < supabase/migrations/002_images.sql
```

`003_api_keys.sql` enables the per-user Ollama key store in Supabase Vault and
creates service-role-only RPC helpers. It runs automatically for a newly
initialized database. For an existing healthy database, apply it once:

```bash
docker compose exec -T db sh -ec 'PGPASSWORD="$POSTGRES_PASSWORD" psql -U supabase_admin -d postgres' < supabase/migrations/003_api_keys.sql
```

The Vault encryption root key is pinned to the host file
`docker/pgsodium_root.key` (gitignored) and bind-mounted into the database
container read-only. The Supabase image only generates a key when that file is
missing, so the pinned file survives container recreations and keeps saved
Vault secrets decryptable. A fresh deployment must create it before the first
start (see "Quick start"). Keep it with `muse_postgres-data`; deleting either
independently can make saved Vault secrets unrecoverable.

`004_research_documents.sql` marks notes as standard or research documents.
Run it once on an existing database before starting the new server container:

```bash
docker compose exec -T db sh -ec 'PGPASSWORD="$POSTGRES_PASSWORD" psql -U supabase_admin -d postgres' < supabase/migrations/004_research_documents.sql
```

`005_research_pipeline.sql` adds private extracted research documents and the
saved artifacts for each staged research run. It does **not** read from your
other Muse notes. Apply it once to an existing database:

```bash
docker compose exec -T db sh -ec 'PGPASSWORD="$POSTGRES_PASSWORD" psql -U supabase_admin -d postgres' < supabase/migrations/005_research_pipeline.sql
```

`006_modular_reports.sql` adds report plans, quality results, and per-skill
execution telemetry for the modular report engine. Apply it once to an existing
database:

```bash
docker compose exec -T db sh -ec 'PGPASSWORD="$POSTGRES_PASSWORD" psql -U supabase_admin -d postgres' < supabase/migrations/006_modular_reports.sql
```

`007_document_scan.sql` adds the security-scan columns to research documents
(`scan_status`, `scan_notes`). Apply it once to an existing database:

```bash
docker compose exec -T db sh -ec 'PGPASSWORD="$POSTGRES_PASSWORD" psql -U supabase_admin -d postgres' < supabase/migrations/007_document_scan.sql
```

### Images

Images live **inside Postgres** (base64 text in `images.data`) — there is no
storage bucket and no filesystem dependency, so backups and restores carry the
binaries automatically. The editor uploads with `?noteId=<note>` so every
image row records its owning note. Note content stores relative URLs
(`/api/images/<uuid>`); the client renders them absolute and sanitizes all
HTML on every edit and load. AI rewrites replace `<img>` tags with `[IMAGE n]`
placeholders before the model call and restore them in the original position
afterwards — images can never be deleted by a rewrite.

Research reports are stored as a distinct note type and use an editorial layout
with an executive summary, analytical sections, findings, conclusion, and
sources. The Research dialog can also include up to five explicitly selected
PDF, DOCX, Markdown/text, or CSV files (10 MB each). Muse stores extracted text
for those files, combines it with web research, and records the eight workflow
artifacts—research, extraction, analysis, critical reasoning, recommendations,
structure, writing, and quality control—against the completed research job.
The Docker Nginx gateway accepts research-file requests up to 11 MB so the
server can enforce the 10 MB per-file limit itself.

### Modular reports

Research is a modular report engine, not one large writing prompt. A planner
selects skills from `server/src/services/reporting/skills.ts` according to the
Business, Technical, Financial, Research, Management, or Project
preset. Skills enrich a structured evidence representation; the writer renders
that representation, then QC can trigger up to two bounded revisions. Financial
formulas such as ROI and payback are calculated in code when their sourced
inputs are available. Each run records its plan, high-level status, artifacts,
quality result, and per-skill timing. A new skill needs a `SkillDefinition` in
the registry plus an executor path in `reporting/engine.ts`—the planner and UI
remain unchanged. Completed reports can be requested as HTML, PDF, or DOCX.

Finished reports are wrapped in a styled, self-contained document (`.muse-report`
with a meta header, KPI cards and charts for sourced numeric data, tables for
structured comparisons, and clean typography for headings, quotes, and
references) — in both light and dark themes, and preserved in PDF/DOCX exports.

## AI configuration

AI is **cloud-only and per-user**: every feature (chat, research, organize, rewrite, …) calls `https://ollama.com` directly with **the signed-in user's own Ollama API key** — no local Ollama, no sign-in queue. Each user adds their key once in the app (Settings → Ollama API key; create it at `https://ollama.com/settings/keys`). The key is validated before it is stored, encrypted at rest in the database via the Supabase **Vault** (`vault.create_secret` / pgsodium, root key seeded by `003_api_keys.sql`), is only ever decrypted server-side for the AI call, and is never returned by any endpoint (`GET /api/settings` returns just `{ "hasApiKey": true }`). A missing or revoked key is reported per request ("Add your Ollama API key in Settings…"); the server never logs it.

The available models are a curated set (Settings → Chat model):

- `gpt-oss:120b-cloud`
- `nemotron-3-super:cloud`
- `gemma4:31b-cloud` (default)

The `-cloud`/`:cloud` naming is display-only — the server strips it when calling Ollama Cloud, which expects the plain name (`gpt-oss:120b`, `nemotron-3-super`, `gemma4:31b`). The picker choice is stored per-browser and sent with every AI job. The **embedding** model stays local (`OLLAMA_EMBEDDING_BASE_URL`, default `http://localhost:11434`) so vector search never burns cloud quota — it must remain `nomic-embed-text:latest` (768-dim) or the Qdrant collection breaks.

**Usage dashboard**: Settings → Ollama Cloud usage shows your plan and the session (5-hour) and weekly (7-day) limits from `GET https://ollama.com/api/usage`, with per-model request counts.

The Qdrant `notes` collection is created at API startup with cosine distance and a 768-dimension vector size. If your Ollama embedding provider emits another size, drop the collection so the API recreates it (or create it yourself with that model's dimension) before starting the API:

```bash
curl -X DELETE http://localhost:6333/collections/notes
```

Optional AI tuning variables in `.env`:

- `OLLAMA_CHAT_MODEL` — the default chat model used when the app does not send one (default `gemma4:31b-cloud`).
- `OLLAMA_NUM_CTX` — the context window in tokens passed to the chat model (default `32768`). It also sets the character budget used to assemble retrieved context for "Ask my notes", so longer windows allow more notes per answer.
- `RAG_TOP_K` — how many Qdrant matches "Ask my notes" retrieves per question (default `10`).
- `OLLAMA_EMBEDDING_BASE_URL` / `OLLAMA_EMBEDDING_MODEL` — the local Ollama used for host-run development and embeddings only.
- `OLLAMA_EMBEDDING_BASE_URL_DOCKER` — optional Compose-server override; defaults to `http://host.docker.internal:11434`.
- `OLLAMA_BRIDGE_HOST` — Linux Docker host-gateway address used by the private `ollama-bridge` service (default `172.17.0.1`).

## REST API

| Area | Endpoints |
| --- | --- |
| Notes | `GET /api/notes`, `GET /api/notes/:id`, `POST /api/notes`, `PUT /api/notes/:id`, `DELETE /api/notes/:id` (soft), `DELETE /api/notes/:id/permanent`, bulk/restore/trash helpers |
| AI jobs | `POST /api/ai/jobs` (`summary`, `tasks`, `title`, `tags`, `rewrite` + `mode`, `research` + `topic`/`depth`/optional `documentIds`; optional `model` override), `GET /api/ai/jobs/:id`, `GET /api/ai/jobs/:id/artifacts`, `GET /api/models`, `GET /api/ai/usage` |
| Research files | `POST /api/research/documents` (authenticated raw PDF, DOCX, Markdown/text, or CSV body; `X-Research-Filename`; 10 MB) |
| Report export | `GET /api/reports/:noteId/export?format=html|pdf|docx` |
| Graph | `GET /api/graph` — note nodes and similarity/tag edges, derived from the existing Qdrant vectors (cached 30 s) |
| Chat | `POST /api/chat/note`, `POST /api/chat/search` (both accept optional `model`) |
| Images | `POST /api/uploads` (raw body, ≤5 MB, optional `?noteId`), `GET /api/images/:id` (public by UUID) |

Muse has no synchronous AI endpoints — every AI call is a job in `ai_jobs` that a background worker processes, and the client polls `GET /api/ai/jobs/:id`.
The per-user Ollama API key lives in `user_settings` via `GET|PUT|DELETE /api/settings` (never returned), encrypted in Postgres Vault.

See `documentation/ENDPOINTS.md` for the full API reference, and
`documentation/TROUBLESHOOTING.md` for a symptom-by-symptom operations guide.

## Deploy with Docker Nginx and Cloudflare Tunnel

This setup exposes one HTTPS hostname while keeping Postgres, Qdrant, Ollama,
Kong, and Express private. Cloudflare Tunnel provides the public HTTPS entry
point; the Compose-managed Nginx service builds and serves the React client,
then proxies internal paths.

```text
Browser -> https://notes.example.com -> Cloudflare Tunnel -> Docker Nginx (127.0.0.1:8080)
                                                                   |- /api/* -> Express + AI worker (Compose)
                                                                   |- /uploads/* -> Express + AI worker (Compose)
                                                                   `- Supabase paths -> Kong (Compose network)
```

1. Create a production `.env` with unique secrets. The values built into the
   Nginx image use the public domain. Compose gives the Express API private
   service-name access to Supabase and Qdrant, so do not override those URLs
   in production:

   ```dotenv
   PUBLIC_URL=https://notes.example.com
   # The Compose server defaults to host.docker.internal:11434 for local Ollama.
   # Set only when embeddings are provided somewhere else.
   OLLAMA_EMBEDDING_BASE_URL_DOCKER=https://embeddings.example.com
   ```

2. Add `https://notes.example.com` to the CORS origins in `docker/supabase/kong.yml`
   (`plugins` → `cors` → `config.origins`).

   `PUBLIC_URL` is passed to the browser build, GoTrue, and Express CORS when
   Compose starts. Therefore set it before running the build command; changing
   it later requires `docker compose up -d --build nginx` and recreating Auth:

   ```bash
   docker compose up -d --build nginx
   docker compose up -d --force-recreate auth
   ```

3. Keep host port mappings private. Express, the AI worker, Kong, and Qdrant
   communicate on the Compose network; only Nginx needs a web port:

   ```yaml
   # docker-compose.yml
   nginx:
     ports: ["127.0.0.1:8080:80"]
   ```

   Do not map Studio, Postgres, Qdrant, or Kong to public interfaces. The
   Docker Nginx service has the only web port (`127.0.0.1:8080`) and accesses
   Kong by its Compose service name.

4. Build and start the Docker stack. The Nginx build injects only the public
   anon key and browser URLs; it does not include the service-role key or any
   other server secret:

   ```bash
   docker compose up -d --build
   ```

   The reverse-proxy configuration is committed at
   `docker/nginx/default.conf`: `/api` and `/uploads` reach the internal
   Express service, while `/auth/v1`, `/rest/v1`, `/storage/v1`, and
   `/realtime/v1` reach Kong on the Compose network. The Nginx host binding is
   deliberately loopback-only (`127.0.0.1:8080:80`).

5. The `server` Compose service owns both Express and the AI worker. Rebuild
   it after server changes, or rebuild the complete application after shared
   dependency changes:

   ```bash
   docker compose up -d --build server nginx
   ```

6. In Cloudflare, create a Tunnel and add a **Published application** route:

   ```text
   Hostname: notes.example.com
   Service URL: http://127.0.0.1:8080
   ```

   If the connector runs in Docker, give it host networking so it can reach
   this loopback-only listener. The Cloudflare dashboard supplies the private
   tunnel token.

Only Cloudflare is public in this design. Do not open inbound ports `80`,
`443`, `3001`, `8000`, `5432`, or `6333` for Muse.

For a local setup, the tunnel ingress must point to `http://localhost:8080`.
The Nginx container forwards `/api` to Express on port `3001`; do not point a
tunnel directly to Express.

## Verify a production deployment

After the full stack is up, confirm every layer end to end:

```bash
docker compose ps --format "table {{.Name}}\t{{.Status}}"   # db, server, kong & nginx healthy
docker compose exec server node -e "fetch('http://127.0.0.1:3001/health').then(r => r.json()).then(console.log)"
curl -s http://localhost:8080/health                         # same health check through Nginx
curl -sI https://notes.example.com/ | head -n 1             # 200 or 30x
```

Then exercise auth and notes against the public host. The commands below reuse
the anon key from `.env` so no secret appears in your shell history:

```bash
# Sign up. Your SMTP provider delivers an email-confirmation link; open it before running
# the sign-in command below.
ANON=$(grep -m1 '^ANON_KEY=' .env | cut -d= -f2-)
curl -s -X POST https://notes.example.com/auth/v1/signup \
  -H "apikey: $ANON" -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"Password123!"}'

# After opening the confirmation link, sign in and capture the access token.
TOKEN=$(curl -s -X POST https://notes.example.com/auth/v1/token?grant_type=password \
  -H "apikey: $ANON" -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"Password123!"}' \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).access_token||''))")

# Create and list a note through Nginx -> Express -> Supabase.
curl -s -X POST https://notes.example.com/api/notes \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Hello","content":"World"}' | head -c 200
curl -s https://notes.example.com/api/notes -H "Authorization: Bearer $TOKEN" | head -c 300
```

An empty `TOKEN` after confirming the email means sign-in failed; check the
GoTrue container:

```bash
docker compose logs auth --tail 20
```
