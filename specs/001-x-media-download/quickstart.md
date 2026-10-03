# Quickstart and Validation Guide

This quickstart retains the implemented service gates and defines validation of the planned
sound-aware completion. FFmpeg configuration, conversion, and `test:ffmpeg` are planned work,
not runnable capabilities added by this documentation checkpoint.

## Prerequisites

- Node.js 24 LTS and npm
- Telegram bot token for manual smoke testing only
- Pinned compatible `yt-dlp` at `YT_DLP_PATH`
- Approved FFmpeg build at required `FFMPEG_PATH` for production and the controlled conversion lane;
  record its checksum/provenance/notices and approved `FFMPEG_EXPECTED_VERSION` token
- No database, Redis, webhook endpoint, or X credentials

Review the [data model](./data-model.md), [application ports](./contracts/application-ports.md), and [Telegram contract](./contracts/telegram-bot.md).

## Setup target

Existing package setup:

```bash
npm ci
cp .env.example .env
```

Set `TELEGRAM_BOT_TOKEN` only for manual operation. Keep `.env` ignored; never commit/print the token.
During configuration implementation, `.env.example` will gain placeholder-only FFmpeg settings.
Set the approved FFmpeg path/version locally using the configuration contract in [plan.md](./plan.md).
No live credential is required for deterministic or controlled binary integration tests.

Target startup validates configuration/temp parent, checks approved `yt-dlp --version`, then checks
approved `ffmpeg -version` using its first-line token. Missing/malformed/mismatched executable results
prevent polling and omit output, paths, and secret values from replies/logs.

## Mandatory deterministic gates

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

All must pass. Normal tests disable unmocked network and require no Telegram, X, yt-dlp, FFmpeg, wall-clock sleeps, or uncontrolled randomness.

Check repository formatting with `npm run format:check`; distinguish any pre-existing failures
from edited-file formatting. Do not relax required verification rules.

## Deterministic acceptance scenarios

1. **One audio-bearing video**: sound-bearing metadata selects an audio-bearing MP4 even when a
   silent alternative ranks higher. Upload unchanged MP4 via `sendVideo`, then retire all artifacts.
2. **Confirmed silence**: a silent fixture produces a separate valid GIF, fully validates it, and
   uploads its bytes through `sendAnimation`; the upload is not a renamed or unchanged MP4.
3. **Multiple**: a three-item fixture produces three attempts in source order.
4. **Partial failure**: item 2 fails while 1 and 3 deliver; outcome reports two of three and position 2; cleanup completes.
5. **Input categories**: no/multiple/malformed URL, unsupported/lookalike hostname, credentials/port, and non-status path map safely without provider execution.
6. **Provider categories**: inaccessible post and accessible post with no supported media remain distinct.
7. **Bounds**: declared/streamed oversize, timeout, redirect cap, process-output cap, full queue, and cancellation terminate stably with no residual files/permits.
8. **SSRF**: loopback/private/link-local/ULA/CGNAT/reserved/multicast/mapped literals and mixed DNS answers are rejected; redirects revalidate; connector uses a validated address.
9. **Isolation**: overlapping requests have distinct workspaces and use only their own destinations.
10. **Disclosure**: user failure snapshots exclude secrets, URLs, process output, paths, stacks, and third-party diagnostics.
11. **Uncertainty/conflicts**: missing/null/blank/unknown audio, conflicting codec/container fields,
    and GIF labels with uncertain audio remain MP4/video. Audio-only-in-HLS or oversized formats
    prevents silent conversion; no eligible audio MP4 fails safely.
12. **Conversion faults**: missing/empty/invalid/truncated/undecodable output and unsuccessful child
    exit fail processing; one-byte GIF overflow fails size. No upload occurs; later items continue
    after item-local failure. Stage/job timeout and cancellation stop the request.
13. **Shared lifetime/storage**: palette, encoding, validation, and fallback consume one item budget;
    no child starts at zero remaining time; source/palette/GIF partial/final paths are removed before
    fallback/next item. Child/stream termination and admission release are observed.

## Controlled integration

Integration tests may:

- launch a fixture child process to verify argument arrays, timeouts, caps, and termination;
- use MockAgent or a test-only local server with injected test destination policy for streaming/filesystem behavior;
- allocate a test-owned temp root and assert it is empty after success/failure/cancellation/timeout.

Production SSRF policy must never be relaxed for local-server tests.

### Required controlled FFmpeg lane after implementation

The integration owner adds an explicit `npm run test:ffmpeg` script and separate Vitest integration
configuration so default `npm test` remains binary-free. It must not silently skip when the approved
binary is missing/mismatched. After setting only the trusted executable path/approved token for
that lane, run:

```bash
npm run test:ffmpeg
```

This command is planned and does not exist yet. Its fixture creates or uses a tiny synthetic local
MP4 with known silent frames; conversion produces a decodable real GIF within the configured cap,
with correct frame/profile properties and exact uploaded-artifact assertions through fake Telegram.
Include missing-trailer, truncated-after-valid-frame, broken-block, and strict decode failures,
plus controlled child timeout/cancellation and test-root cleanup. Use no live X, Telegram, or network.
See [research decisions](./research.md#11-sound-aware-completion-decisions) and
[shared contracts](./contracts/sound-aware-media.md) for validation and ownership details.

## Optional live smoke test

Live tests are opt-in and excluded from gates. After deterministic gates pass:

```bash
npm run dev
```

After the new implementation and all mandatory gates pass, manually check one confirmed-audio
video, one confirmed-silent animation, uncertain audio if available, a multiple-media post,
invalid/unsupported input, and shutdown during conversion. Verify correct same-chat methods,
sound preservation, actual GIF upload, clear partial results, and no residual artifacts.

Never place live post IDs in mandatory tests. Record both pinned executable artifacts/versions and
applicable notices in deployment documentation.

## Operational validation

Logs should contain correlation ID, stage, item position where relevant, duration, and stable code. They must omit bot token, raw update/text, full URLs, headers/cookies, yt-dlp output, paths/filenames, and unnecessary chat/user identifiers.

Temporary capacity should exceed:

```text
MAX_CONCURRENT_JOBS * (2 * MAX_MEDIA_BYTES + 16384) + filesystem overhead
```

Defaults require 196 MiB + 32 KiB for media plus overhead, with separately bounded metadata and
process diagnostics. Include decoded frames/filter buffers when provisioning memory; do not treat
the per-allocation FFmpeg guard as a total RSS bound. Observe no retained prior items/fallbacks;
failed bounded retirement stops acquisition. Deployment egress rules remain defense in depth.
