# X GIF Telegram Bot

A small Telegram bot that accepts one public X post link, converts its animation to a real GIF, and
sends only that GIF to the same chat. It never sends a video file.

## Requirements

- Node.js 24 and npm
- A Telegram bot token
- Locally installed, deployment-pinned `yt-dlp` and FFmpeg executables

## Setup

```bash
npm ci
cp .env.example .env
```

Set `TELEGRAM_BOT_TOKEN`, executable paths, and their expected version tokens in `.env`. The bot
checks both tool versions before polling. Do not commit the real `.env` file.

Run locally with `npm run dev`; build with `npm run build` and run with `npm start`.

The default source limit is 20 MiB, GIF limit is 15 MiB, concurrency is two requests, and the
request deadline is three minutes. These values can be reduced with the environment settings shown
in `.env.example`.

Every result sent as media is a converted and validated animated GIF uploaded through Telegram's
animation API. Invalid links, unavailable posts, unsupported posts, and processing failures receive
a short text reply instead.

## Checks

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

The automated suite uses local fixtures and injected boundaries; it does not contact X or Telegram.
