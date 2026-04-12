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
#   USE_SCREEN      — set to 0 to run node directly under systemd (no attach). Default: 1
#   PARTY_PORT      — WebSocket port (default: 4680)
#   PARTY_LAN_WS    — with Caddy: set to 1 (default) so party also listens on 0.0.0.0:4680 for ws://<Pi-LAN-IP>:4680
#                     (same Wi‑Fi when your router has no NAT hairpin). Do not port-forward 4680 on the router.
#                     Set to 0 to bind127.0.0.1 only (no raw LAN WebSocket).
#   INSTALL_USER    — systemd runs as this user (default: user who invoked sudo, else pi)
#   INSTALL_DISCORD_BOT — set to 0 to skip Discord bot deploy (default: 1 if ../discord-bot exists)
#   DISCORD_BOT_ROOT  — install path for discord-bot (default: /opt/osu-link-discord)
#

set -euo pipefail

PUBLIC_DOMAIN="${PUBLIC_DOMAIN:-osulink.peyton-clark.com}"
SETUP_CADDY="${SETUP_CADDY:-0}"
USE_SCREEN="${USE_SCREEN:-1}"
PARTY_PORT="${PARTY_PORT:-4680}"
PARTY_LAN_WS="${PARTY_LAN_WS:-1}"
INSTALL_ROOT="${INSTALL_ROOT:-/opt/osu-link-party}"
LOGDIR="${LOGDIR:-/var/log/osu-link-party}"
SERVICE_NAME="osu-party"
INSTALL_DISCORD_BOT="${INSTALL_DISCORD_BOT:-1}"
DISCORD_BOT_ROOT="${DISCORD_BOT_ROOT:-/opt/osu-link-discord}"
DISCORD_SERVICE_NAME="${DISCORD_SERVICE_NAME:-osu-link-discord}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DISCORD_BOT_SRC="${SCRIPT_DIR}/../discord-bot"

if [[ "${EUID:-0}" -ne 0 ]]; then
  echo "Run as root so systemd can be configured, e.g.:"
  echo "  sudo PUBLIC_DOMAIN=${PUBLIC_DOMAIN} SETUP_CADDY=${SETUP_CADDY} USE_SCREEN=${USE_SCREEN} ${SCRIPT_DIR}/install-pi.sh"
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

PARTY_HTTP_PORT=$((PARTY_PORT + 1))

DISCORD_INTERNAL_SECRET_VALUE=""
INSTALL_DISCORD=0
if [[ "${INSTALL_DISCORD_BOT}" == "1" ]] && [[ -f "${DISCORD_BOT_SRC}/package.json" ]]; then
  INSTALL_DISCORD=1
  if [[ -f /etc/osu-link-party.env ]]; then
    DISCORD_INTERNAL_SECRET_VALUE="$(grep '^DISCORD_INTERNAL_SECRET=' /etc/osu-link-party.env 2>/dev/null | sed 's/^[^=]*=//' | tr -d '"' || true)"
  fi
  if [[ -z "${DISCORD_INTERNAL_SECRET_VALUE}" ]] && [[ -f /etc/osu-link-discord.env ]]; then
    DISCORD_INTERNAL_SECRET_VALUE="$(grep '^DISCORD_INTERNAL_SECRET=' /etc/osu-link-discord.env 2>/dev/null | sed 's/^[^=]*=//' | tr -d '"' || true)"
  fi
  if [[ -z "${DISCORD_INTERNAL_SECRET_VALUE}" ]]; then
    DISCORD_INTERNAL_SECRET_VALUE="$(openssl rand -hex 32)"
  fi
fi

if [[ ! -f "${SCRIPT_DIR}/index.mjs" ]] || [[ ! -f "${SCRIPT_DIR}/package.json" ]]; then
  echo "index.mjs or package.json not found next to this script."
  echo "Clone the osu-link repo on the Pi, then run from party-server/:"
  echo "  git clone https://github.com/pclark0729/osu-link.git"
  echo "  cd osu-link/party-server && sudo ./install-pi.sh"
  exit 1
fi

echo "==> Installing packages (curl, git, ca-certificates)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y ca-certificates curl git rsync

if [[ "${USE_SCREEN}" == "1" ]]; then
  echo "==> GNU Screen (attachable console)"
  apt-get install -y screen
fi

echo "==> Node.js 22.x (NodeSource)"
if ! command -v node &>/dev/null || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]]; then
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
chmod +x "${INSTALL_ROOT}/systemd-run-screen.sh" 2>/dev/null || true

echo "==> npm install (as ${RUN_USER})"
sudo -u "${RUN_USER}" bash -c "cd '${INSTALL_ROOT}' && npm install --omit=dev"

# WebSocket bind: without Caddy, all interfaces. With Caddy, default 0.0.0.0 so LAN can use ws://Pi-IP:PORT (NAT hairpin workaround).
WS_HOST="0.0.0.0"
if [[ "${SETUP_CADDY}" == "1" && "${PARTY_LAN_WS}" != "1" ]]; then
  WS_HOST="127.0.0.1"
