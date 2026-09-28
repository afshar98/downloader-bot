# Implementation Plan: X/Twitter Media Download

**Branch**: `001-x-media-download` | **Date**: 2026-09-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-x-media-download/spec.md`

## Summary

Build a stateless, strict-TypeScript Telegram bot that accepts exactly one public X/Twitter post URL, discovers every supported video or animated item through a replaceable provider, streams bounded media into a request-isolated temporary workspace, and uploads each successful item to its originating Telegram chat. The Telegram adapter uses grammY long polling; the X provider runs a pinned `yt-dlp` executable for metadata only; the application owns selection, secure downloading, ordered partial-success behavior, cleanup, and typed error outcomes. Direct MP4 delivery is the MVP path, so FFmpeg and persistence are excluded.

## Technical Context

**Language/Version**: Node.js 24 LTS; TypeScript 5.x in strict ESM mode

**Primary Dependencies**: `grammy`, `@grammyjs/runner`, `zod`, `pino`, `undici`, `ipaddr.js`; external pinned `yt-dlp` executable. No FFmpeg runtime dependency.

**Storage**: No database or persistent storage. Request-scoped files use `fs.mkdtemp` under the OS or configured temporary directory and are removed at job termination.

**Testing**: Vitest; Undici MockAgent, injected ports, checked-in yt-dlp JSON fixtures, and temporary test directories. Live Telegram/X tests are opt-in only.

**Target Platform**: Linux server/container with Node.js 24 LTS, Telegram/X/media-CDN egress, and a pinned compatible `yt-dlp` executable.

**Project Type**: Single-process long-running Telegram bot service

**Performance Goals**: Invalid-input feedback within five seconds in normal operation; at least 95% of valid in-limit requests reach delivery or terminal feedback within two minutes; items delivered sequentially in source order.

**Constraints**: 49 MiB default upload cap (below the cloud Bot API's current 50 MB multipart limit); 30 s extraction timeout; 60 s absolute timeout per media download; 30 s delivery timeout; 115 s job deadline; three redirects; two active and eight queued jobs by default. Limits are finite and startup-validated. One item is processed at a time per job.

**Scale/Scope**: X/Twitter video and animated media only; one Node.js process and a bounded in-memory admission queue. No distributed workers, accounts, history, cache, analytics, or other providers.

## Constitution Check

*GATE: Passed before Phase 0 research and passed again after Phase 1 design.*

| Principle / Gate | Plan evidence | Status |
|---|---|---|
| Explicit layer boundaries | Telegram transport depends on one application use case; provider discovery, safe download, processing seam, delivery, and infrastructure are separate ports. No grammY, yt-dlp, or Undici types enter application models. | PASS |
| Security and resource safety | Full URL validation, DNS/IP policy and connection pinning, manual redirect validation, byte-counted streams, timeouts, bounded process output, non-shell execution, isolated paths, finally cleanup, and bounded concurrency. | PASS |
| Strict types and validated boundaries | Strict TypeScript, Zod schemas for configuration and yt-dlp JSON, discriminated outcomes/errors, and one controlled `process.env` boundary. | PASS |
| Test-driven deterministic quality | Red-green-refactor by boundary; fakes, fixtures, MockAgent, injected clocks/IDs/resolvers, and temporary directories replace live dependencies in normal tests. | PASS |
| Simplicity and maintainability | One service/provider, individual delivery, direct MP4 upload, and no database, distributed queue, plugin framework, cache, or FFmpeg. | PASS |
| Verification gates | The repository has no package tooling. Implementation establishes real `lint`, `typecheck`, `test`, and `build` npm scripts before feature work. | PASS (planned prerequisite) |

No constitutional exception or complexity waiver is required. Phase 1 models make resource ownership and untrusted boundaries explicit without adding prohibited scope, so the post-design gate remains passed.

## Architecture and Workflow

```text
Telegram update
  -> grammY message adapter
  -> DownloadPostMedia use case
  -> XMediaProvider (yt-dlp metadata adapter)
  -> representation selection
  -> SafeMediaDownloader (Undici + URL/DNS policy)
  -> DirectMediaProcessor (no FFmpeg)
  -> TelegramDelivery (individual local-file uploads)
  -> safe final outcome / partial-failure summary
