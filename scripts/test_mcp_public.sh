#!/usr/bin/env bash
# test_mcp_public.sh - Asserts public route isolation for muse-mcp public gateway.
#
# Asserts that public routes respond and that private/internal routes
# (/, /api/notes, /rest/v1/, /auth/v1/, /uploads/x) return 404.
# Also verifies that /mcp without a token returns 401 with a WWW-Authenticate header.

set -euo pipefail

usage() {
  cat << 'EOF'
Usage: scripts/test_mcp_public.sh <BASE_URL>

Arguments:
  BASE_URL    The base URL to test (e.g. http://localhost:8081 or https://muse-mcp.yassinejemmali.me)

Examples:
  ./scripts/test_mcp_public.sh http://localhost:8081
  ./scripts/test_mcp_public.sh https://muse-mcp.yassinejemmali.me

Checks performed:
  1. Internal / private routes return 404:
     - /
     - /api/notes
     - /rest/v1/
     - /auth/v1/
     - /uploads/x
  2. Public routes respond through the gateway (not 404):
     - /health
     - /.well-known/oauth-protected-resource
     - /.well-known/oauth-authorization-server
     - /oauth/
     - /approve/
  3. Unauthenticated /mcp returns 401 with WWW-Authenticate header
EOF
}

if [[ $# -eq 0 ]] || [[ "${1:-}" == "-h" ]] || [[ "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

BASE_URL="${1%/}"
FAILED=0

echo "==> Testing MCP public gateway at: ${BASE_URL}"

# Helper to check if a route returns 404
assert_404() {
  local path="$1"
  local url="${BASE_URL}${path}"
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" "$url" || echo "000")

  if [[ "$status" == "404" ]]; then
    echo "  [PASS] ${path} returned 404 (blocked)"
  else
    echo "  [FAIL] ${path} expected 404, got ${status}" >&2
    FAILED=$((FAILED + 1))
  fi
}

# Helper to check that a public route is routed (does NOT return 404)
assert_public_route() {
  local path="$1"
  local url="${BASE_URL}${path}"
  local status
  local body
  body=$(curl -s -w $'\n%{http_code}' "$url" || printf '\n000')
  status="${body##*$'\n'}"

  # nginx's own 404 page means the gateway blocked it; a 404 from Muse is fine.
  if [[ "$status" == "404" && "$body" == *"<center>nginx"* ]]; then
    echo "  [FAIL] ${path} was blocked by the gateway (should be proxied to upstream)" >&2
    FAILED=$((FAILED + 1))
  elif [[ "$status" == "000" ]]; then
    echo "  [FAIL] ${path} failed to connect to ${url}" >&2
    FAILED=$((FAILED + 1))
  else
    echo "  [PASS] ${path} responded with HTTP ${status} (proxied)"
  fi
}

# Helper to check /mcp returns 401 with WWW-Authenticate header
assert_unauthenticated_mcp() {
  local url="${BASE_URL}/mcp"
  local headers_file
  headers_file=$(mktemp)
  local status

  status=$(curl -s -D "$headers_file" -o /dev/null -w "%{http_code}" "$url" || echo "000")

  if [[ "$status" != "401" ]]; then
    # Note: If upstream server is not yet booted, 502/503 might be returned
    echo "  [FAIL] /mcp without token expected 401, got ${status}" >&2
    FAILED=$((FAILED + 1))
  else
    echo "  [PASS] /mcp returned 401 Unauthorized"
  fi

  if grep -qi "^www-authenticate:" "$headers_file"; then
    local auth_header
    auth_header=$(grep -i "^www-authenticate:" "$headers_file" | tr -d '\r')
    echo "  [PASS] WWW-Authenticate header present: ${auth_header}"
  else
    echo "  [FAIL] WWW-Authenticate header missing in /mcp 401 response" >&2
    FAILED=$((FAILED + 1))
  fi

  rm -f "$headers_file"
}

echo ""
echo "--- 1. Asserting private / internal routes return 404 ---"
assert_404 "/"
assert_404 "/api/notes"
assert_404 "/rest/v1/"
assert_404 "/auth/v1/"
assert_404 "/uploads/x"

echo ""
echo "--- 2. Asserting public routes respond (not 404) ---"
assert_public_route "/health"
assert_public_route "/.well-known/oauth-protected-resource"
assert_public_route "/.well-known/oauth-authorization-server"
assert_public_route "/oauth/authorize"
assert_public_route "/approve/not-a-real-id-check"

echo ""
echo "--- 3. Asserting /mcp authentication challenge ---"
assert_unauthenticated_mcp

echo ""
if [[ $FAILED -eq 0 ]]; then
  echo "==> All public gateway route checks PASSED!"
  exit 0
else
  echo "==> ${FAILED} check(s) FAILED!" >&2
  exit 1
fi
