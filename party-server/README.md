# osu-link party server

Small **WebSocket** server that matches the protocol in [`../src/party/protocol.ts`](../src/party/protocol.ts). It only relays lobby messages (codes, roster, beatmap queue, lobby chat); it does **not** serve `.osz` files.

**Protocol version 2** — The server speaks **only** `v: 2` on the wire (lobby chat, queue management, `queuedAfter` on `beatmap_queued`, `chatTail` on `welcome`). Deploy this `party-server` together with an osu-link build that uses protocol v2; older clients using `v: 1` will be rejected with “Unsupported protocol version”.

## Requirements

- **Node.js 20+**

## Run

```bash
npm install
HOST=0.0.0.0 PORT=4680 npm start
```

Default WebSocket URL: `ws://127.0.0.1:4680` (when `HOST=127.0.0.1`).

## Social REST API (`/api/v1`)

The HTTP server (default port `PORT + 1`, e.g. `4681`) serves JSON **`/api/v1/*`** endpoints authenticated with `Authorization: Bearer <osu! access token>` (validated via osu! `GET /api/v2/me`). SQLite storage defaults to `data/social.sqlite` under this directory (override with **`SOCIAL_DB_PATH`**).

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/v1/me` | Session / upsert user |
| GET | `/api/v1/friends` | Friend list (osu-link) |
| POST | `/api/v1/friends/request` | `{ "targetOsuId": number }` |
| POST | `/api/v1/friends/accept` | `{ "friendshipId": number }` |
| DELETE | `/api/v1/friends/:osuId` | Remove friendship |
| GET | `/api/v1/activity` | Friend-visible activity feed |
| POST | `/api/v1/battles` | Async battle |
| GET | `/api/v1/battles` | List your battles |
| POST | `/api/v1/challenges` | Create challenge |

Rate limit for `/api/v1`: **`API_RATE_MAX`** (default `300` per IP per minute).

## Discord remote control (desktop via relay)

When the SQLite database is available, the HTTP server (default port **`PORT + 1`**) also exposes:

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/v1/discord-control/pairing` | Register a pairing code + `tokenHash` (SHA-256 hex of session token) from osu-link |
| GET | `/api/v1/discord-control/status` | `Authorization: Bearer <session token>` — link status |
| POST | `/api/v1/discord-control/revoke` | Revoke session (Bearer token) |
| GET | WebSocket `/control` | Outbound desktop session (Bearer token); relays Discord commands |
| POST | `/internal/discord/link` | **Loopback only** — bot completes pairing (`code`, `discordUserId`) |
| POST | `/internal/discord/command` | **Loopback only** — bot sends `ping`, `download`, `search` to connected desktop |

Set **`DISCORD_INTERNAL_SECRET`** in the party-server environment (same value the Discord bot uses in `X-Internal-Secret`). Never expose `/internal/*` publicly.

