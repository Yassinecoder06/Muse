# Muse MCP Server (muse-mcp)

`muse-mcp` exposes the full intelligence and toolset of Muse's AI assistant (Bip) as a standard [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server over Streamable HTTP.

With `muse-mcp`, any MCP-compliant client—including **claude.ai**, **ChatGPT**, **Claude Code**, **Claude Desktop**, **Cursor**, and the **Gemini CLI**—can search, create, update, and manage your self-hosted Muse notes, tasks, calendar events, memories, and research from wherever you interact with LLMs.

Public connector endpoint:
```text
https://muse-mcp.yassinejemmali.me/mcp
```
(For multi-tenant stack `user2`: `https://muse2-mcp.yassinejemmali.me/mcp`)

---

## 1. Architecture & Capabilities

`muse-mcp` is implemented over Streamable HTTP (`POST`, `GET`, `DELETE /mcp`) using `@modelcontextprotocol/sdk`. It provides:

- **Tools**: Shared tool registry covering notes (`search_notes`, `read_note`, `create_note`, `update_note`, `trash_note`), tasks (`list_tasks`, `create_tasks`, `update_task`, `delete_task`), calendar (`list_calendar_events`, `create_calendar_event`), memory (`get_memories`, `save_memory`), templates, calculation, and asynchronous jobs (`start_research`, `generate_image`, `get_job_status`).
- **Resources**: Direct URI access to your workspace data:
  - `muse://notes/{id}` — Content and metadata of a specific note
  - `muse://notes/recent` — Recently modified notes
  - `muse://tasks/today` — Tasks due today
  - `muse://calendar/week` — Upcoming events for the current week
- **Prompts**: Pre-engineered system workflows:
  - `daily_review` — Morning briefing combining overdue tasks, today's schedule, and pending items
  - `plan_my_day` — Interactive schedule and priority planning
  - `capture_meeting_notes` — Structured meeting capture with automatic action item extraction
  - `weekly_reflection` — Summary of completed work and recurring themes
- **Instructions**: Enforced safety constraints ensuring that note contents, web search results, and external documents are treated strictly as untrusted data, never as prompt instructions.
- **Privacy Boundary**: Secure Vault notes (client-side encrypted with WebAuthn/passphrase) are never exposed via MCP.

---

## 2. Cloudflare Named Tunnel Setup

A Cloudflare Named Tunnel securely bridges public MCP clients to your local Docker Compose network over an outbound-only encrypted tunnel without opening firewall ports or port-forwarding your router.

### Step 1: DNS & Zero Trust
1. Ensure your domain (`yassinejemmali.me`) DNS is managed in your Cloudflare dashboard.
2. In Cloudflare, navigate to **Zero Trust** &rarr; **Networks** &rarr; **Tunnels**.
3. Click **Create a tunnel**.
4. Select **Cloudflared** as the connector type and click **Next**.
5. Give the tunnel a name, e.g. `muse-tunnel` (or `muse2-tunnel` for user2), and click **Save tunnel**.

### Step 2: Retrieve Tunnel Token
Under the installation instructions, look for the command snippet:
```bash
cloudflared tunnel run --token eyJh...
```
Copy only the token string starting with `eyJh...`.

Add it to your `.env` file:
```env
PUBLIC_URL=https://muse-mcp.yassinejemmali.me
CLOUDFLARE_TUNNEL_TOKEN=eyJh...your-token-here...
```

### Step 3: Configure Public Hostname
In the Cloudflare tunnel management tab:
1. Go to the **Public Hostname** tab and click **Add a public hostname**.
2. Configure:
   - **Subdomain**: `muse-mcp` (or `muse2-mcp` for user2)
   - **Domain**: `yassinejemmali.me`
   - **Path**: leave empty
   - **Service Type**: `HTTP`
   - **URL**: `nginx:8081` (inside Docker network; do NOT use localhost)
