#!/usr/bin/env bash
# test_mcp_e2e.sh - Runs end-to-end tool checks against muse-mcp using @modelcontextprotocol/inspector CLI.
#
# Connects to the given MCP Streamable HTTP endpoint using the provided Bearer token,
# lists all available tools, and executes a search_notes call.

set -euo pipefail

usage() {
  cat << 'EOF'
Usage: scripts/test_mcp_e2e.sh <MCP_URL> <TOKEN> [QUERY]

Arguments:
  MCP_URL     The full MCP endpoint URL (e.g. http://localhost:8081/mcp or https://muse-mcp.yassinejemmali.me/mcp)
  TOKEN       Personal Access Token (muse_mcp_...) or OAuth Bearer token
  QUERY       Optional query string to pass to search_notes (default: "test")

Examples:
  ./scripts/test_mcp_e2e.sh http://localhost:8081/mcp muse_mcp_sample_token
  ./scripts/test_mcp_e2e.sh https://muse-mcp.yassinejemmali.me/mcp muse_mcp_sample_token "project plan"

Prerequisites:
  Node.js 18+ and npx (@modelcontextprotocol/inspector)
EOF
}

if [[ $# -lt 2 ]] || [[ "${1:-}" == "-h" ]] || [[ "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

MCP_URL="$1"
TOKEN="$2"
QUERY="${3:-test}"

echo "==> Running MCP End-to-End Test"
echo "  Endpoint: ${MCP_URL}"
echo "  Token:    ${TOKEN:0:10}..."
echo "  Query:    ${QUERY}"
echo ""

echo "--- 1. Listing tools (tools/list) ---"
npx --yes @modelcontextprotocol/inspector --cli "${MCP_URL}" \
  --transport http \
  --header "Authorization: Bearer ${TOKEN}" \
  --method tools/list

echo ""
echo "--- 2. Calling tool: search_notes ---"
npx --yes @modelcontextprotocol/inspector --cli "${MCP_URL}" \
  --transport http \
  --header "Authorization: Bearer ${TOKEN}" \
  --method tools/call \
  --tool-name search_notes \
  --tool-args-json "{\"query\":\"${QUERY}\"}"

echo ""
echo "==> MCP e2e test completed successfully!"