TLS: WebSocket upgrades for **`/control`** must reach the **HTTP** port (`PORT + 1`), not the party lobby WebSocket port (`PORT`). The `install-pi.sh` Caddy snippet routes `/control*`, `/api/*`, `/internal/*`, and `/health*` to that HTTP port.

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HOST` | `127.0.0.1` | WebSocket bind address. Use **`0.0.0.0`** on a Pi/VPS/Docker so remote clients can connect. |
| `PORT` | `4680` | WebSocket port. |
| `SOCIAL_DB_PATH` | `data/social.sqlite` (under server dir) | SQLite file for social features. |
| `API_RATE_MAX` | `300` | Max `/api/v1` requests per IP per rolling minute. |
| `HEALTH_HOST` | `127.0.0.1` | HTTP health server bind address. |
| `HEALTH_PORT` | `PORT + 1` (e.g. `4681`) | HTTP port for `/health`. Set to **`0`** to disable. |
| `DISABLE_HEALTH` | — | Set to `1` to disable the HTTP health server. |
| `LOG_LEVEL` | `info` | `error` · `warn` · `info` · `debug` |
| `DEBUG_WS` | — | Set to `1` to log each client message `type=` (no full payloads). |
| `SHUTDOWN_TIMEOUT_MS` | `10000` | Max wait when stopping (SIGTERM/SIGINT). |
| `DISCORD_INTERNAL_SECRET` | — | Shared secret for `POST /internal/discord/*` (must match `discord-bot` on the Pi). |
| `DISCORD_PAIRING_RATE_MAX` | `30` | Max pairing POSTs per IP per minute. |
| `DISCORD_INTERNAL_RATE_MAX` | `120` | Max internal bot POSTs per IP per minute. |

## Health & readiness (operations)

With defaults, only **localhost** can query health (safe on a public Pi).

```bash
curl -s http://127.0.0.1:4681/health | jq .
```

Response includes `version`, `uptimeSec`, `websocket.clients`, `lobbies.count`, etc.

- **`GET /health`** or **`GET /healthz`** — JSON status (200).
- **`GET /ready`** — `503` until the WebSocket server is listening; `200` when ready.

To expose health on all interfaces (e.g. behind another monitor), set `HEALTH_HOST=0.0.0.0` and open the health port in your firewall **only if** you intend to scrape it from outside.

## Logs

All lines are prefixed with an ISO timestamp and `[party]`:

- **INFO** — listen URLs, connect/disconnect, lobby create/join/destroy, `queue_beatmap`.
- **WARN** — client WebSocket errors.
- **ERROR** — server errors, port in use, uncaught handler exceptions.

**Debug from the Pi:**

```bash
LOG_LEVEL=debug DEBUG_WS=1 HOST=0.0.0.0 PORT=4680 node index.mjs
```

**systemd:** add `Environment=LOG_LEVEL=debug` under `[Service]` temporarily, then `sudo systemctl restart osu-party` and `journalctl -u osu-party -f`.

## Docker

```bash
docker build -t osu-party .
docker run --rm -p 4680:4680 osu-party
```

Health checks inside the container use `http://127.0.0.1:4681/health` (see `Dockerfile` `HEALTHCHECK`).

## Graceful shutdown

`SIGTERM` / `SIGINT` closes the HTTP health server (if any) and the WebSocket server, then exits. Use this with **systemd** or **Docker stop**.

## Troubleshooting

| Issue | What to do |
|-------|------------|
| `EADDRINUSE` | Another process uses `PORT`. `sudo ss -tlnp \| grep 4680` (Linux) or change `PORT`. |
| Clients cannot connect remotely | Set `HOST=0.0.0.0`, open firewall + port forward `PORT`, use `ws://` or `wss://` via a TLS proxy. |
| Empty `/health` or connection refused | Server not running, or `HEALTH_PORT=0`. Confirm with `LOG_LEVEL=debug`. |
| Lobbies empty in `/health` but clients “in lobby” | Normal if you restarted the server; state is in-memory only. |

## Raspberry Pi install script

From a clone of the repo on the Pi:

```bash
cd osu-link/party-server
chmod +x install-pi.sh
```

**With TLS for `wss://` (recommended)** — uses [Caddy](https://caddyserver.com/) and defaults to **`osulink.peyton-clark.com`** (override with `PUBLIC_DOMAIN=…`):

```bash
sudo SETUP_CADDY=1 ./install-pi.sh
```

**WebSocket only (no TLS)** — listen on all interfaces; clients use `ws://YOUR_PI_IP:4680`:

```bash
sudo ./install-pi.sh
```

The script installs Node 22, copies this folder to `/opt/osu-link-party`, runs `npm install`, and installs a **`osu-party`** systemd unit.

After a TLS install, set osu-link’s Party URL to:

`wss://osulink.peyton-clark.com` (or your `PUBLIC_DOMAIN`).

Point DNS **A/AAAA** for that hostname at the Pi’s public IP; open **80** and **443** on the router/firewall so Let’s Encrypt can issue a certificate.

## Discord bot (same Pi)

**`install-pi.sh`** copies `../discord-bot` to **`/opt/osu-link-discord`**, runs `npm install`, writes **`/etc/osu-link-discord.env`**, and installs **`osu-link-discord.service`**. It generates **`DISCORD_INTERNAL_SECRET`** for both party-server and the bot (or reuses an existing value from a previous run). Set **`DISCORD_CLIENT_ID`** and **`DISCORD_BOT_TOKEN`** in `/etc/osu-link-discord.env`, then:

```bash
sudo systemctl enable --now osu-link-discord
```

Skip the bot: `INSTALL_DISCORD_BOT=0 sudo ./install-pi.sh`.

Manual run (no systemd):

```bash
cd discord-bot
npm install
export DISCORD_BOT_TOKEN=…
export DISCORD_CLIENT_ID=…
export DISCORD_INTERNAL_SECRET=…   # same as party-server
export RELAY_INTERNAL_URL=http://127.0.0.1:4681
node index.mjs
```

Create a **Discord Application** → Bot → copy token; **OAuth2 → General** → copy Application ID for `DISCORD_CLIENT_ID`. Install the bot to your server with `applications.commands` scope.

**systemd** unit is created by `install-pi.sh`; equivalent manual unit:

```ini
[Unit]
Description=osu-link Discord bot
After=network-online.target osu-party.service
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/opt/osu-link-discord
Environment=RELAY_INTERNAL_URL=http://127.0.0.1:4681
EnvironmentFile=/etc/osu-link-discord.env
ExecStart=/usr/bin/node index.mjs
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Put secrets in `/etc/osu-link-discord.env` (`DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`; `DISCORD_INTERNAL_SECRET` is set by the install script to match party-server).

## Raspberry Pi (manual systemd) hint

Use `WorkingDirectory` to this folder, `ExecStart=/usr/bin/node .../index.mjs`, and:

```ini
Environment=HOST=0.0.0.0
Environment=PORT=4680
Environment=LOG_LEVEL=info
```

After start: `curl -s http://127.0.0.1:4681/health`.
