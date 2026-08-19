# Muse troubleshooting

Last reviewed: **2026-08-14**. This is the consolidated troubleshooting guide
for the current Muse stack. It replaces the old host-Nginx notes and combines
the historical entries that were previously split across `TROUBLESHOOTING.md`
and `t.md`.

## Start with the right checks

Run these from the repository root before changing configuration:

```bash
docker compose ps
docker compose logs --tail 100 server db auth kong storage realtime
docker compose exec -T server node -e "fetch('http://127.0.0.1:3001/health').then(r => r.json()).then(console.log)"
curl -s http://localhost:8080/health
curl -sI http://localhost:8080/ | head -n 1
```

`http://localhost:5173` is the Vite development UI. `http://localhost:8080`
is the Docker Nginx gateway used by deployment. Do not expect an edit made in
Vite to appear at `:8080` until the gateway is rebuilt.

## Database fails with `invalid secret key`

**Observed:** 2026-08-14

### Symptoms

`muse-db-1` restarts or is unhealthy, and its log contains either:

```text
pgsodium_root.key: Is a directory
FATAL: invalid secret key
```

or:

```text
cat: /etc/postgresql-custom/pgsodium_root.key: Permission denied
FATAL: invalid secret key
```

### Cause

Postgres Vault depends on a stable pgsodium root key. A missing host bind path
can be created by Docker as a directory; a host-owned `0600` file is also not
readable by the Postgres user inside this image. Either condition prevents
Postgres from starting.

### Current fix

Muse now uses the Docker-managed `pgsodium-key` named volume. The one-shot
`pgsodium-key` service creates the key once, sets its ownership to the
Supabase Postgres image's UID/GID (`105:106`), and sets mode `0600`. The `db`
service mounts that volume read-only at `/etc/postgresql-custom`.

```bash
docker compose up -d --force-recreate pgsodium-key db
docker compose ps db                 # expect: Up ... (healthy)
```

Never delete `muse_pgsodium-key` while keeping `muse_postgres-data`: any Vault
secrets encrypted with the old root key will be unreadable.

### First initialization was interrupted

If the first start failed before Postgres became ready, the existing
`muse_postgres-data` volume may be incomplete. A telltale sign is that the
database starts but Auth/Storage/Realtime report missing schemas or even the
`postgres` role is absent. This cannot be repaired by restarting services.

If the volume contains data you need, stop here and restore from a proper
backup. If this was a fresh failed setup with no data to retain, reinitialize
**only after explicitly accepting the data loss**:

```bash
docker compose stop db
docker volume rm muse_postgres-data
docker compose up -d db
```

Then start the remaining services:

```bash
docker compose up -d
```

## Supabase services restart after the database was down

**Observed:** 2026-08-14

### Symptoms

`auth`, `storage`, or `realtime` log connection-refused/DNS errors for `db`.

### Resolution

First wait for `docker compose ps db` to show `healthy`, then start the
dependent services again:

```bash
docker compose up -d auth storage realtime rest kong
```

If Realtime still reports `invalid_schema_name`, use the incomplete-database
recovery above. The current configuration requires:

```yaml
DB_AFTER_CONNECT_QUERY: SET search_path TO realtime
```

## Host-run development Express exits before port 3001 opens

**Observed:** 2026-08-04; verified current 2026-08-14

### Symptoms

The host-run development API exits with a native WebSocket error, or this
fails:

```bash
curl -s http://localhost:3001/health
```

### Cause and resolution

`@supabase/supabase-js` needs Node 22+ in this project. Use Node 22, then
reinstall or rebuild dependencies that were installed under an older runtime:

```bash
nvm install 22
nvm alias default 22
node --version
node -e "console.log(typeof WebSocket)"   # function
npm install
```

If the port is occupied (`EADDRINUSE`), keep only one `npm run dev` process:

```bash
ss -ltnp | grep ':3001'
curl -s http://localhost:3001/health
```

## The API crashes with missing environment variables

**Observed:** 2026-08-04 and 2026-08-11

### Symptoms

