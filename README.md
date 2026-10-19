# Muse

Muse is a self-hosted AI note application built around one principle: **capture first, organize later**. Write or dictate a thought, and Muse titles, tags, summarizes and links it for you, while **Bip**, its robot assistant, can create notes, tasks, events and reminders from a single sentence. It runs on your own machine, works with the AI providers *you* choose (Gemini, OpenAI, Claude, Ollama or any compatible API), and comes with a phone companion app.

The browser and the phone talk only to an Express API; that API owns Postgres access, AI calls, and semantic search.

## Architecture

```text
React + Vite (web) ──┐
                     ├─HTTPS─> Nginx ─> Express API ──> Supabase PostgreSQL (source of truth, Vault for keys)
Flutter (phone) ─────┘                      ├──> Your AI providers: Gemini · OpenAI · Anthropic (Claude) ·
                                            │    Ollama Cloud · Ollama (Local) · any OpenAI/Anthropic-compatible API
                                            ├──> Qdrant (note embeddings, one collection per embedding model)
                                            └──> Edge neural voices (built-in read-aloud)
```

The API returns note saves immediately. A background processor generates missing titles, tags, summaries, and vectors after the response. Qdrant stores only embeddings and compact metadata; full note text always remains in Supabase.

For a full technical list of all API endpoints and schemas, see [ENDPOINTS.md](./ENDPOINTS.md).

## Included capabilities

### Notes & knowledge
- **Capture first, organize later**: notes save instantly; a background worker adds titles, tags, summaries and search vectors afterwards.
- **Rich editor**: headings, lists, quotes, code, pasted images (stored in Postgres), read/edit modes, keyboard shortcuts and a command palette (`Ctrl/⌘ K`, `Ctrl/⌘ M`).
- **AI writing tools**: summarize, extract tasks, generate titles and tags, and rewrite (improve, professional, friendly, shorter, longer, grammar). Images survive rewrites untouched.
- **Search by words and by meaning**: keyword search plus semantic search over your notes, and "Ask my notes" / "Ask this note" answers grounded in your own writing.
- **Knowledge graph**: every note is a node linked to similar notes (by embeddings) and shared tags.
- **Specialized notes & templates**: Gym workout, Daily plan & reflection, Expense & decision, plus your own templates with custom fields, accent colors and optional calendar sync.
- **Research reports**: multi-stage web + document research with uploaded PDF/DOCX/TXT sources (security-scanned for macro and prompt-injection patterns), quality checks, and export to HTML, PDF or DOCX.
- **KaTeX math**: `$$…$$` and `$…$` formulas render cleanly.
- **Bulk actions, favorites, archive and trash** with restore.

### Bip, your AI assistant
- **One sentence, many actions**: "add a task to call mom tomorrow at 3pm, remind me 10 minutes before, and put the meeting on my calendar" runs every step through tools.
- **Works on any chat model** you configure: tool calls are normalized across Gemini, OpenAI-style, Anthropic and Ollama APIs, with your fallback models tried in order.
- **Safe by design**: deletions that can't be undone (empty trash, delete forever, delete tasks/events/memories) are only *proposed*; you confirm them on a card. Text from notes, documents and web pages is treated as data, never as instructions.
- **Remembers you**: long-term memories of your preferences and goals, and persistent conversations you can rename, search, edit and resend.
- **Understands your time**: "tomorrow at 8pm" resolves in your own timezone, on the web and on the phone.
- **A real companion**: a draggable animated robot with moods and synthesized sound effects.

### Tasks, calendar & reminders
- **Tasks** with due dates, times, priorities and links to notes; **calendar** with month view and natural-language quick add ("Gym tomorrow at 20h").
- **Schedule detector**: finds dates, appointments and to-dos in a note and adds them in one click.
- **Reminders with Bip alarms**: ring at the due time, N minutes before, or at an exact time. On the web: an animated Bip alert with a live countdown, alarm sound and browser notification. On the phone: a real alarm (alarm sound until handled, over the lock screen, live countdown, Done / Snooze). Snoozing on one device updates the other.

