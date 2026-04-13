#!/usr/bin/env bash
#
# Pull latest git and redeploy party-server (install-pi.sh → /opt/osu-link-party).
# Run on the Pi from the osu-link repo root:
#   chmod +x update-server.sh
#   ./update-server.sh
#
# Overrides (optional):
#   REMOTE=origin BRANCH=main SETUP_CADDY=1 PUBLIC_DOMAIN=osulink.peyton-clark.com ./update-server.sh
#

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

if [[ "$(uname -s)" != Linux ]]; then
  echo "update-server.sh is intended for the Linux server (got: $(uname -s))." >&2
  exit 1
fi

REMOTE="${REMOTE:-origin}"
BRANCH="${BRANCH:-main}"
SETUP_CADDY="${SETUP_CADDY:-1}"
PUBLIC_DOMAIN="${PUBLIC_DOMAIN:-osulink.peyton-clark.com}"

INSTALL="${REPO_ROOT}/party-server/install-pi.sh"
if [[ ! -f "${INSTALL}" ]]; then
  echo "Missing party-server/install-pi.sh — run from the osu-link repository root." >&2
  exit 1
fi

echo "==> git fetch ${REMOTE}"
git fetch "${REMOTE}"

echo "==> git pull --ff-only ${REMOTE} ${BRANCH}"
git pull --ff-only "${REMOTE}" "${BRANCH}"

chmod +x "${INSTALL}" 2>/dev/null || true

echo "==> party-server install (SETUP_CADDY=${SETUP_CADDY} PUBLIC_DOMAIN=${PUBLIC_DOMAIN})"
exec sudo env SETUP_CADDY="${SETUP_CADDY}" PUBLIC_DOMAIN="${PUBLIC_DOMAIN}" bash "${INSTALL}"