The server logs a Zod error for `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, or `QDRANT_URL`.

### Resolution

Muse reads one repository-root `.env`; Express loads it explicitly and Vite
uses it through `client/vite.config.ts`. `SUPABASE_ANON_KEY` is required by
Express to validate user JWTs and must equal `ANON_KEY` used by Compose:

```bash
grep -E '^(ANON_KEY|SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_URL|QDRANT_URL)=' .env
```

Restart Vite after changing `VITE_*` variables. Rebuild Nginx after changing
`PUBLIC_URL`, browser variables, frontend code, or Nginx configuration:

```bash
docker compose up -d --build nginx
```

After a server build, rebuild and restart the Compose service:

```bash
docker compose up -d --build server nginx
```

## Browser signup or sign-in says `Failed to fetch`

**Observed:** 2026-08-04; updated for SMTP/Nginx 2026-08-15

### Local Vite UI

Kong must permit the Vite origins and Supabase headers. The current global CORS
configuration is in `docker/supabase/kong.yml`. After changing it:

```bash
docker compose up -d --force-recreate kong
```

### Docker gateway or production UI

Set `PUBLIC_URL` to the exact public origin *before* building Nginx. It is
used by the browser build, GoTrue confirmation links, and Express CORS. Add
the same production origin to the Kong CORS list, rebuild Nginx, then recreate
Auth:

```bash
docker compose up -d --build nginx
docker compose up -d --force-recreate auth
```

The gateway proxies `/auth/v1`, `/rest/v1`, `/storage/v1`, and `/realtime/v1`
to Kong; do not build a production bundle with `localhost` URLs.

## Confirmation or account-security emails do not arrive

**Observed:** 2026-08-14

### Cause

GoTrue sends signup confirmations, secure email-change confirmations, and
account-change notifications through the configured SMTP provider. Delivery
fails if the SMTP credentials are absent/invalid, the sender is not permitted,
or the recipient's mailbox filters the message.

### Resolution

Check the root `.env`:

```dotenv
DISABLE_SIGNUP=false
ENABLE_EMAIL_AUTOCONFIRM=false
SMTP_ADMIN_EMAIL=notifications@your-verified-domain.example
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password
SMTP_SENDER_NAME=Muse
```

Recreate Auth after changing mail variables:

```bash
docker compose up -d --force-recreate auth mailer-templates
docker compose logs --tail 100 auth
```

Ask the recipient to check Spam or Junk. Email changes require confirmation at
both the old and new address by design.

## Password-reset link does not open the new-password form

Use **Forgot your password?** on the sign-in screen. Muse sends a recovery
email through GoTrue and SMTP; opening its link creates a temporary recovery
session and displays the new-password form. The reset link must open the same
`PUBLIC_URL` used to build Nginx and configure GoTrue.

After changing `PUBLIC_URL` or the recovery template configuration, recreate
both Auth and the frontend gateway:

```bash
docker compose up -d --build nginx
docker compose up -d --force-recreate auth mailer-templates
```

If the browser shows a generic sign-in form after opening the link, request a
fresh reset email and open it in the same browser. Recovery links are
single-use and expire according to GoTrue's configured recovery-token policy.

## Docker Nginx gateway is stale or unavailable

**Observed:** 2026-08-14

### Symptoms

`http://localhost:8080` serves an old frontend, returns an error, or `/api`
cannot reach Express.

### Resolution

Nginx is a Compose service—not a host `systemd` Nginx site. Its configuration
is `docker/nginx/default.conf`; it listens only on `127.0.0.1:8080` and proxies
`/api` and `/uploads` to the internal `server` Compose service.

```bash
docker compose up -d --build nginx
docker compose logs --tail 100 nginx
curl -sI http://localhost:8080/ | head -n 1
```

If port 8080 is taken, find and stop or reconfigure the process that owns it:

```bash
ss -ltnp | grep ':8080'
```

The old instructions that installed a host Nginx service, modified home-folder
permissions, or edited `/etc/nginx/sites-*` no longer apply.

## Migrations or Vault key storage are missing

**Observed:** 2026-08-10; updated 2026-08-14

New databases run `001_initial.sql`, `002_images.sql`, `003_api_keys.sql`,
`004_research_documents.sql`, and `005_research_pipeline.sql`
through the database initialization mounts. For a healthy existing database,
apply the missing migrations once:

```bash
docker compose exec -T db sh -ec 'PGPASSWORD="$POSTGRES_PASSWORD" psql -U supabase_admin -d postgres' < supabase/migrations/002_images.sql
docker compose exec -T db sh -ec 'PGPASSWORD="$POSTGRES_PASSWORD" psql -U supabase_admin -d postgres' < supabase/migrations/003_api_keys.sql
docker compose exec -T db sh -ec 'PGPASSWORD="$POSTGRES_PASSWORD" psql -U supabase_admin -d postgres' < supabase/migrations/004_research_documents.sql
docker compose exec -T db sh -ec 'PGPASSWORD="$POSTGRES_PASSWORD" psql -U supabase_admin -d postgres' < supabase/migrations/005_research_pipeline.sql
docker compose exec -T db sh -ec 'PGPASSWORD="$POSTGRES_PASSWORD" psql -U supabase_admin -d postgres' < supabase/migrations/006_modular_reports.sql
```

`003_api_keys.sql` creates the logical pgsodium key and the service-role-only
Vault RPC functions. It revokes execution from `public`, `anon`, and
`authenticated`; do not loosen those grants.

## Notes return HTTP 500

**Observed:** 2026-08-04

The usual upstream cause is a restarting PostgREST or database service. Check
the whole request path before changing the frontend:

```bash
docker compose ps db rest kong
docker compose logs --tail 100 db rest kong
curl -s http://localhost:8080/health
```

PostgREST needs the internal login roles created by
`docker/supabase/roles.sql`. Those roles and application migrations are created
only when a new database volume initializes successfully.

## Qdrant search has an embedding-dimension mismatch

**Observed:** 2026-08-07

The `notes` collection must match the 768 dimensions emitted by
`nomic-embed-text`. If the model changes, delete only the derived collection;
it will be rebuilt at API startup:

```bash
curl -X DELETE http://localhost:6333/collections/notes
```