3. Under **Additional application settings**:
   - HTTP Settings: Enable **HTTP2** connection.
4. Save the hostname.

### Step 4: Start the Services
Start Muse and the named tunnel container:
```bash
# Start standard Muse stack with named tunnel
docker compose --profile named-tunnel up -d

# Verify cloudflared status
docker compose logs -f cloudflared
```

For quick temporary testing without a Cloudflare account, use the ephemeral Quick Tunnel:
```bash
docker compose --profile tunnel up -d tunnel
# Cloudflared will generate a temporary trycloudflare.com URL shown in the logs
docker compose logs tunnel
```

---

## 3. Client Connection Guide

### claude.ai (Web)
1. Open [claude.ai](https://claude.ai) &rarr; Settings &rarr; **Integrations** / **Custom Connectors**.
2. Click **Add Connector**.
3. Enter the connector URL:
   ```text
   https://muse-mcp.yassinejemmali.me/mcp
   ```
4. Claude will discover the OAuth 2.1 metadata via `/.well-known/oauth-authorization-server` and initiate dynamic client registration.
5. In the opened Muse authorization window, log in with your Muse passphrase, select the permissions to grant, and click **Authorize**.

### ChatGPT (Developer Mode / Custom Actions)
1. In ChatGPT &rarr; **My GPTs** &rarr; **Create a GPT** &rarr; **Configure** &rarr; **Actions** (or Developer Mode MCP connector).
2. Enter the MCP endpoint:
   ```text
   https://muse-mcp.yassinejemmali.me/mcp
   ```
3. Set Authentication to **OAuth** or **Bearer** using a Personal Access Token (`muse_mcp_...`).

### Claude Code (CLI)
Add Muse directly using the Claude Code CLI:
```bash
# HTTP transport with endpoint
claude mcp add --transport http muse https://muse-mcp.yassinejemmali.me/mcp

# Or with a Personal Access Token
claude mcp add --transport http -H "Authorization: Bearer muse_mcp_YOUR_PAT" muse https://muse-mcp.yassinejemmali.me/mcp
```

### Claude Desktop
Edit your `claude_desktop_config.json`:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

Add the server definition:
```json
{
  "mcpServers": {
    "muse": {
      "url": "https://muse-mcp.yassinejemmali.me/mcp",
      "headers": {
        "Authorization": "Bearer muse_mcp_YOUR_PAT"
      }
    }
  }
}
```

### Cursor
1. Go to **Cursor Settings** &rarr; **Features** &rarr; **MCP**.
2. Click **Add New MCP Server**.
3. Set:
   - **Name**: `muse`
   - **Type**: `command` (via `@modelcontextprotocol/inspector` proxy) or `sse`/`http`
   - **URL**: `https://muse-mcp.yassinejemmali.me/mcp`
   - **Headers**:
     ```json
     {
       "Authorization": "Bearer muse_mcp_YOUR_PAT"
     }
     ```

### Gemini CLI
In your `settings.json`:
```json
{
  "mcpServers": {
    "muse": {
      "httpUrl": "https://muse-mcp.yassinejemmali.me/mcp",
      "headers": {
        "Authorization": "Bearer muse_mcp_YOUR_PAT"
      }
    }
  }
}
```

---

## 4. Approval Modes & Safety

Muse provides tiered approval modes so you stay in control of what external models can see and change:

| Mode | Read Tools | Write Tools | External Tools | Destructive Tools |
|---|---|---|---|---|
| **trust** (opt-in) | `readOnly` | `readOnly` (executes immediately) | `readOnly` | Runs immediately; automatic 7-day undo snapshot recorded in `mcp_undo` |
| **minimal** (default) | `readOnly` | `destructiveHint: false, openWorldHint: false`: one-time "Always allow" | Same as write | `destructiveHint: true`: client prompts every time; automatic undo snapshot |
| **standard** | `readOnly` | `destructiveHint: true`: prompt on write | `destructiveHint: true, openWorldHint: true` | Dual verification: client asks **and** owner confirms interactively: returns `Approve here: {PUBLIC_URL}/approve/{id}` |

### Approval Mode Features
- **Live Re-annotation**: Changing approval mode in Muse settings takes effect immediately across active MCP sessions without reconnecting.
- **Interactive Dual-Approval**: Under `standard` mode, sensitive operations (such as permanently deleting a note or dropping a category) generate a secure single-use approval URL. The owner completes the action using their Muse passphrase or WebAuthn passkey.
- **Activity & Undo Audit Log**: Every tool execution is recorded in `mcp_activity`. Write and destructive operations create snapshots in `mcp_undo` allowing 1-click rollback from Settings &rarr; Connected Apps.

---

## 5. Security & Isolation

- **Isolated Public Gateway (`docker/nginx/public.conf`)**:
  - The Cloudflare tunnel routes traffic exclusively to container port `8081`.
  - Port `8081` proxies ONLY:
    - `/mcp` and `/mcp/*`
    - `/oauth/*`
    - `/.well-known/oauth-protected-resource`
    - `/.well-known/oauth-authorization-server`
    - `/approve/*`
    - `/health`
  - All other routes (`/`, `/api/notes`, `/rest/v1/*`, `/auth/v1/*`, `/uploads/*`) return **404 Not Found**.
  - The internal dashboard and database gateway on port `8080` remains accessible only via loopback (`127.0.0.1:8080`).
- **OAuth 2.1 & PKCE**: Dynamic client registration enforces S256 PKCE code challenges and rotating refresh tokens with automatic reuse detection.
- **Prompt Injection Defense**: All user documents, notes, search results, and tool outputs returned to the model are framed as data. Tool declarations instruct models never to interpret fetched content as instructions.

---

## 6. Troubleshooting

### 1. HTTP 530 / 1033 (Host asleep or disconnected)
- **Symptom**: Calling `https://muse-mcp.yassinejemmali.me/mcp` returns Cloudflare Error 1033 or 530 ("Origin web server is down").
- **Cause**: The host machine entered sleep/suspend mode or network connectivity was interrupted.
- **Fix**: Prevent system sleep while serving traffic using `systemd-inhibit`:
  ```bash
  systemd-inhibit --what=idle:sleep --who="Muse MCP" --why="Serving MCP traffic" docker compose --profile named-tunnel up
  ```
  On a dedicated Linux server, you can disable sleep targets permanently:
  ```bash
  sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
  ```

### 2. Gemini `DEADLINE_EXCEEDED`
- **Symptom**: Gemini CLI or Gemini API aborts with `DEADLINE_EXCEEDED`.
- **Cause**: Gemini imposes a strict 8-second execution deadline on tool calls.
- **Fix**: All interactive Muse MCP tools respond in < 8s. Heavy operations (e.g. generating images or running deep web research) return immediately with a `job_id`. Poll status with `get_job_status(job_id=...)` until completed.

### 3. Protocol Errors & Connection Resets
- **Symptom**: Cloudflared logs `connection reset by peer` or SSE stream disconnects.
- **Cause**: Tunnel fell back to HTTP/1.1 or connection timeouts were exceeded.
- **Fix**: Ensure `--protocol http2` is specified in `docker-compose.yml` for `cloudflared`. `docker/nginx/public.conf` sets `proxy_buffering off;`, `proxy_read_timeout 3600s;`, and `proxy_set_header Connection "";` to support persistent streaming.

### 4. OAuth Issuer Mismatch
- **Symptom**: Client fails OAuth discovery or rejects authorization codes.
- **Cause**: The `PUBLIC_URL` configured in `.env` does not match the public HTTPS URL accessed by the client.
- **Fix**: Set `PUBLIC_URL=https://muse-mcp.yassinejemmali.me` in `.env` (no trailing slash). Do not leave it set to `http://localhost:8080` when exposing via Cloudflare Tunnel.