```

1. The transport extracts text and an opaque chat destination, creates a correlation ID, and calls the use case. It performs no discovery or file work.
2. The application extracts exactly one candidate URL. The X provider recognizes exact allowed hosts and validates scheme, port, credentials, and status path into a `PostReference`.
3. After admission, the job creates one unique workspace. The provider invokes yt-dlp in metadata-only mode and maps validated JSON to source-ordered provider-neutral media and representations.
4. The application retains progressive HTTPS MP4 candidates and orders them by delivery compatibility, known size, resolution/bitrate, and quality. Unknown sizes remain eligible but are enforced while streaming. A bounded lower-quality fallback is used only for a representation-specific safe-to-retry failure.
5. For each item sequentially, the downloader validates and pins the public destination, follows at most three revalidated redirects, streams into a generated `.part` path with an absolute deadline and hard byte counter, then renames a complete file.
6. The direct processor validates compatibility and returns the input unchanged. Animated X media uses `sendAnimation`; video uses `sendVideo`.
7. Delivery is individual and source-ordered. Per-item failure is recorded and later items continue. A concise final summary reports partial failure.
8. The use case removes partials promptly, removes the workspace in `finally`, and releases admission in `finally`. Cleanup failure is logged without replacing the primary outcome.

## Key Technical Decisions

### Telegram transport and delivery

- Use grammY and `@grammyjs/runner` with long polling, bounded runner concurrency, `bot.catch`, and graceful SIGINT/SIGTERM shutdown. Webhooks are deferred because local MVP operation has no public HTTPS requirement.
- Upload individual local files rather than using `sendMediaGroup` or Telegram-fetched URLs. This supports per-item continuation, mixed video/animation semantics, and any item count.
- Keep grammY `Context`, updates, and `InputFile` in `src/bot`; application ports use opaque destinations and controlled file descriptors.

### X provider and process

- Accept `https://x.com/.../status/<digits>` and `https://twitter.com/.../status/<digits>`, with only explicitly enumerated `www`/mobile variants. Remove harmless query/fragment data; reject credentials, non-default ports, lookalikes, and non-post paths.
- Spawn the configured binary with argument-array equivalents of `--ignore-config --no-plugin-dirs --no-remote-components --socket-timeout`, `--dump-single-json`, `--skip-download`, `--yes-playlist`, `--use-extractors twitter`, and `-- <validated-url>`; always `shell: false`.
- Cap stdout/stderr, apply the extraction deadline, kill on timeout/cancellation, validate JSON with Zod, accept one entry or playlist entries, and preserve entry order. Never log raw process output/full URLs.
- Check `yt-dlp --version` at startup. Pin artifact/checksum and update deliberately; never self-update or load plugins/remote components at runtime.

### Safe HTTP download

- Use explicit `undici`. Automatic redirects are disabled. Every hop requires HTTPS, no credentials, default port, and bounded length; relative redirects are resolved then fully revalidated.
- A custom lookup resolves all A/AAAA answers, normalizes IPv4-mapped IPv6, and rejects the host if any answer is loopback, private/ULA, link-local, unspecified, multicast, CGNAT, documentation, reserved, or otherwise non-global. The connector receives a validated address, binding validation to the socket. `ipaddr.js` handles classification; an egress firewall is defense in depth.
- Send no credentials/cookies. Request identity encoding, accept only successful expected media, reject oversized declared lengths, configure response/connect/header/body bounds, and still count streamed bytes through `stream.pipeline`.
- Only generated names such as `item-0001.part` and `item-0001.mp4` become paths. Writes are exclusive and incomplete files are deleted.
- Do not transparently retry HTTP, yt-dlp, or Telegram operations in the MVP. The only second attempt is the bounded next representation after a representation-specific size/compatibility failure; policy violations, timeouts, cancellation, and ambiguous failures are terminal for that item.

### Media processing

- The MVP `MediaProcessor` is a narrow identity/direct-delivery component, not a framework. It validates compatibility or returns `MediaProcessingFailed`.
- Do not install/invoke FFmpeg. Add an adapter only for a reproducible HLS-only, split-stream, codec/container, fast-start-repair, or size-reduction requirement. It must use argument arrays, `shell: false`, deadlines, capped output, controlled paths, exit checks, and cleanup; remux/stream-copy precedes transcoding.

## Error Model and User Mapping

Errors are discriminated values with stable `code`, safe operator context, optional cause, and retryability. Arbitrary messages never control behavior.

| Internal code | Safe Telegram outcome |
|---|---|
| `InvalidUrl` | Send exactly one valid X/Twitter post URL. |
| `UnsupportedPlatform` | That platform is unsupported; send an X/Twitter post URL. |
| `PostInaccessible` | The post cannot be accessed; check it is public or retry later. |
| `MediaNotFound` | No supported video or animated media was found. |
| `MediaDownloadFailed` | A media item could not be downloaded; retry later. |
| `MediaTooLarge` | A media item is too large to send. |
| `MediaProcessingFailed` | A media item could not be prepared for Telegram. |
| `TelegramDeliveryFailed` | A prepared media item could not be sent. |
| `OperationTimedOut` | The request took too long and was stopped. |
| `ServiceBusy` | The bot is busy; retry shortly. |

Item outcomes retain one-based source position. Final responses report counts/positions without raw URLs, hosts, process output, paths, stack traces, Telegram payloads, or provider diagnostics.