fi

# HTTP (/health, /api/v1, /control) defaults to 127.0.0.1 only — unreachable from other PCs on LAN.
# When the lobby WS is on 0.0.0.0, bind HTTP on all interfaces too so LAN osu-link can use http://Pi-IP:4681 (pairing, social API).
HEALTH_HOST_VALUE="127.0.0.1"
if [[ "${WS_HOST}" == "0.0.0.0" ]]; then
  HEALTH_HOST_VALUE="0.0.0.0"
fi

mkdir -p "${LOGDIR}"
chown "${RUN_USER}:${RUN_USER}" "${LOGDIR}"

cat >/etc/osu-link-party.env <<EOF
# osu-link party-server — managed by install-pi.sh
INSTALL_ROOT=${INSTALL_ROOT}
LOGDIR=${LOGDIR}
HOST=${WS_HOST}
PORT=${PARTY_PORT}
HEALTH_HOST=${HEALTH_HOST_VALUE}
LOG_LEVEL=info
RUN_USER=${RUN_USER}
DISCORD_INTERNAL_SECRET=${DISCORD_INTERNAL_SECRET_VALUE}
EOF
chmod 644 /etc/osu-link-party.env

NODE_BIN="$(command -v node)"

if [[ "${USE_SCREEN}" == "1" ]]; then
  echo "==> systemd: ${SERVICE_NAME}.service (screen + auto-restart loop, HOST=${WS_HOST} PORT=${PARTY_PORT})"
  cat >/etc/systemd/system/${SERVICE_NAME}.service <<EOF
[Unit]
Description=osu-link party WebSocket server (${PUBLIC_DOMAIN}) [screen]
Documentation=file://${INSTALL_ROOT}/README.md
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=120
StartLimitBurst=5

[Service]
Type=simple
User=${RUN_USER}
Group=${RUN_USER}
EnvironmentFile=/etc/osu-link-party.env
ExecStart=${INSTALL_ROOT}/systemd-run-screen.sh
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

  cat >/usr/local/bin/osu-party-attach <<'ATTACH'
#!/usr/bin/env bash
# Attach to the live party-server console. Detach with: Ctrl+A then D
set -euo pipefail
if [[ ! -f /etc/osu-link-party.env ]]; then
  echo "Missing /etc/osu-link-party.env — run install-pi.sh" >&2
  exit 1
fi
set -a
# shellcheck source=/dev/null
source /etc/osu-link-party.env
set +a
SESSION=osu-party
if [[ "$(id -un)" == "${RUN_USER}" ]]; then
  exec screen -r "${SESSION}"
fi
exec sudo -u "${RUN_USER}" screen -r "${SESSION}"
ATTACH
  chmod 755 /usr/local/bin/osu-party-attach

else
  echo "==> systemd: ${SERVICE_NAME}.service (direct node, HOST=${WS_HOST} PORT=${PARTY_PORT})"
  rm -f /usr/local/bin/osu-party-attach
  cat >/etc/systemd/system/${SERVICE_NAME}.service <<EOF
[Unit]
Description=osu-link party WebSocket server (${PUBLIC_DOMAIN})
Documentation=file://${INSTALL_ROOT}/README.md
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=120
StartLimitBurst=5

[Service]
Type=simple
User=${RUN_USER}
Group=${RUN_USER}
WorkingDirectory=${INSTALL_ROOT}
EnvironmentFile=/etc/osu-link-party.env
Environment=NODE_ENV=production
ExecStart=${NODE_BIN} ${INSTALL_ROOT}/index.mjs
Restart=always
RestartSec=5
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF
fi

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"
sleep 1
systemctl --no-pager -l status "${SERVICE_NAME}" || true

if [[ "${INSTALL_DISCORD}" == "1" ]]; then
  echo "==> Deploy Discord bot ${DISCORD_BOT_ROOT}"
  mkdir -p "${DISCORD_BOT_ROOT}"
  rsync -a \
    --delete \
    --exclude node_modules \
    --exclude .git \
    "${DISCORD_BOT_SRC}/" "${DISCORD_BOT_ROOT}/"
  chown -R "${RUN_USER}:${RUN_USER}" "${DISCORD_BOT_ROOT}"
  echo "==> npm install discord-bot (as ${RUN_USER})"
  sudo -u "${RUN_USER}" bash -c "cd '${DISCORD_BOT_ROOT}' && npm install --omit=dev"

  if [[ ! -f /etc/osu-link-discord.env ]]; then
    cat >/etc/osu-link-discord.env <<EOF
# osu-link Discord bot — edit DISCORD_CLIENT_ID and DISCORD_BOT_TOKEN, then: systemctl restart ${DISCORD_SERVICE_NAME}
RELAY_INTERNAL_URL=http://127.0.0.1:${PARTY_HTTP_PORT}
DISCORD_INTERNAL_SECRET=${DISCORD_INTERNAL_SECRET_VALUE}
DISCORD_CLIENT_ID=
DISCORD_BOT_TOKEN=
EOF
    chmod 600 /etc/osu-link-discord.env
    chown "${RUN_USER}:${RUN_USER}" /etc/osu-link-discord.env
  else
    echo "    (keeping existing /etc/osu-link-discord.env — update RELAY_INTERNAL_URL if PARTY_PORT changed)"
  fi

  echo "==> systemd: ${DISCORD_SERVICE_NAME}.service"
  cat >/etc/systemd/system/${DISCORD_SERVICE_NAME}.service <<EOF
