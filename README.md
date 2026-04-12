# osu-link

Desktop companion for **osu!stable**: search the live beatmap catalogue, download and import maps into your **Songs** folder, manage **collections**, join **party** lobbies (shared queue and chat), review **personal stats** and **training** drills, track **achievements**, and use optional **social** features when a [party-server](party-server/README.md) with the HTTP API is configured.

Built with **Tauri 2**, **React 19**, **TypeScript**, and **Vite**.

## Features

- **OAuth** — Uses your osu! OAuth application for official API access (search, profile, friends scope as needed).
- **Search & download** — Query beatmaps, import `.osz` via public mirrors into the resolved Songs directory.
- **Collections** — Local collections with import/export of shared JSON.
- **Party** — WebSocket coordination (lobby codes, roster, beatmap queue, lobby chat). Clients use **protocol v2** with the bundled [party-server](party-server/README.md). The default WebSocket URL is chosen at build time; see `VITE_PUBLIC_PARTY_WS_URL` and `HOSTED_PARTY_WS_URL` in [`src/constants.ts`](src/constants.ts).
- **Social** (optional) — Friends, activity, battles, challenges, and leaderboard via the party server’s `/api/v1` REST API ([party-server README](party-server/README.md)).
- **Stats** — Personal performance overview and charts from osu! profile data.
- **Train** — Training queue and drills using maps already in your library.
- **Achievements** — Local achievement rules, progress, and shareable cards.
- **Download logs** — History of imports with paths for troubleshooting.
- **Global shortcuts** — Configurable hotkeys (defaults include **Alt+Shift+O** to focus search and **Alt+Shift+R** for random curate); **Alt+1–9** switches main tabs (see Settings).
- **Discord remote control** (optional) — Pair the desktop app with the [Discord bot](discord-bot/) so commands can reach osu-link through the party-server relay ([party-server README](party-server/README.md) — Discord sections).
- **Updates** — Packaged builds can update from GitHub Releases ([`RELEASING.md`](RELEASING.md)).

## Requirements

- **osu!stable** (Windows is the primary target for the desktop app).
- **Node.js 20+** for the web UI, party-server, and Discord bot.
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

Run unit tests:

```bash
npm test
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

Defaults: WebSocket `ws://127.0.0.1:4680`, HTTP/social API on port `PORT + 1`. See [party-server/README.md](party-server/README.md) for environment variables, health checks, Discord relay endpoints, and deployment.

## Discord bot (development)

When iterating on the optional Discord integration:

```bash
npm run discord-bot
```

Configure environment variables as described in [party-server/README.md](party-server/README.md) (Discord bot section).

## Building installers

```bash
npm run build:installer
```

Release tagging and CI are described in [`RELEASING.md`](RELEASING.md).

## Repository layout

| Path | Role |
|------|------|
| `src/` | React UI (panels, party client, achievements, training, stats) |
| `src-tauri/` | Tauri shell, OAuth, download/import, collections, settings |
| `party-server/` | Node WebSocket lobby server + social REST API + Discord relay |
| `discord-bot/` | Optional Discord bot that talks to the party-server `/internal` API |

## License

See the repository license file (if present).