## Configuration and Operations

`src/config/load-config.ts` is the only production module reading environment variables. Zod parses once into immutable configuration. Implementation adds a secret-free `.env.example`.

| Variable | Required/default | Purpose |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | required | Non-empty secret; never logged |
| `YT_DLP_PATH` | `yt-dlp` | Trusted executable name/path |
| `EXTRACTION_TIMEOUT_MS` | `30000` | Bounded extraction deadline |
| `DOWNLOAD_TIMEOUT_MS` | `60000` | Absolute per-attempt deadline |
| `PROCESSING_TIMEOUT_MS` | `60000` | Processing-port bound |
| `DELIVERY_TIMEOUT_MS` | `30000` | Delivery bound |
| `JOB_TIMEOUT_MS` | `115000` | Whole-job deadline |
| `MAX_MEDIA_BYTES` | `51380224` (49 MiB) | Cloud Bot API headroom |
| `TEMP_DIR` | OS temp directory | Absolute existing writable parent |
| `MAX_CONCURRENT_JOBS` | `2` | Bounded active jobs |
| `MAX_QUEUED_JOBS` | `8` | Bounded waiters |
| `LOG_LEVEL` | `info` | Pino level |

Use Node's stable `--env-file=.env` locally, avoiding `dotenv`. Pino writes JSON stdout and request child logs with correlation ID, stage, provider, item position, duration, and stable code. Exclude tokens, headers/cookies, env dumps, raw updates/text, full URLs, process output, filenames, and unnecessary user/chat identifiers; configure static redaction paths.

## Concurrency and Resource Ownership

- An in-process semaphore admits two jobs; a FIFO of eight waits within the job deadline. Full/expired admission returns `ServiceBusy`. No durable/distributed queue.
- Items are sequential per job, preserving order and limiting one large active file/upload.
- Every job owns immutable context, permit, signal, provider result, workspace, and generated names. No chat-specific global mutable state.
- Approximate disk bound is `MAX_CONCURRENT_JOBS * MAX_MEDIA_BYTES` plus small overhead. Metadata/process output have separate caps.
- Shutdown stops updates, gives active jobs a short grace or aborts them, closes runner/HTTP resources, and relies on `finally` cleanup. Stateless restart loss is accepted.

## Testing Strategy

Follow red-green-refactor for every behavior.

- **URL/provider**: exactly-one URL, allowed variants, lookalikes/credentials/ports/non-post paths, single/playlist metadata, filtering/order/ranking, malformed/capped process output, exit/timeout mapping.
- **Application**: video/animation happy paths, ordered multiple items, every item failure, continuation and summaries, deadlines, permit release, and no cross-chat delivery using fakes.
- **Downloader**: IPv4/IPv6/mapped and prohibited ranges, mixed DNS answers, redirect revalidation/cap, status/type/length, unknown/lying length, streamed overflow, midstream failure, and timeouts with MockAgent/fake resolver; disable unmocked network.
- **Filesystem**: assert partials/workspaces disappear after success, every failure, cancellation, timeout, and cleanup-error logging.
- **Telegram adapter**: translation, use-case call, safe copy, delivery kind, and no diagnostic leak without live API.
- **Process integration**: controlled fixture process verifies arrays, caps, termination, exit handling, cancellation. Live X is separately tagged opt-in.
- **Tooling**: establish `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` using ESLint flat/typescript-eslint, strict `tsc --noEmit`, Vitest run mode, and build `tsc`.

## Project Structure

### Documentation

```text
specs/001-x-media-download/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── application-ports.md
│   └── telegram-bot.md
└── tasks.md                 # Later: $speckit-tasks
```

### Source Code

```text
src/
├── index.ts
├── bot/
│   ├── telegram-bot.ts
│   └── telegram-delivery.ts
├── application/
│   ├── download-post-media.ts
│   ├── ports.ts
│   └── outcomes.ts
├── providers/
│   ├── media-provider.ts
│   └── x/
│       ├── x-media-provider.ts
│       ├── x-url.ts
│       └── yt-dlp-schema.ts
├── media/
│   ├── representation-selector.ts
│   ├── safe-media-downloader.ts
│   └── direct-media-processor.ts
├── infrastructure/
│   ├── process-runner.ts
│   ├── safe-http-client.ts
│   ├── temporary-workspace.ts
│   ├── admission-control.ts
│   └── logger.ts
├── config/load-config.ts
└── shared/
    ├── errors.ts
    └── identifiers.ts

tests/
├── unit/
├── integration/
└── fixtures/
```

**Structure Decision**: This new single-service repository follows the constitution's real boundaries without generic empty layers. There is one provider and direct composition in `index.ts`; no registry/plugin framework is planned.

## Complexity Tracking

No constitution violations require justification.