This removes embeddings, not Postgres notes.

## Rewrite loses images, or images disappear after an edit

**Observed:** 2026-08-07

Images are stored in Postgres and note HTML uses `/api/images/<uuid>`. The
current rewrite path replaces image tags with markers before calling the model,
then restores the original tags. The editor also flushes pending autosave before
enqueuing an AI job and sanitizes approved image URLs correctly.

If legacy notes still point at `/uploads/...`, keep the Express legacy static
route and avoid deleting `server/uploads` until those notes are migrated.

## Docker server cannot reach local Ollama or Qdrant indexing fails

### Symptoms

The server logs `Ollama embedding request failed`, `fetch failed`,
`ENOTFOUND`, or `ECONNREFUSED` for port `11434`. Notes may still save, but
their Qdrant embeddings are not created or updated.

### Cause

`localhost` inside the Compose `server` container is the container itself, not
the host running Ollama. Muse maps `host.docker.internal` to Docker's host
gateway and uses it as the server container's embedding endpoint. A typo such
as `docker.host.internal` will not resolve. Host Ollama also binds to
`127.0.0.1` by default, which rejects connections from the Docker bridge.

### Resolution

Keep host development and Docker settings separate in the root `.env`:

```dotenv
# Used by npm-run development on the host.
OLLAMA_EMBEDDING_BASE_URL=http://localhost:11434
# Used only by the Compose server container.
OLLAMA_EMBEDDING_BASE_URL_DOCKER=http://host.docker.internal:11434
```

Confirm the exact host-gateway IP seen by the current container:

```bash
docker compose exec -T server getent hosts host.docker.internal
```

Muse includes an `ollama-bridge` Compose service for Linux. It listens only on
Docker's host-gateway address and forwards to host Ollama's loopback API, so
you do **not** need to bind Ollama to `0.0.0.0` or change its system service.
Start it with the rest of the stack, then recreate the Muse server so it
receives the corrected environment:

```bash
docker compose up -d --build ollama-bridge server
docker compose exec -T server node -e "fetch('http://host.docker.internal:11434/api/tags').then(r => console.log(r.status))"
```

Expect `200`, and ensure `nomic-embed-text:latest` appears in the returned
model list. If Docker's gateway address changes, set `OLLAMA_BRIDGE_HOST` to
the address returned by `getent` and recreate `ollama-bridge`.

## Research reports show `Fetch failed`

### Cause

Research generation and local embeddings use different Ollama connections.
Research requires the signed-in user's **Ollama Cloud API key** in Muse
Settings; the local embedding endpoint does not replace that key. The research
pipeline runs only from Dashboard → **Research**, not from Ask Muse/chat.

### Resolution

1. Open Muse at `http://localhost:8080` and save an Ollama Cloud API key in
   **Settings**.
2. Create a new report through Dashboard → **Research**.
3. Inspect `docker compose logs --tail 100 server` for the upstream request
   error if the job fails.

## A research source document cannot be uploaded or has no usable text

Research accepts at most five explicitly selected files per run: PDF, DOCX,
Markdown/text, or CSV. Each file must be no larger than 10 MB. The Nginx
gateway permits 11 MB so that Express can apply this exact limit.

- A file-type mismatch, an invalid PDF/DOCX signature, an oversized file, or
  an unsupported extension is rejected before it reaches the AI queue.
- Scanned/image-only PDFs have no embedded text; Muse does not perform OCR, so
  upload an OCR'd PDF or a text export instead.
- The original file binary is intentionally not retained. Muse stores only its
  extracted text, privately tied to the signed-in user, for the selected run.

If a valid document still fails, inspect `docker compose logs --tail 100
server`. The error names the affected parsing step; removing that file leaves
the rest of the research workflow available.

## Research appears to pause between stages

The report is intentionally generated as eight sequential stages: web research,
extraction, analysis, critical reasoning, recommendations, structure, writing,
and quality control. The Research dialog updates after each completed stage.
An in-depth report can therefore take longer than the previous single-pass
generator, especially with large source documents or a busy Ollama Cloud model.
The job remains inspectable at `GET /api/ai/jobs/:id`, and the saved stage
artifacts are available at `GET /api/ai/jobs/:id/artifacts` after completion.

## Research creates an empty note

**Observed:** 2026-08-10

The research worker accepts tool arguments returned as either an object or a
JSON string, replies to every tool call, and makes a final no-tools attempt if
needed. An empty result should now fail the job visibly rather than create an
empty note. Check the job's `error` and server log:

```bash
docker compose logs --tail 100 --no-log-prefix 2>/dev/null || true
```

For a host-run API, inspect the systemd journal instead:

```bash
journalctl -u muse -n 100 --no-pager
```

## Studio, Edge Functions, and orphan warnings

**Observed:** 2026-08-04 to 2026-08-14

Studio's custom healthcheck probes its container IP and should be healthy when
the dashboard works. Edge Functions are intentionally not part of this Compose
stack. If Docker reports an old `muse-functions-1` as an orphan and you have
confirmed it is not needed, remove it without touching volumes:

```bash
docker compose up -d --remove-orphans
```
