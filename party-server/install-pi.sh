#!/usr/bin/env bash
#
# osu-link party-server — Raspberry Pi install
#
# Usage (on the Pi, from a clone of this repo):
#   cd party-server
#   chmod +x install-pi.sh
#   sudo PUBLIC_DOMAIN=osulink.peyton-clark.com ./install-pi.sh
#
# With automatic TLS via Caddy (Let's Encrypt) — recommended for wss://your-domain:
#   sudo SETUP_CADDY=1 PUBLIC_DOMAIN=osulink.peyton-clark.com ./install-pi.sh
#
# Environment:
#   PUBLIC_DOMAIN   — hostname clients use (default: osulink.peyton-clark.com)
#   SETUP_CADDY     — set to 1 to install Caddy + obtain HTTPS for PUBLIC_DOMAIN
#   PARTY_PORT      — WebSocket port (default: 4680)
#   INSTALL_USER    — systemd runs as this user (default: user who invoked sudo, else pi)
#

set -euo pipefail

PUBLIC_DOMAIN="${PUBLIC_DOMAIN:-osulink.peyton-clark.com}"
SETUP_CADDY="${SETUP_CADDY:-0}"
PARTY_PORT="${PARTY_PORT:-4680}"
INSTALL_ROOT="${INSTALL_ROOT:-/opt/osu-link-party}"
SERVICE_NAME="osu-party"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${EUID:-0}" -ne 0 ]]; then
  echo "Run as root so systemd can be configured, e.g.:"
  echo "  sudo PUBLIC_DOMAIN=${PUBLIC_DOMAIN} SETUP_CADDY=${SETUP_CADDY} ${SCRIPT_DIR}/install-pi.sh"
  exit 1
fi

RUN_USER="${INSTALL_USER:-${SUDO_USER:-}}"
if [[ -z "${RUN_USER}" ]] || [[ "${RUN_USER}" == root ]]; then
  RUN_USER="$(getent passwd 1000 | cut -d: -f1 || true)"
fi
if [[ -z "${RUN_USER}" ]]; then
  echo "Could not determine non-root user. Set INSTALL_USER=myuser"
  exit 1
fi

if ! id "${RUN_USER}" &>/dev/null; then
  echo "User ${RUN_USER} does not exist."
  exit 1
fi

if [[ ! -f "${SCRIPT_DIR}/index.mjs" ]] || [[ ! -f "${SCRIPT_DIR}/package.json" ]]; then
  echo "index.mjs or package.json not found next to this script."
  echo "Clone the osu-link repo on the Pi, then run from party-server/:"
  echo "  git clone https://github.com/YOUR_USER/osu-link.git"
  echo "  cd osu-link/party-server && sudo ./install-pi.sh"
  exit 1
fi

echo "==> Installing packages (curl, git, ca-certificates)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y ca-certificates curl git rsync

echo "==> Node.js 22.x (NodeSource)"
if ! command -v node &>/dev/null || [[ "$(node -v | cut -d. -f1 | tr -d 'v')" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
echo "    $(node -v) @ $(command -v node)"

echo "==> Deploy ${INSTALL_ROOT}"
mkdir -p "${INSTALL_ROOT}"
rsync -a \
  --delete \
  --exclude node_modules \
  --exclude .git \
  "${SCRIPT_DIR}/" "${INSTALL_ROOT}/"
chown -R "${RUN_USER}:${RUN_USER}" "${INSTALL_ROOT}"

echo "==> npm install (as ${RUN_USER})"
sudo -u "${RUN_USER}" bash -c "cd '${INSTALL_ROOT}' && npm install --omit=dev"

# WebSocket bind: behind Caddy only localhost; otherwise all interfaces
WS_HOST="0.0.0.0"
if [[ "${SETUP_CADDY}" == "1" ]]; then
  WS_HOST="127.0.0.1"
fi

echo "==> systemd: ${SERVICE_NAME}.service (HOST=${WS_HOST} PORT=${PARTY_PORT})"
NODE_BIN="$(command -v node)"
cat >/etc/systemd/system/${SERVICE_NAME}.service <<EOF
[Unit]
Description=osu-link party WebSocket server (${PUBLIC_DOMAIN})
Documentation=file://${INSTALL_ROOT}/README.md
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${RUN_USER}
Group=${RUN_USER}
WorkingDirectory=${INSTALL_ROOT}
Environment=NODE_ENV=production
Environment=HOST=${WS_HOST}
Environment=PORT=${PARTY_PORT}
Environment=LOG_LEVEL=info
ExecStart=${NODE_BIN} ${INSTALL_ROOT}/index.mjs
Restart=on-failure
RestartSec=5
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"
sleep 1
systemctl --no-pager -l status "${SERVICE_NAME}" || true

if [[ "${SETUP_CADDY}" == "1" ]]; then
  echo "==> Installing Caddy for https://${PUBLIC_DOMAIN}"
  if ! command -v caddy &>/dev/null; then
    if ! apt-get install -y caddy 2>/dev/null; then
      apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
      curl -1sLf "https://dl.cloudsmith.io/public/caddy/stable/gpg.key" | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
      curl -1sLf "https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt" | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
      apt-get update -qq
      apt-get install -y caddy
    fi
  fi

  # Append site block once (no gzip here — cleaner WebSocket upgrades)
  CADDY_MAIN="/etc/caddy/Caddyfile"
  if ! grep -qF "${PUBLIC_DOMAIN}" "${CADDY_MAIN}" 2>/dev/null; then
    cat >>"${CADDY_MAIN}" <<EOF

# --- osu-link party server (install-pi.sh) ---
${PUBLIC_DOMAIN} {
	reverse_proxy 127.0.0.1:${PARTY_PORT}
}
EOF
  fi

  systemctl enable caddy
  systemctl restart caddy
  sleep 1
  systemctl --no-pager -l status caddy || true
fi

echo ""
echo "================================================================"
echo "  Install finished"
echo "================================================================"
echo ""
echo "  Service: systemctl status ${SERVICE_NAME}"
echo "  Logs:        journalctl -u ${SERVICE_NAME} -f"
echo "  Health:      curl -s http://127.0.0.1:$((PARTY_PORT + 1))/health | head -c 400"
echo ""
if [[ "${SETUP_CADDY}" == "1" ]]; then
  echo "  Clients set Party URL to:"
  echo "    wss://${PUBLIC_DOMAIN}"
  echo ""
  echo "  DNS: Point A/AAAA record for ${PUBLIC_DOMAIN} to this Pi's public IP."
  echo "  Caddy will obtain TLS certificates on first request (ports 80+443 must reach the Pi)."
else
  echo "  Direct WebSocket (no TLS in this mode):"
  echo "    ws://THIS_PI_IP:${PARTY_PORT}"
  echo ""
  echo "  For your domain with TLS, re-run with Caddy:"
  echo "    sudo SETUP_CADDY=1 PUBLIC_DOMAIN=${PUBLIC_DOMAIN} ${SCRIPT_DIR}/install-pi.sh"
  echo ""
  echo "  After Caddy, osu-link Party URL:"
  echo "    wss://${PUBLIC_DOMAIN}"
fi
echo ""
echo "  Firewall hints:"
echo "    - With Caddy: allow 22, 80, 443 (e.g. ufw allow 80,443/tcp)"
echo "    - Without Caddy: allow ${PARTY_PORT}/tcp to the Pi"
echo ""