[Unit]
Description=osu-link Discord bot (slash commands → party relay)
Documentation=file://${INSTALL_ROOT}/README.md
After=network-online.target ${SERVICE_NAME}.service
Wants=network-online.target

[Service]
Type=simple
User=${RUN_USER}
Group=${RUN_USER}
WorkingDirectory=${DISCORD_BOT_ROOT}
EnvironmentFile=/etc/osu-link-discord.env
Environment=NODE_ENV=production
ExecStart=${NODE_BIN} ${DISCORD_BOT_ROOT}/index.mjs
Restart=on-failure
RestartSec=10
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload

  DISCORD_TOKEN_SET=0
  if [[ -f /etc/osu-link-discord.env ]]; then
    # shellcheck disable=SC1091
    set -a
    source /etc/osu-link-discord.env
    set +a
    if [[ -n "${DISCORD_BOT_TOKEN:-}" ]]; then
      DISCORD_TOKEN_SET=1
    fi
  fi

  if [[ "${DISCORD_TOKEN_SET}" == "1" ]]; then
    systemctl enable --now "${DISCORD_SERVICE_NAME}"
    sleep 1
    systemctl --no-pager -l status "${DISCORD_SERVICE_NAME}" || true
  else
    echo "    Discord bot unit installed but not enabled — set DISCORD_BOT_TOKEN and DISCORD_CLIENT_ID in /etc/osu-link-discord.env, then:"
    echo "      sudo systemctl enable --now ${DISCORD_SERVICE_NAME}"
    systemctl disable "${DISCORD_SERVICE_NAME}" 2>/dev/null || true
    systemctl stop "${DISCORD_SERVICE_NAME}" 2>/dev/null || true
  fi
fi

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

  CADDY_MAIN="/etc/caddy/Caddyfile"
  if ! grep -qF "${PUBLIC_DOMAIN}" "${CADDY_MAIN}" 2>/dev/null; then
    cat >>"${CADDY_MAIN}" <<EOF

# --- osu-link party server (install-pi.sh) ---
# Party lobby WS: ${PARTY_PORT}. HTTP+Discord control WS: $((PARTY_PORT + 1)) (/api/v1, /health, /control).
${PUBLIC_DOMAIN} {
	route {
		reverse_proxy /control* 127.0.0.1:$((PARTY_PORT + 1))
		reverse_proxy /api/* 127.0.0.1:$((PARTY_PORT + 1))
		reverse_proxy /internal/* 127.0.0.1:$((PARTY_PORT + 1))
		reverse_proxy /health* 127.0.0.1:$((PARTY_PORT + 1))
		reverse_proxy /ready* 127.0.0.1:$((PARTY_PORT + 1))
		reverse_proxy 127.0.0.1:${PARTY_PORT}
	}
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
echo "  Boot:        enabled (survives reboot)"
echo "  Restarts:    systemd Restart=always; inside screen, node auto-restarts if it crashes"
echo ""
if [[ "${USE_SCREEN}" == "1" ]]; then
  echo "  Attach:      osu-party-attach   (detach: Ctrl+A then D)"
  echo "  Log file:    tail -f ${LOGDIR}/console.log"
else
  echo "  Logs:        journalctl -u ${SERVICE_NAME} -f"
fi
echo "  Health:      curl -s http://127.0.0.1:${PARTY_HTTP_PORT}/health | head -c 400"
echo ""
if [[ "${INSTALL_DISCORD}" == "1" ]]; then
  echo "  Discord bot: systemctl status ${DISCORD_SERVICE_NAME}"
  echo "  Secrets:     /etc/osu-link-discord.env (chmod 600) — DISCORD_CLIENT_ID, DISCORD_BOT_TOKEN"
  echo "  Relay:       RELAY_INTERNAL_URL=http://127.0.0.1:${PARTY_HTTP_PORT} (must match party HTTP port)"
  echo ""
fi
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
if [[ "${SETUP_CADDY}" == "1" && "${PARTY_LAN_WS}" == "1" ]]; then
  echo "    - Same-LAN ws:// (no NAT hairpin): Pi listens on 0.0.0.0:${PARTY_PORT}; allow LAN only, e.g.:"
  echo "        sudo ufw allow from 192.168.0.0/16 to any port ${PARTY_PORT} proto tcp"
  echo "      Do not port-forward ${PARTY_PORT} on the router unless you intend to expose raw WS."
fi
echo ""
if [[ "${USE_SCREEN}" == "1" ]]; then
  echo "  Disable screen (direct systemd + journal only):"
  echo "    sudo USE_SCREEN=0 ${SCRIPT_DIR}/install-pi.sh"
  echo ""
fi
