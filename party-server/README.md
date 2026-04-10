# osu-link party server

Small **WebSocket** server that matches the protocol in [`../src/party/protocol.ts`](../src/party/protocol.ts). It only relays lobby messages (codes, roster, beatmap queue); it does **not** serve `.osz` files.

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

## Raspberry Pi (manual systemd) hint

Use `WorkingDirectory` to this folder, `ExecStart=/usr/bin/node .../index.mjs`, and:

```ini
Environment=HOST=0.0.0.0
Environment=PORT=4680
Environment=LOG_LEVEL=info
```

After start: `curl -s http://127.0.0.1:4681/health`.
