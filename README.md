# osu-link

Desktop companion for **osu!stable**: search the live beatmap catalogue, download and import maps into your **Songs** folder, manage **collections**, join **party lobbies** (shared queue and chat), and use optional **social** features when a [party-server](party-server/README.md) with the HTTP API is configured.

Built with **Tauri 2**, **React**, and **TypeScript**.

## Features

- **OAuth** — Uses your osu! OAuth application for official API access (search, profile, friends scope as needed).
- **Search & download** — Query beatmaps, import `.osz` via public mirrors into the resolved Songs directory.
- **Collections** — Local collections with import/export of shared JSON.
- **Party** — WebSocket coordination (lobby codes, beatmap queue, chat). Default WebSocket URL is set at build time; see `VITE_PUBLIC_PARTY_WS_URL` in [`src/constants.ts`](src/constants.ts).
- **Social** (optional) — Friends, activity, battles, and challenges via the party server’s `/api/v1` REST API ([party-server README](party-server/README.md)).
- **Updates** — Packaged builds can update from GitHub Releases ([`RELEASING.md`](RELEASING.md)).

## Requirements

- **osu!stable** (Windows is the primary target for the desktop app).
- Node.js **20+** for the web UI and party-server.
- **Rust** toolchain for Tauri (`cargo`, `rustc`).

## Development

```bash
npm install
npm run dev
```

Run the Tauri app (from repo root):

```bash
npm run tauri dev
```

## OAuth setup

1. Create an OAuth application at [osu! OAuth apps](https://osu.ppy.sh/home/account/oauth/new).
2. Set the redirect URI exactly to **`http://127.0.0.1:42813/callback`** (same as [`OAUTH_REDIRECT_URI`](src/constants.ts) / `src-tauri/src/oauth.rs`).
3. Put the **Client ID** and **Client Secret** into the app (onboarding or Settings).

## Party server

For local development, run the WebSocket + HTTP API server:

```bash
npm run party-server
```

Defaults: WebSocket `ws://127.0.0.1:4680`, HTTP/social API on port `PORT + 1`. See [party-server/README.md](party-server/README.md) for environment variables, health checks, and deployment.

## Building installers

```bash
npm run build:installer
```

Release tagging and CI are described in [`RELEASING.md`](RELEASING.md).

## Repository layout

| Path | Role |
|------|------|
| `src/` | React UI |
| `src-tauri/` | Tauri shell, OAuth, download/import, collections |
| `party-server/` | Node WebSocket lobby server + social REST API |

## License

See the repository license file (if present).
