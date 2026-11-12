# Cloudflare Tunnel Configuration for Muse

This directory provides documentation and reference configurations for Cloudflare Tunnels (named tunnels and quick tunnels) used by `muse-mcp`.

## Overview

The `cloudflared` daemon runs in a Docker container alongside Muse and establishes an outbound-only encrypted tunnel to the Cloudflare global edge network.

All public traffic directed to `https://muse-mcp.yassinejemmali.me` is routed to the dedicated public Nginx gateway at `http://nginx:8081`.

## Services

Defined in `docker-compose.yml` and `docker-compose.user2.yml`:

- **Named Tunnel** (`profiles: ["named-tunnel"]`):
  - Image: `cloudflare/cloudflared:2026.11.0`
  - Command: `tunnel --no-autoupdate --protocol http2 run --token ${CLOUDFLARE_TUNNEL_TOKEN}`
  - Used for persistent production deployment with custom domain DNS and Zero Trust tunnel credentials.

- **Quick Tunnel** (`profiles: ["tunnel"]`):
  - Image: `cloudflare/cloudflared:2026.11.0`
  - Command: `tunnel --no-autoupdate --url http://nginx:8081 --metrics 0.0.0.0:2000`
  - Used for ad-hoc testing with temporary `trycloudflare.com` hostnames.

See `documentation/MCP.md` for complete setup instructions and client configurations.