### Bring your own AI
- **Any provider, any number of keys**: Google Gemini, OpenAI, Anthropic (Claude), Ollama Cloud, Ollama (Local), and any OpenAI- or Anthropic-compatible API (Groq, Mistral, DeepSeek, OpenRouter, LM Studio, …). Keys are encrypted in Supabase Vault.
- **Fetch models**: one click lists every model your keys can use, sorted into chat, embeddings, text-to-speech and speech-to-text, next to built-in options (Edge neural voices, browser/phone speech, local-Ollama embeddings).
- **Pick a model per job**: chat model with ordered fallbacks, embedding model (your notes are re-indexed automatically), read-aloud model and voice, dictation model, each with a **Test** button.
- **Quota resilient**: models that hit their quota are skipped for a while, so answers stay fast.

### Voice
- **Dictation** that keeps listening until you stop (browser, server model of your choice, or on-device on the phone).
- **Read aloud** with Edge neural voices, OpenAI or Gemini voices, or the browser voice; emojis and symbols are skipped for natural speech.

### Phone companion (Flutter, Android)
- **Pairing in seconds** with a QR code or 6-digit PIN; the device key is stored in the Android Keystore and can be revoked from the desktop at any time.
- **Bip on the go** with voice, history, tappable action cards and delete confirmations.
- **Notes that work offline**: read, edit and create without a connection; changes sync automatically when Muse is reachable, and conflicting desktop edits are kept as a separate copy, never overwritten.
- **Share to Muse** from any app (text, links, screenshots), **home-screen shortcuts** (Voice note, Quick note, Ask Bip), **swipe actions with Undo**, semantic search, and responsive layouts tested on real phone sizes.

### Security & privacy
- **Self-hosted, single-owner**: the API requires the owner's passphrase session (or a paired device token); first-run setup needs a one-time code printed in the server log.
- **Encryption at rest** (AES-256-GCM) for note titles, content, summaries and research text; API keys live in Supabase Vault; an optional zero-knowledge **Secure Vault** encrypts notes in the browser with passkey support.
- **Hardened by default**: row-level security on every table, rate-limited login and pairing, sanitized HTML (DOMPurify), hashed device tokens, and private read-aloud audio.
- **Automatic database migrations**: `docker compose up` applies new schema changes safely, one transaction per migration.

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
   functions.) The one-shot `migrate` service applies the database schema
   before the API starts.

   **First run:** open `http://localhost:8080`. Muse asks for a one-time setup
   code and a passphrase. The code is printed in the server log:

   ```bash
   docker compose logs server | grep "setup code"
   ```

   Then open **Settings → AI providers**, add your keys (or just local Ollama),
   click **Fetch models**, and pick a model for each job.

4. Install and run Muse for hot-reload development:

   ```bash
   npm install
   npm run dev
   ```

   Open `http://localhost:5174` for the Vite client; Express runs on
   `http://localhost:3002`. The Docker Nginx gateway at
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

The schema lives in `supabase/migrations/NNN_*.sql`. **You never apply these by
hand.** The one-shot `migrate` Compose service runs on every
`docker compose up`. It applies any migration this database has not run yet, in
filename order and one transaction per file, and records it in
`public.schema_migrations`. The API container waits for it to finish, so Muse
never starts against an outdated schema. If a migration fails, it is rolled
back, the API does not start, and the error shows in
`docker compose logs migrate`.

- **Fresh install:** every migration is applied on first start.
- **Existing database from before the runner:** on its first run, the runner
  recognises which migrations are already present (by their tables and
  columns), records them, and applies only the missing ones.
- **Adding a migration:** create the next numbered file, e.g.
  `018_something.sql`, then run `docker compose up -d`. Prefer `if not exists`
  where you can.

To apply migrations without restarting anything else:

```bash
docker compose run --rm migrate
```

