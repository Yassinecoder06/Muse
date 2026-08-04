# Troubleshooting

Real problems observed while setting up Muse, with the exact error, root cause,
and fix for each.

## API exits immediately: "Node.js 18 detected without native WebSocket support"

**Error**

```text
Error: Node.js 18 detected without native WebSocket support.

Suggested solution: For Node.js < 22, install "ws" package and provide it
via the transport option ...
    at Function.getWebSocketConstructor (.../realtime-js/.../websocket-factory.ts:178)
```

The Express API crashes during startup, before it ever listens on `:3001`.
`curl localhost:3001/health` returns nothing (exit code 000).

**Cause** — On this machine the `node` resolved by `PATH`/`/usr/bin/npm` was
Node 18. `@supabase/supabase-js` v2.49+ initializes a realtime WebSocket client
in `createClient()`, and Node 18 has no native `WebSocket` global. Node 18 is
also end-of-life (security support ended April 2025).

**Fix** — Use Node 20 or newer. 22 LTS is recommended. With nvm:

```bash
nvm install 22
nvm alias default 22
node --version        # v22.x.x
npm rebuild           # if modules were installed under Node 18
```

Then restart the API (or `muse.service`). Verify:

```bash
node -e "console.log(typeof WebSocket)"   # prints "function" on Node 22
curl -s http://localhost:3001/health      # {"ok":true}
```

## muse.service crash-loops

**Error**

```text
muse.service: Failed to determine user credentials: No such process
muse.service: Main process exited, code=exited, status=217/USER
muse.service: Failed with result 'exit-code'
```

and the unit flips between `activating` and restarting (watch
`systemctl status muse` / `journalctl -u muse -f`).

**Cause** — Two independent mistakes in the unit:

1. `User=deploy` pointed at an account that does not exist on the machine
   (the repo owner was `ideaserver`). systemd aborts with
   `status=217/USER`. Confirm the real user with `id -un`.
2. `ExecStart=/usr/bin/npm run start` resolved to the system **Node 18** npm,
   so even after fixing the user the API fell into the WebSocket crash above.

**Fix** — Make the unit match your machine:

```ini
[Service]
Type=simple
User=ideaserver
WorkingDirectory=/home/ideaserver/Muse
Environment=NODE_ENV=production
ExecStart=/home/ideaserver/.nvm/versions/node/v22.23.2/bin/node server/dist/index.js
```

Find the real paths before editing:

```bash
id -un                       # the User= value
command -v node              # for a system install, or...
ls ~/.nvm/versions/node/     # the nvm Node 20+ binary path to use in ExecStart
```

```bash
sudo nano /etc/systemd/system/muse.service
sudo systemctl daemon-reload
sudo systemctl enable --now muse
sudo systemctl status muse --no-pager
```

**Note** — The service must be able to reach Docker; the chosen Linux user
needs membership in the `docker` group (`groups`).

## Realtime container restarts forever

**Error 1**

```text
Runtime terminating during boot ... （RuntimeError) APP_NAME not available
```

**Cause** — The `supabase/realtime` image requires an `APP_NAME` env var.

**Fix** — Add it (plus a cookie) to the `realtime` service in
`docker-compose.yml`:

```yaml
environment:
  APP_NAME: realtime
  ERLANG_COOKIE: your-own-cookie-value
```

**Error 2** (after error 1 is fixed)

```text
** (Postgrex.Error) ERROR 3F000 (invalid_schema_name) no schema has been selected to create in
```

**Cause** — `DB_AFTER_CONNECT_QUERY` was `SET search_path TO _realtime`, but
the running `supabase/postgres` image creates the schema named `realtime` (no
leading underscore). The migration therefore had nothing to create tables in.

**Fix** — Match the search path to the schema that actually exists:

```yaml
DB_AFTER_CONNECT_QUERY: SET search_path TO realtime
```

Apply and confirm:

```bash
docker compose up -d realtime
docker compose ps realtime        # Up
docker compose exec -T db psql -U postgres -d postgres -c "\dn" | grep realtime
```

## Edge Runtime container (functions) panics with ENOTDIR

**Error**

```text
thread '<unnamed>' panicked at .../crates/sb_graph/graph_util.rs:415:52:
called `Result::unwrap()` on an `Err` value: Os { code: 20, kind: NotADirectory, ... }
Error: main worker boot error: channel closed
```

**Cause** — The `supabase/edge-runtime` image crash-loops while scanning the
bind-mounted `supabase/functions` directory (a known issue in some
Docker/overlayfs setups). Muse does not use edge functions, so the service
serves no purpose and simply wastes resources while it restarts.

**Fix** — Remove the `functions` service from `docker-compose.yml` (and the
unused `supabase/functions` tree if you like):

```bash
docker compose up -d --remove-orphans
docker compose ps                  # functions should be gone
```

If you genuinely need edge functions later, pin an image version known to scan
your tree, or mount each function so the graph scanner sees a directory layout
it expects.

## Nginx fails to bind: "Address already in use"

**Error**

```text
[emerg] bind() to 0.0.0.0:80 failed (98: Address already in use)
[emerg] bind() to [::]:80 failed (98: Address already in use)
```

**Cause** — Two things collided: (a) another HTTP server on the host was
already listening on `:80`, and (b) at that moment Nginx still had the default
site enabled, which listens on `:80` instead of Muse's loopback `:8080`. The
Nginx service unit failed and went inactive.

**Fix**

1. See what holds the port: `ss -tlnp | grep ':80'` (or `sudo lsof -i :80`).
2. Disable the default site so Muse's config is the only one:
   `sudo unlink /etc/nginx/sites-enabled/default`.
3. Muse listens on `127.0.0.1:8080` only, which does not conflict with
   anything — confirm your site has `listen 127.0.0.1:8080;`.
4. Start it: `sudo nginx -t && sudo systemctl start nginx`. If the service
   stays down because the port is genuinely owned by another app you must
   keep, that app needs to move off `:80` or Nginx needs a different
   `listen` that the Cloudflare Tunnel ingress is updated to match.

## Qdrant: embedding dimension mismatch

**Error** — Semantic search returns nothing or the API logs a "segment temperature"
/ dimension error at startup, and the UI shows no search results from
"Ask my notes".

**Cause** — The `notes` Qdrant collection was created for a different vector
size than your embedding model emits (the app creates it with 768 dims for
`nomic-embed-text`).

**Fix** — Drop the collection; it is recreated automatically at API startup
with the configured model's dimension:

```bash
curl -X DELETE http://localhost:6333/collections/notes
curl http://localhost:6333/collections    # verify it comes back after restart
```

## Supabase Studio shows "unhealthy"

**Symptom** — `docker compose ps` reports `studio ... (unhealthy)`.

**Cause** — Studio's healthcheck is stricter than the app needs. If the
Studio UI still loads on `http://localhost:3000`, this is cosmetic and can be
ignored.

## Reused troubleshooting commands

```bash
docker compose ps --format "table {{.Name}}\t{{.Status}}"
docker compose logs <service> --tail 30
curl -s http://localhost:3001/health
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/api/notes   # 401 without a token is correct
```