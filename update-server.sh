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
if ! git pull --ff-only "${REMOTE}" "${BRANCH}"; then
  if [[ -z "$(git status --porcelain 2>/dev/null)" ]]; then
    echo "git pull failed and the working tree is clean (diverged branch, network, etc.). Fix manually and retry." >&2
    exit 1
  fi
  echo "==> pull blocked by local changes; stashing and retrying (see: git stash list)"
  STASH_MSG="update-server.sh auto-stash $(date -Iseconds 2>/dev/null || date)"
  if ! git stash push -u -m "${STASH_MSG}"; then
    echo "git stash failed. Check git status and resolve, then re-run this script." >&2
    exit 1
  fi
  if ! git pull --ff-only "${REMOTE}" "${BRANCH}"; then
    echo "git pull still failed after stash. Try: git stash pop  then inspect (branch may need reset/rebase)." >&2
    exit 1
  fi
  echo "    Stashed pre-update edits. Restore if needed: git stash pop"
fi

chmod +x "${INSTALL}" 2>/dev/null || true

echo "==> party-server install (SETUP_CADDY=${SETUP_CADDY} PUBLIC_DOMAIN=${PUBLIC_DOMAIN})"
exec sudo env SETUP_CADDY="${SETUP_CADDY}" PUBLIC_DOMAIN="${PUBLIC_DOMAIN}" bash "${INSTALL}"
