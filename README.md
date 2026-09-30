# X Media Downloader Bot

A Telegram bot that accepts one public X/Twitter status URL and sends supported video or animated
media back to the originating chat. The implementation follows the feature design in
[`specs/001-x-media-download`](specs/001-x-media-download/).

## Prerequisites

- Node.js 24 and npm
- A compatible, deployment-pinned `yt-dlp` executable available as `yt-dlp` or at `YT_DLP_PATH`
- A Telegram bot token for local long-polling

No FFmpeg, database, Redis, webhook endpoint, or X credentials are required. The bot uses long
polling and local temporary workspaces. Keep the actual Telegram token in `.env`; do not commit or
print it.

## Setup

```bash
npm ci
cp .env.example .env
```

Set `TELEGRAM_BOT_TOKEN` and the approved exact `YT_DLP_EXPECTED_VERSION` in `.env`.
`YT_DLP_PATH` may point to the approved local executable. Startup compares its reported version
with the approved value before beginning polling.

## Development and verification

```bash
npm run dev
npm run lint
npm run typecheck
npm test
npm run build
```

The normal test suite uses checked-in provider fixtures and controlled ports. It does not call X or
Telegram and does not require a live `yt-dlp` process. Controlled child-process integration tests
run a checked-in fixture with Node.js. See
[`specs/001-x-media-download/quickstart.md`](specs/001-x-media-download/quickstart.md) for the
deterministic scenarios and opt-in live smoke test guidance. Normal commands need no network access;
`npm ci` needs registry access when dependencies are not cached.

## Operational notes

Pin and review the deployed `yt-dlp` artifact deliberately, including its provenance, integrity
record where available, and applicable license notices. Runtime plugins, remote components, and
self-update are disabled. Configure deployment egress to block private and internal destinations
as defense in depth. See [`docs/yt-dlp.md`](docs/yt-dlp.md) for artifact maintenance and
[`docs/security.md`](docs/security.md) for resource caps, temporary storage ownership, and log
redaction. No raw message text, token, full media URL, process output, or local path belongs in logs.