The Vault encryption root key is pinned to the host file
`docker/pgsodium_root.key` (gitignored) and bind-mounted into the database
container read-only. The Supabase image only generates a key when that file is
missing, so the pinned file survives container recreations and keeps saved
Vault secrets decryptable. A fresh deployment must create it before the first
start (see "Quick start"). Keep it with `muse_postgres-data`; deleting either
independently can make saved Vault secrets unrecoverable.

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

### AI providers (bring your own keys)

Open **Settings → AI providers**:

1. **Add provider**: choose Google Gemini, OpenAI, Anthropic (Claude), Ollama Cloud, Ollama (Local), or an OpenAI-/Anthropic-compatible API. Compatible providers need a name and base URL, for example Groq `https://api.groq.com/openai/v1`, Mistral `https://api.mistral.ai/v1`, DeepSeek `https://api.deepseek.com/v1`, OpenRouter `https://openrouter.ai/api/v1`, or LM Studio `http://localhost:1234/v1`. Keys are stored in Supabase Vault and only their last 4 characters are ever shown.
2. **Fetch models**: Muse asks every provider which models your key can use and sorts them into chat, embedding, text-to-speech and speech-to-text. A rejected key shows an error on that provider's card.
3. **Which model does what**: choose a chat model and its fallbacks (tried in order), an embedding model, a read-aloud model and voice, and a dictation model, then **Save choices**. Each has a **Test** button.

Leaving a choice empty keeps Muse's automatic behavior (Gemini cascade, then Ollama; local-Ollama embeddings; Edge voices). Changing the embedding model rebuilds your search index in the background; each embedding model has its own Qdrant collection, so switching back is safe. Local Ollama's address is resolved by the server (`host.docker.internal` in Docker, `localhost` in development). Base URLs may point to private network addresses (for local and LAN models), but never to Muse's own internal services.

### Secure Vault, passkeys, and recovery keys

Muse now supports a **Secure Vault** with optional passkeys. Email/password
sign-in remains available; after sign-in, each account must set up its vault
before opening Muse. Setup stores an Ollama API key in Supabase Vault and
generates or imports a required 32-byte Base64URL AES recovery key. The user
can choose to add a device passkey during setup or later in Devices & Security.

- A passkey authenticates a device. Muse stores its public credential, ID,
  counter, and transport metadata; the authenticator keeps the private key.
- The recovery key decrypts content. It is converted to a non-extractable
  browser `CryptoKey` in IndexedDB and is never sent to Supabase Vault,
  Postgres, logs, or email. Save it in a password manager or another safe
  place. On a new device, sign in with email/password (or a passkey, if one
  exists), then enter the same recovery key. The user may add a passkey there;
  it must never replace the encryption key.
- New Secure Vault content is AES-256-GCM encrypted in the browser with a
  unique nonce and AAD bound to user, record ID, and envelope version. Search,
  tags, tasks, and graph data are derived after local unlock.
- For existing accounts, the first unlocked browser copies legacy content into
  encrypted envelopes, preserves logical IDs/timestamps, verifies the copy,
  and leaves legacy rows untouched. See
  [Security and migration](documentation/SECURITY_AND_MIGRATION.md).

Secure Vault configuration:

```dotenv
WEBAUTHN_RP_ID=notes.example.com
WEBAUTHN_RP_NAME=Muse
WEBAUTHN_ORIGINS=https://notes.example.com
MUSE_SESSION_SECRET=<at-least-32-random-characters>
VAULT_LEGACY_MIGRATION=enabled
```

