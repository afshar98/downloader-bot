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

**Performance Goals**: Under the controlled, no-live-network acceptance conditions in SC-002 and SC-003, nearest-rank p95 invalid-input feedback is at most five seconds and nearest-rank p95 valid-request delivery or terminal feedback is at most two minutes. Live X/Twitter and Telegram latency is measured separately and is not a mandatory deterministic gate. Items are delivered sequentially in source order.

**Constraints**: 49 MiB default upload cap (below the cloud Bot API's current 50 MB multipart limit); 30 s extraction timeout; 60 s absolute timeout per media download; 30 s delivery timeout; 115 s job deadline; three redirects; two active and eight queued jobs by default. Limits are finite and startup-validated. One item is processed at a time per job.

**Scale/Scope**: X/Twitter video and animated media only; one Node.js process and a bounded in-memory admission queue. No distributed workers, accounts, history, cache, analytics, or other providers.

### Production Dependency Rationale

| Dependency | Purpose and concrete MVP value | Why the Node.js standard library alone is insufficient or less appropriate | Simpler alternative considered | MVP justification |
|---|---|---|---|---|
| `grammy` | Typed Telegram update handling, Bot API calls, multipart media upload, and normalized adapter behavior | Direct HTTP calls require maintaining Bot API types, update offsets, multipart encoding, and Telegram error translation | Direct Bot API calls with `fetch` | The maintained typed adapter removes substantial protocol plumbing while remaining confined to `src/bot` |
| `@grammyjs/runner` | Bounded long-polling concurrency and coordinated runner shutdown | A custom polling loop must safely manage offsets, concurrent update work, backpressure, cancellation, and shutdown | grammY's basic sequential polling | The feature performs long file operations; the runner provides the required bounded concurrency lifecycle without a custom scheduler |
| `zod` | Runtime validation and typed narrowing for startup configuration and untrusted yt-dlp JSON | TypeScript types do not validate runtime data; hand-written guards would duplicate coercion, bounds, union, and diagnostic logic | Focused hand-written validators | Two substantial untrusted boundaries reuse the same small validation library, reducing inconsistent validation code |
| `pino` | Structured JSON logging, child context, levels, error serialization, and static redaction | `console` provides output but not reliable structured context, level policy, serialization, or field redaction | A small `console` JSON wrapper | Security requires consistent redaction and operator context; recreating those facilities would be more code and risk than the dependency |
| `undici` | Explicit dispatcher/connector control, streaming bodies, timeouts, aborts, and MockAgent for the secured downloader | Node's global `fetch` does not expose the required standard lookup-to-socket binding surface; core `https.request` needs extensive redirect, pooling, and test plumbing | Core `https.request` | The custom connector and deterministic MockAgent directly support SSRF defense and bounded streaming at the network boundary |
| `abort-controller` | A grammY-compatible `AbortSignal` type and runtime signal implementation for upload cancellation | Node's built-in signal is not assignable to grammY's bundled signal type, so direct use fails strict typechecking at this boundary | Implement a custom signal adapter or use an unsafe assertion | The small maintained package is already used by grammY and provides a typed bridge that forwards cancellation without assertions |
| `ipaddr.js` | Parse and classify IPv4, IPv6, and IPv4-mapped IPv6 ranges for outbound policy | `node:net.isIP` validates syntax but does not classify private, link-local, multicast, CGNAT, documentation, reserved, and mapped ranges | Hand-maintained CIDR/range checks | A focused, mature classifier is safer and simpler than custom security-sensitive address arithmetic |
| External `yt-dlp` executable | Metadata-only discovery for volatile public X/Twitter post formats and multi-item results | Node provides no X/Twitter extractor; custom HTTP scraping would reproduce unstable guest-token, GraphQL, card, and format logic | Official X API, custom scraping, or a small npm downloader | A pinned, checksum-verified executable behind `ProcessRunner` provides the broadest maintained extraction behavior; no self-update, plugins, remote components, or provider-controlled downloads are allowed |
## Constitution Check

*GATE: Reconciled after specification-analysis remediation. Each PASS below is supported by the cited plan content and remains subject to implementation verification.*

| Principle / Gate | Plan evidence | Status |
|---|---|---|
| Explicit layer boundaries | Telegram transport depends on one application use case; provider discovery, safe download, processing seam, delivery, and infrastructure are separate ports. No grammY, yt-dlp, or Undici types enter application models. | PASS |
| Security and resource safety | Full URL validation, DNS/IP policy and connection pinning, manual redirect validation, byte-counted streams, timeouts, bounded process output, non-shell execution, isolated paths, finally cleanup, and bounded concurrency. | PASS |
| Strict types and validated boundaries | Strict TypeScript, Zod schemas for configuration and yt-dlp JSON, discriminated outcomes/errors, and one controlled `process.env` boundary. | PASS |
| Test-driven deterministic quality | Red-green-refactor by boundary; fakes, fixtures, MockAgent, injected clocks/IDs/resolvers, and temporary directories replace live dependencies in normal tests. | PASS |
| Simplicity and maintainability | One service/provider, individual delivery, direct MP4 upload, and no database, distributed queue, plugin framework, cache, or FFmpeg. | PASS |
| Verification gates | The repository has no package tooling. Implementation establishes real `lint`, `typecheck`, `test`, and `build` npm scripts before feature work. | PASS (planned prerequisite) |

No constitutional exception or complexity waiver is requested. The specification now contains its own compliance section; this plan records dependency rationale, resource ownership, untrusted boundaries, deterministic tests, and real verification gates. Final compliance still requires the implementation and every applicable repository gate to pass.
| Minimal justified dependencies | The production dependency table records purpose, standard-library limitations, simpler alternatives, and concrete MVP justification for every planned production dependency and the external yt-dlp executable. | PASS |

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
7. Delivery is individual and source-ordered. An isolated retrieval, preparation, or ordinary Telegram delivery failure is recorded and later items continue.
8. Job deadline and caller/job/shutdown cancellation are request-wide. Cancellation safely aborts in-progress work, preserves delivered items, prevents remaining items from starting, classifies them as unattempted due to cancellation, and relies on `finally` cleanup/release. When at least one item was delivered and the destination remains usable, send one safe partial summary; otherwise return `OperationTimedOut` or `OperationCancelled`.
9. `DeliveryDestinationUnavailable` is request-wide only when the Telegram adapter receives an authoritative permanent destination-level rejection, including blocked bot, removed bot, missing/inaccessible destination, missing send permission, or an explicitly permanent equivalent. It preserves delivered items, stops later deliveries, cleans up normally, logs only safe stable context, and suppresses a final Telegram summary. Individual upload failures, transient network/server failures, timeouts, rate limits, media-specific rejections, and unknown Telegram errors remain item-local or retain their existing typed meaning.
10. The use case removes partials promptly, removes the workspace in `finally`, and releases admission in `finally`. Cleanup failure is logged without replacing the primary outcome.

## Key Technical Decisions

### Telegram transport and delivery

- Use grammY and `@grammyjs/runner` with long polling, bounded runner concurrency, `bot.catch`, and graceful SIGINT/SIGTERM shutdown. Webhooks are deferred because local MVP operation has no public HTTPS requirement.
- Upload individual local files rather than using `sendMediaGroup` or Telegram-fetched URLs. This supports per-item continuation, mixed video/animation semantics, and any item count.
- Keep grammY `Context`, updates, and `InputFile` in `src/bot`; application ports use opaque destinations and controlled file descriptors.

### X provider and process

- Validate only the submitted candidate URL: HTTPS `x.com`, `www.x.com`, `twitter.com`, or `www.twitter.com`, plus the exact status path; input validation does not follow submitted-post redirects. Media representation redirects are separate and follow the Safe HTTP Downloader policy below. Query/fragment data is removed from the canonical post reference.
- Spawn the configured binary with argument-array equivalents of `--ignore-config --no-plugin-dirs --no-remote-components --socket-timeout`, `--dump-single-json`, `--skip-download`, `--yes-playlist`, `--use-extractors twitter`, and `-- <validated-url>`; always `shell: false`.
- Cap stdout/stderr, apply the extraction deadline, kill on timeout/cancellation, validate JSON with Zod, accept one entry or playlist entries, and preserve entry order. Never log raw process output/full URLs.
- Check `yt-dlp --version` at startup. Pin artifact/checksum and update deliberately; never self-update or load plugins/remote components at runtime.

### Safe HTTP Downloader policy

- Use explicit `undici`. Automatic redirects are disabled. Every hop requires HTTPS, no credentials, default port, and bounded length; relative redirects are resolved then fully revalidated.
- A custom lookup resolves all A/AAAA answers, normalizes IPv4-mapped IPv6, and rejects the host if any answer is loopback, private/ULA, link-local, unspecified, multicast, CGNAT, documentation, reserved, or otherwise non-global. The connector receives a validated address, binding validation to the socket. `ipaddr.js` handles classification; an egress firewall is defense in depth.
- Send no credentials/cookies. Request identity encoding, accept only successful expected media, reject oversized declared lengths, configure response/connect/header/body bounds, and still count streamed bytes through `stream.pipeline`.
- Only generated names such as `item-0001.part` and `item-0001.mp4` become paths. Writes are exclusive and incomplete files are deleted.
- Do not transparently retry HTTP, yt-dlp, or Telegram operations in the MVP. The only second attempt is the bounded next representation after a representation-specific size/compatibility failure; policy violations, stage timeouts, and ambiguous failures are terminal for that item. Caller/job/shutdown cancellation is never item-level: it maps to `OperationCancelled` and terminates the request.

### Media processing

- The MVP `MediaProcessor` is a narrow identity/direct-delivery component, not a framework. It validates compatibility or returns `MediaProcessingFailed`.
- Do not install/invoke FFmpeg. Add an adapter only for a reproducible HLS-only, split-stream, codec/container, fast-start-repair, or size-reduction requirement. It must use argument arrays, `shell: false`, deadlines, capped output, controlled paths, exit checks, and cleanup; remux/stream-copy precedes transcoding.

## Error Model and User Mapping

Errors are discriminated values with stable `code`, safe operator context, optional cause, and retryability. Arbitrary messages never control behavior.

The specification's canonical outcome taxonomy is authoritative; this table mirrors its stable codes,
scope, and safe handling. There is no separate platform error: a syntactically valid URL outside the
allowlist, including another platform or a non-post path, is `UnsupportedPostUrl`.

| Code | Class | Safe mapping / handling |
|---|---|---|
| `InvalidUrl` | User-sendable rejection | Ask for exactly one URL; covers none, malformed sole token, multiple, and over-limit input. |
| `UnsupportedPostUrl` | User-sendable rejection | Ask for one supported HTTPS X/Twitter status URL. |
| `PostInaccessible` | User-sendable request outcome | Post unavailable; check access or retry later. |
| `MediaNotFound` | User-sendable request outcome | No supported video or animated media was found. |
| `ProviderRateLimited` | User-sendable request outcome | Provider temporarily limited access; retry later. |
| `ProviderOutputInvalid` | User-sendable request outcome | Media details could not be read safely; retry later; expose no provider output. |
| `MediaDownloadFailed` | Item-level outcome | This item could not be retrieved; continue later items. |
| `MediaTooLarge` | Item-level outcome | This item exceeds the configured media limit. |
| `MediaProcessingFailed` | Item-level outcome | This item has no directly deliverable representation or could not be prepared. |
| `TelegramDeliveryFailed` | Item-level outcome | This item could not be sent; continue unless a request-wide terminal applies. |
| `OperationTimedOut` | Request-wide terminal | Preserve successes; send timeout copy or partial summary only if destination remains usable. |
| `OperationCancelled` | Request-wide terminal | Preserve successes; send cancellation copy or partial summary only if destination remains usable. |
| `ServiceBusy` | User-sendable rejection | Capacity unavailable; retry shortly. |
| `DeliveryDestinationUnavailable` | Logged-only request-wide terminal | Stop delivery, preserve successes, mark remaining items unattempted, suppress final summary. |
| `CleanupFailed` | Logged-only secondary event | Safe operator log only; never replace the primary outcome or expose paths. |

Item outcomes retain one-based source position. Final responses report counts/positions without raw URLs, hosts, process output, paths, stack traces, Telegram payloads, or provider diagnostics. `DeliveryDestinationUnavailable` cannot produce a Telegram response to the unavailable destination. The adapter uses that code only for authoritative permanent destination rejection; transient, rate-limit, timeout, media-specific, and unknown failures are not classified globally.

## Configuration and Operations

`src/config/load-config.ts` is the only production module reading environment variables. Zod parses once into immutable configuration. Implementation adds a secret-free `.env.example`.

| Variable | Required/default | Purpose |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | required | Non-empty secret; never logged |
| `YT_DLP_PATH` | `yt-dlp` | Trusted executable name/path |
| `YT_DLP_EXPECTED_VERSION` | required | Exact approved output from `yt-dlp --version`; startup must match before polling |
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
| `MAX_YTDLP_STDOUT_BYTES` | `1048576` | Metadata JSON cap |
| `MAX_YTDLP_STDERR_BYTES` | `65536` | Diagnostic cap; never user-visible |
| `MAX_METADATA_BYTES` | `1048576` | Parsed provider payload cap |
| `MAX_REDIRECTS` | `3` | Manual HTTP hop cap |
| `MAX_OPEN_DOWNLOADS` | `2` | One active stream per admitted job |
| `SHUTDOWN_GRACE_MS` | `30000` | Maximum graceful cancellation wait |

Deployment/dependency maintenance owns compatibility assumptions: the deployed Telegram Bot API
cloud limit/format behavior and the pinned yt-dlp version are verified in the deterministic adapter
fixtures and documented release smoke check. Re-review is required on a Bot API limit/format change,
an X extractor regression, a yt-dlp security release, or planned dependency update. Deployments pin
the yt-dlp artifact/version, record source provenance and checksum/signature when the channel
supports it, disable self-update/plugins/remote components, ship applicable license notices, and
fail startup when the executable/version check does not match the approved deployment record.

Use Node's stable `--env-file=.env` locally, avoiding `dotenv`. Pino writes JSON stdout and request child logs with correlation ID, stage, provider, item position, duration, and stable code. Exclude tokens, headers/cookies, env dumps, raw updates/text, full URLs, process output, filenames, and unnecessary user/chat identifiers; configure static redaction paths.


### Enforced boundary policy

- The URL extractor follows the exact token and status-path grammar in the specification. It does not
  accept an original rejected X URL through a redirect: post validation completes before yt-dlp runs.
- `SafeHttpClient` is only for application-controlled representation downloads. It disables automatic
  redirects; resolves a relative `Location` against the current URL; parses and fully revalidates
  every target; rejects missing/malformed location, loops, HTTPS-to-HTTP downgrade, changed port or
  credentials, and a public-to-non-global DNS transition; and closes each prior response before a
  next hop. At most three redirects are followed.
- yt-dlp is a separate trust boundary. It receives only the validated canonical X post URL and may
  make network requests necessary to resolve that public post. SafeHttpClient SSRF controls do not
  constrain it. It receives no user cookies/credentials, permits no caller-selected extractor,
  plugins, remote components, or shell execution. Deployment egress restriction is defense in
  depth where available; residual extractor network risk is accepted for this metadata-only MVP.
- Selection is a total ordering: reject known oversize; require direct compatibility; compare known
  pixel area descending (missing is zero), known bitrate descending (missing is zero), known duration
  descending (missing is zero), then provider source index ascending. Unknown size remains eligible
  only behind the streaming counter. Invalid metadata cannot win a comparison.
- Workspace factory validates a non-symlink writable parent at startup and creates one `mkdtemp`
  root per request. Generated paths stay below that root, writes use exclusive create, and `.part`
  and final files are renamed only within it. A cleanup failure is a secondary `CleanupFailed` log,
  never a replacement user outcome; tests inject it and require no accessible residual under their
  controlled root after retry cleanup.
- SIGINT/SIGTERM stops admission/polling, cancels queued and active jobs as `OperationCancelled`,
  aborts HTTP, terminates/awaits children, cleans workspaces, releases permits, and waits no more
  than `SHUTDOWN_GRACE_MS` before force termination. No summary is sent if delivery is unsafe.
## Concurrency and Resource Ownership

- An in-process semaphore admits two jobs; a FIFO of eight waits within the job deadline. Full/expired admission returns `ServiceBusy`. No durable/distributed queue.
- Items are sequential per job, preserving order and limiting one large active file/upload.
- Every job owns immutable context, permit, signal, provider result, workspace, and generated names. No chat-specific global mutable state.
- Approximate disk bound is `MAX_CONCURRENT_JOBS * MAX_MEDIA_BYTES` plus small overhead. Metadata/process output have separate caps.
- On SIGINT/SIGTERM, shutdown stops polling/admission, cancels queued work deterministically, signals active jobs, closes HTTP resources, terminates owned children, cleans workspaces, and releases permits. It waits at most the configured `SHUTDOWN_GRACE_MS=30000` before force termination; no unsafe final user message is attempted.

## Testing Strategy

Follow red-green-refactor for every behavior.

- **URL/provider**: exactly-one URL, allowed variants, lookalikes/credentials/ports/non-post paths, single/playlist metadata, filtering/order/ranking, malformed/capped process output, exit/timeout mapping.
- **Application**: video/animation happy paths, ordered multiple items, every isolated item failure with continuation, request-wide deadline/cancellation/global-destination termination, failed-versus-unattempted summaries, permit release, and no cross-chat delivery using fakes.
- **Downloader**: IPv4/IPv6/mapped and prohibited ranges, mixed DNS answers, redirect revalidation/cap, status/type/length, unknown/lying length, streamed overflow, midstream failure, and timeouts with MockAgent/fake resolver; disable unmocked network.
- **Filesystem**: assert partials/workspaces disappear after success, every failure, cancellation, timeout, and cleanup-error logging.
- **Telegram adapter**: translation, use-case call, safe copy, delivery kind, and no diagnostic leak without live API.
- **Process integration**: controlled fixture process verifies arrays, caps, termination, exit handling, cancellation. Live X is separately tagged opt-in.
- **Tooling**: establish `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` using ESLint flat/typescript-eslint, strict `tsc --noEmit`, Vitest run mode, and build `tsc`.

- **Controlled performance**: run the exact 100-case, maximum-two-concurrent, injected-dependency workloads in SC-002 and SC-003; measure handler-entry-to-terminal-completion with an injected monotonic clock and calculate p95 by nearest rank. Live-service timing is observational and not a deterministic gate.
- **Outcome usability**: table-drive every safe response code and partial result to verify status, corrective-versus-retry guidance, failed-versus-unattempted wording, and diagnostic redaction required by SC-006.

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
