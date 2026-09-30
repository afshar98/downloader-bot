# Quickstart and Validation Guide

This quickstart documents the implemented service and its deterministic validation gates.

## Prerequisites

- Node.js 24 LTS and npm
- Telegram bot token for manual smoke testing only
- Pinned compatible `yt-dlp` at `YT_DLP_PATH`
- No FFmpeg, database, Redis, webhook endpoint, or X credentials

Review the [data model](./data-model.md), [application ports](./contracts/application-ports.md), and [Telegram contract](./contracts/telegram-bot.md).

## Setup target

After implementation establishes the package:

```bash
npm ci
cp .env.example .env
```

Set `TELEGRAM_BOT_TOKEN` only for manual operation. Keep `.env` ignored; never commit/print the token. `.env.example` documents the non-secret limits and paths in `plan.md`.

Startup validates configuration/temp parent and performs a bounded `yt-dlp --version` check. Invalid config or missing executable fails before polling with an operator error that omits secret values.

## Mandatory deterministic gates

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

All must pass. Normal tests disable unmocked network and require no Telegram, X, yt-dlp, FFmpeg, wall-clock sleeps, or uncontrolled randomness.

## Deterministic acceptance scenarios

1. **One video**: a valid fixture produces one video delivery to the originating destination and removes its workspace.
2. **Animation**: an animated fixture produces animation delivery without transformation.
3. **Multiple**: a three-item fixture produces three attempts in source order.
4. **Partial failure**: item 2 fails while 1 and 3 deliver; outcome reports two of three and position 2; cleanup completes.
5. **Input categories**: no/multiple/malformed URL, unsupported/lookalike hostname, credentials/port, and non-status path map safely without provider execution.
6. **Provider categories**: inaccessible post and accessible post with no supported media remain distinct.
7. **Bounds**: declared/streamed oversize, timeout, redirect cap, process-output cap, full queue, and cancellation terminate stably with no residual files/permits.
8. **SSRF**: loopback/private/link-local/ULA/CGNAT/reserved/multicast/mapped literals and mixed DNS answers are rejected; redirects revalidate; connector uses a validated address.
9. **Isolation**: overlapping requests have distinct workspaces and use only their own destinations.
10. **Disclosure**: user failure snapshots exclude secrets, URLs, process output, paths, stacks, and third-party diagnostics.

## Controlled integration

Integration tests may:

- launch a fixture child process to verify argument arrays, timeouts, caps, and termination;
- use MockAgent or a test-only local server with injected test destination policy for streaming/filesystem behavior;
- allocate a test-owned temp root and assert it is empty after success/failure/cancellation/timeout.

Production SSRF policy must never be relaxed for local-server tests.

## Optional live smoke test

Live tests are opt-in and excluded from gates. After deterministic gates pass:

```bash
npm run dev
```

Manually check one public in-limit video, one animation, one multiple-media post, invalid/unsupported input, and shutdown during download. Verify same-chat delivery, clear partial results, no extraction on invalid input, graceful stop, and no residual workspace.

Never place live post IDs in mandatory tests. Record the pinned yt-dlp artifact/version and applicable notices in deployment documentation.

## Operational validation

Logs should contain correlation ID, stage, item position where relevant, duration, and stable code. They must omit bot token, raw update/text, full URLs, headers/cookies, yt-dlp output, paths/filenames, and unnecessary chat/user identifiers.

Temporary capacity should exceed:

```text
MAX_CONCURRENT_JOBS * MAX_MEDIA_BYTES + small partial/metadata overhead
```

Defaults require roughly 98 MiB plus overhead. Deployment egress rules should block internal/private destinations as defense in depth.