`MUSE_SESSION_SECRET` and `VAULT_LEGACY_MIGRATION` apply to every Secure Vault
account. The WebAuthn values apply when passkeys are enabled; WebAuthn requires
HTTPS in production. `WEBAUTHN_RP_ID` is a hostname, not a URL, and must match
or be a registrable suffix of the browser origin. Keep `DATA_ENCRYPTION_KEY`
while legacy data exists; it decrypts only retained legacy rows and is not used
for new vault envelopes.

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
| Calendar | `GET /api/calendar/events`, `POST /api/calendar/events`, `PUT /api/calendar/events/:id`, `DELETE /api/calendar/events/:id`, `POST /api/calendar/natural` |
| Tasks | `GET /api/tasks`, `POST /api/tasks`, `PUT /api/tasks/:id`, `DELETE /api/tasks/:id`, `PATCH /api/tasks/:id` |
| Detection | `POST /api/detection/schedule` (extracts events and tasks from note text), `POST /api/detection/apply` |
| AI jobs | `POST /api/ai/jobs` (`summary`, `tasks`, `title`, `tags`, `rewrite` + `mode`, `research` + `topic`/`depth`/optional `documentIds`; optional `model` override), `GET /api/ai/jobs/:id`, `GET /api/ai/jobs/:id/artifacts`, `GET /api/models`, `GET /api/ai/usage` |
| Research files | `POST /api/research/documents` (authenticated raw PDF, DOCX, Markdown/text, or CSV body; `X-Research-Filename`; 10 MB) |
| Report export | `GET /api/reports/:noteId/export?format=html|pdf|docx` |
| Graph | `GET /api/graph` — note nodes and similarity/tag edges, derived from the existing Qdrant vectors (cached 30 s) |
| Chat | `POST /api/chat/note`, `POST /api/chat/search` (both accept optional `model`) |
| Images | `POST /api/uploads` (raw body, ≤5 MB, optional `?noteId`), `GET /api/images/:id` (owner-authenticated) |
| Secure Vault | `GET /api/vault`, `PUT /api/vault`, `GET /api/vault/records`, `POST /api/vault/records`, WebAuthn passkey endpoints |
| AI providers | `GET /api/ai/providers`, `POST /api/ai/providers`, `PATCH /api/ai/providers/:id`, `DELETE /api/ai/providers/:id`, `POST /api/ai/providers/fetch`, `PUT /api/ai/preferences`, `POST /api/ai/test`, `GET /api/ai/reindex` |
| Bip | `POST /api/chat/sessions/:id/messages`, `POST /api/ai/chat` (phone), `POST /api/agent/confirm` (run a deletion Bip proposed), sessions and memories CRUD |
| Search | `GET /api/notes/search?q=` (keyword + semantic) |
| Owner & devices | `GET /api/auth/owner`, `POST /api/auth/owner/setup`, `POST /api/auth/owner/login`, `POST /api/remote/pairing/create`, `POST /api/remote/pairing/claim`, `GET /api/remote/devices`, `DELETE /api/remote/devices/:id` |
| Templates | `GET/POST /api/templates`, `GET/PUT/DELETE /api/templates/:id` |
| Voice | `POST /api/voice/transcribe`, `POST /api/voice/speak` (use your chosen speech models) |

Muse has no synchronous AI endpoints — every AI call is a job in `ai_jobs` that a background worker processes, and the client polls `GET /api/ai/jobs/:id`.
Provider API keys are stored in Supabase Vault and are never returned by the API.

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
`443`, `3002`, `8000`, `5432`, or `6333` for Muse.

For a local setup, the tunnel ingress must point to `http://localhost:8080`.
The Nginx container forwards `/api` to Express on port `3002`; do not point a
tunnel directly to Express.

## Verify a production deployment

After the full stack is up, confirm every layer end to end:

```bash
docker compose ps --format "table {{.Name}}\t{{.Status}}"   # db, server, kong & nginx healthy
docker compose exec server node -e "fetch('http://127.0.0.1:3002/health').then(r => r.json()).then(console.log)"
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

---

## Remote Mobile Companion (Flutter App)

Muse includes a cross-platform mobile companion located in the `mobile/` directory, allowing you to access your notes, tasks, and talk directly with **Bip AI Assistant** from your phone.

### Features
* **Pairing in seconds:** a one-time QR code or 6-digit PIN links the phone. The device key is stored in the Android Keystore, kept only as a hash on the server, and revocable from the desktop at any time; a revoked phone returns to the pairing screen.
* **Bip on mobile:** talk or type; conversations are kept across launches ("New chat" starts a fresh one), with tappable action cards and Confirm cards for deletions.
* **Continuous dictation:** on-device speech recognition keeps listening until you tap stop, even through pauses.
* **Notes that work offline:** read, edit and create notes without a connection; changes sync on their own when Muse is reachable, and if the desktop changed the same note meanwhile, your phone version is saved as a copy instead of overwriting it. Images display inside notes.
* **Search by words and meaning**, **swipe actions with Undo** (complete, favorite, trash, restore), and pull to refresh.
* **Tasks & schedule** with reminders: real alarms with alarm sound, lock-screen display, a live countdown, and Done / Snooze. **Settings → Alarm setup** checks every permission (including Xiaomi/HyperOS Autostart) and has a **Test alarm** button.
* **Share to Muse** from any app (text, links, images) and **home-screen shortcuts**: Voice note, Quick note, Ask Bip.
* **Responsive layouts** verified at real phone sizes and larger text by an automated layout test.

### Voice & Speech Synthesis (TTS & STT)
* **Web STT:** Dual-engine architecture with Google Gemini Multimodal Audio (`gemini-3.5-flash` / `gemini-3.7-flash` via `/api/voice/transcribe`) for complex prompts, and Web Speech API (`webkitSpeechRecognition`) for local browser transcription.
* **Mobile STT:** On-device recognition with Android's `RecognitionService`, restarted automatically after the system's pauses so dictation continues until you stop it.
* **Your choice of models:** the web read-aloud and dictation use the models chosen in Settings → AI providers (Edge, OpenAI, Gemini or browser speech).
* **Conversational TTS:** Browser Speech Synthesis with automatic Unicode emoji and symbol filtering (`EMOJI_REGEX`), stripping emoji descriptions (e.g. "robot face sparkles") and normalizing whitespace/punctuation for clean, natural speech playback.

### How to Pair Your Phone
1. On your computer, open Muse in your browser (`http://localhost:8080`) and click **Link Phone** in the sidebar or top navigation bar.
2. An interactive pairing modal will display an animated QR code and a 6-digit PIN (valid for 5 minutes).
3. On your mobile phone, open the Muse companion app.
4. Point the camera at the QR code. The app automatically claims the session, links your device, and redirects to your workspace dashboard.
5. Alternatively, tap **Enter PIN Manually**, enter your computer's IP address (e.g., `http://192.168.100.136:8080`), and type the 6-digit PIN.

### Connecting Over the Internet
When away from your home Wi-Fi network, you can connect your phone to Muse over the internet using one of two secure methods:

#### Method A: Tailscale Mesh VPN (Recommended)
If Tailscale is running on your host machine and your mobile phone:
1. Note your host's Tailscale IP (e.g. `100.84.254.110`).
2. In the desktop **Link Phone** modal, select the **Tailscale (100.84.254.110:8080)** endpoint option before scanning the QR code, or enter `http://100.84.254.110:8080` in the mobile app.
3. Your phone securely connects over your private encrypted Tailscale mesh without opening any router ports.

#### Method B: Cloudflare Quick Tunnel
1. On your host computer, start a quick ephemeral tunnel:
   ```bash
   cloudflared tunnel --url http://localhost:8080
   ```
2. Cloudflare outputs a public HTTPS address (e.g. `https://random-subdomain.trycloudflare.com`).
3. Click the pencil icon next to the server address in the desktop **Link Phone** modal, paste your tunnel URL, and scan the regenerated QR code on your phone.

### Building & Running Mobile App
```bash
cd mobile
flutter pub get
flutter analyze
flutter test          # includes the layout test at phone sizes

# Build and install on a connected Android phone (USB debugging on)
flutter build apk --debug
adb install -r build/app/outputs/flutter-apk/app-debug.apk
```

Gradle needs JDK 17–21. If Flutter picks a newer JDK (for example the one
bundled with Android Studio), point it at JDK 21 once:
`flutter config --jdk-dir /usr/lib/jvm/java-21-openjdk-amd64`.
