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

## Deploy with Nginx and Cloudflare Tunnel

This setup exposes one HTTPS hostname while keeping Postgres, Qdrant, Ollama,
Kong, and Express private. Cloudflare Tunnel provides the public HTTPS entry
point; Nginx serves the React build and proxies internal paths.

```text
Browser -> https://notes.example.com -> Cloudflare Tunnel -> Nginx (127.0.0.1:8080)
                                                            |- /api/* -> Express (127.0.0.1:3001)
                                                            |- /uploads/* -> Express (127.0.0.1:3001)
                                                            `- /auth/v1/* and /rest/v1/* -> Kong (127.0.0.1:8000)
```

1. Create a production `.env` with unique secrets. The values built into the
   browser must use the public domain, while server services use private
   loopback addresses:

   ```dotenv
   PUBLIC_URL=https://notes.example.com
   VITE_API_URL=/api
   VITE_SUPABASE_URL=https://notes.example.com
   VITE_SUPABASE_ANON_KEY=${ANON_KEY}

   SUPABASE_URL=http://127.0.0.1:8000
   QDRANT_URL=http://127.0.0.1:6333
   ```

   Do not put `POSTGRES_PASSWORD`, `JWT_SECRET`, `SERVICE_ROLE_KEY`, or Ollama
   credentials in a `VITE_*` variable. Vite embeds those variables in browser
   JavaScript at build time.

2. Update the GoTrue public settings in `docker-compose.yml`:

   ```yaml
   API_EXTERNAL_URL: ${PUBLIC_URL}
   GOTRUE_SITE_URL: ${PUBLIC_URL}
   GOTRUE_URI_ALLOW_LIST: ${PUBLIC_URL}
   ```

   Add `https://notes.example.com` to the CORS origins in `docker/kong.yml`.

3. Keep host port mappings private. If Express runs on the host, it needs
   loopback access to Kong and Qdrant:

   ```yaml
   # docker-compose.yml
   kong:
     ports: ["127.0.0.1:8000:8000"]
   qdrant:
     ports: ["127.0.0.1:6333:6333"]
   ```

   Do not map Studio, Postgres, Qdrant, or Kong to public interfaces. If
   Nginx and Express are also containers on the same Compose network, they can
   call `kong:8000` and `qdrant:6333` by service name and no host mappings are
   needed.

4. Install Nginx, build the frontend, and start Docker:

   ```bash
   sudo apt update && sudo apt install -y nginx
   npm ci
   npm run build
   docker compose up -d
   ```

   In production, bind Express to `127.0.0.1` and configure it to trust the
   reverse proxy so generated upload URLs use HTTPS.

5. Run Express and the AI worker as a `systemd` service. Replace `deploy` and
   `/srv/muse` with your Linux user and project directory:

   ```ini
   # /etc/systemd/system/muse-api.service
   [Unit]
   Description=Muse Express API and AI worker
   After=network.target docker.service
   Requires=docker.service

   [Service]
   Type=simple
   User=deploy
   WorkingDirectory=/srv/muse
   Environment=NODE_ENV=production
   ExecStart=/usr/bin/npm run start
   Restart=always
   RestartSec=5

   [Install]
   WantedBy=multi-user.target
   ```

   Create and activate it:

   ```bash
   sudo nano /etc/systemd/system/muse-api.service
   sudo systemctl daemon-reload
   sudo systemctl enable --now muse-api
   sudo systemctl status muse-api --no-pager
   ```

   Use `command -v npm` to confirm the correct path for `ExecStart`.

6. Configure a private Nginx site. Replace `/srv/muse` with the directory that
   contains this repository:

   ```nginx
   server {
       listen 127.0.0.1:8080;
       server_name _;
       root /srv/muse/client/dist;
       index index.html;
       client_max_body_size 6m;

       location /api/ {
           proxy_pass http://127.0.0.1:3001;
           proxy_set_header Host $host;
           proxy_set_header X-Forwarded-Proto https;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       }
       location /uploads/ {
           proxy_pass http://127.0.0.1:3001;
           proxy_set_header Host $host;
           proxy_set_header X-Forwarded-Proto https;
       }
       location ~ ^/(auth|rest|storage|realtime)/v1/ {
           proxy_pass http://127.0.0.1:8000;
           proxy_http_version 1.1;
           proxy_set_header Host $host;
           proxy_set_header X-Forwarded-Proto https;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
       }
       location / { try_files $uri $uri/ /index.html; }
   }
   ```

   Enable the site, validate the configuration, and reload Nginx:

   ```bash
   sudo ln -s /etc/nginx/sites-available/muse /etc/nginx/sites-enabled/muse
   sudo nginx -t
   sudo systemctl reload nginx
   ```

7. In Cloudflare, create a Tunnel and add a **Published application** route:

   ```text
   Hostname: notes.example.com
   Service URL: http://127.0.0.1:8080
   ```

   If the connector runs in Docker and Nginx listens on `127.0.0.1`, run the
   connector with host networking so it can reach that local listener. The
   Cloudflare dashboard supplies the private tunnel token.

Only Cloudflare is public in this design. Do not open inbound ports `80`,
`443`, `3001`, `8000`, `5432`, or `6333` for Muse.

## Future improvements

- Object-storage backed image uploads in the editor
- Chunk-aware embeddings for very long notes
- Email delivery and account-confirmation configuration for production
