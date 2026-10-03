# Implementation Plan: X/Twitter Media Download

**Branch**: `001-x-media-download` (Spec Kit feature identity; current checkout `main`) | **Date**: 2026-10-03 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-x-media-download/spec.md`

## Summary

Complete the existing stateless X/Twitter download feature: confirmed audio selects an audio-bearing
MP4 and `sendVideo`; confirmed silence converts a local MP4 into a real GIF for `sendAnimation`;
unknown/contradictory audio stays on MP4/video. Retain grammY polling, metadata-only pinned yt-dlp,
secure streaming download, bounded admission, ordered partial results, typed errors, and cleanup.
Add only a pinned FFmpeg processor and the concrete contracts needed for local conversion.
Persistence, other providers, arbitrary transformation, HLS assembly, and split-stream merging remain excluded.

**Planning inputs**: [silent-media design](../../docs/superpowers/specs/2026-09-30-silent-media-gif-design.md),
[earlier implementation plan](../../docs/superpowers/plans/2026-09-30-sound-aware-gif-conversion.md),
and [completion assessment](./completion-preparation.md). Revised Spec Kit requirements override
their label-driven animation, direct-only audio aggregation, and signature-only validation decisions.

**Current-code inspection**: Provider mapping currently uses any silent AVC format to classify an
item as animation, and coalesces conflicting audio fields. Selection does not protect known sound;
processing returns the source MP4; delivery always uploads `downloaded.path`. The runner hardcodes
provider errors and yt-dlp version flags; workspace fallback removes source partials but not complete
source/output artifacts. These are the changes planned below. Existing T001–T091 remain historical
completed capabilities, not proof of the revised feature. Do not rebuild their working boundaries.

**Checkpoint scope**: Phase 0 research and Phase 1 design only; no production implementation or
task checkbox changes. Next, refresh `tasks.md` through Spec Kit using the work packages below.

## Technical Context

**Language/Version**: Node.js 24 LTS; TypeScript 5.x in strict ESM mode

**Primary Dependencies**: Existing `grammy`, `@grammyjs/runner`, `zod`, `pino`, `undici`,
`abort-controller`, `ipaddr.js`; external pinned yt-dlp and FFmpeg. No new npm media encoder or ffprobe.

**Storage**: No database or persistent storage. Retain request-scoped `fs.mkdtemp`; retire artifacts
after each attempt/item, with request-finally cleanup. At most one capped MP4, one capped GIF, and
one palette capped at 16 KiB per active job; default media storage is 196 MiB + 32 KiB plus overhead.

**Testing**: Existing Vitest, MockAgent, injected ports/clocks, metadata fixtures, and controlled
temporary roots. Unit/default tests remain binary-free. A separately invoked, required-at-completion
controlled FFmpeg integration lane proves synthetic MP4-to-GIF conversion and full decode. Live
Telegram/X smoke tests remain opt-in and separate from that deterministic integration gate.

**Target Platform**: Existing Linux server/container, Node.js 24, current egress policy, and pinned
compatible yt-dlp/FFmpeg binaries with deployment provenance/checksums and applicable notices.

**Project Type**: Single-process long-running Telegram bot service

**Performance Goals**: Under the controlled, no-live-network acceptance conditions in SC-002 and SC-003, nearest-rank p95 invalid-input feedback is at most five seconds and nearest-rank p95 valid-request delivery or terminal feedback is at most two minutes. Live X/Twitter and Telegram latency is measured separately and is not a mandatory deterministic gate. Items are delivered sequentially in source order.

**Constraints**: Preserve 49 MiB source/upload cap; 30 s extraction, 60 s download, 30 s delivery,
115 s job lifetime, three redirects, two active/eight queued jobs. One item at a time per job.
Use the existing 60 s processing limit as one shared item budget across conversion passes,
validation, and fallback. Fixed GIF profile: 15 fps, at most 640 by 640 without upscaling, aspect
ratio preserved, at most 256 colors, single-thread decoder/encoder/filters, 16,777,216 input pixels,
64 MiB allocation guard, and separately capped binary output/diagnostics. Allocation guard is not
a total RSS guarantee; deployment must provision decoded-frame/filter memory per admitted child.

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
| External FFmpeg executable | Local silent-MP4-to-real-GIF conversion and full GIF decode validation | Node has no built-in MP4 decoder, palette encoder, or full animated-GIF decoder | JavaScript media encoder; unchanged MP4 animation upload | The explicit real-GIF requirement justifies one deployment-pinned binary behind the existing bounded process port; no new npm dependency or general transcoding system |
## Constitution Check

*GATE: Pre-research and post-design checks pass for this planned change. PASS refers to documented
design compliance, not completed implementation; every code/verification gate remains required.*

| Principle / Gate | Plan evidence | Status |
|---|---|---|
| Explicit layer boundaries | Telegram transport depends on one application use case; provider discovery, safe download, processing seam, delivery, and infrastructure are separate ports. No grammY, yt-dlp, or Undici types enter application models. | PASS |
| Security and resource safety | Retain SSRF/network controls; local-only FFmpeg inputs, disabled external data references, argument arrays, hard binary sink caps, source/output ownership, bounded threads/pixels/allocation/deadlines, cleanup before fallback, and observed child closure. | PASS |
| Strict types and validated boundaries | Strict TypeScript, Zod schemas for configuration and yt-dlp JSON, discriminated outcomes/errors, and one controlled `process.env` boundary. | PASS |
| Test-driven deterministic quality | Red-green-refactor by boundary; fakes, fixtures, MockAgent, injected clocks/IDs/resolvers, and temporary directories replace live dependencies in normal tests. | PASS |
| Simplicity and maintainability | Existing service/provider and ports; direct video passthrough plus one narrowly scoped FFmpeg converter; no database, distributed queue, plugin framework, or cache. | PASS |
| Verification gates | Existing real lint/typecheck/test/build scripts are retained. Add explicit controlled FFmpeg integration invocation, routing/output/lifecycle regressions, and final review. | PASS (design; execution pending) |

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
  -> GifMediaProcessor (video passthrough; silent local MP4 -> validated GIF)
  -> TelegramDelivery (individual local-file uploads)
  -> safe final outcome / partial-failure summary
```

1. The transport extracts text and an opaque chat destination, creates a correlation ID, and calls the use case. It performs no discovery or file work.
2. The application extracts exactly one candidate URL. The X provider recognizes exact allowed hosts and validates scheme, port, credentials, and status path into a `PostReference`.
3. After admission, the job creates one unique workspace. The provider invokes yt-dlp in metadata-only mode and maps validated JSON to source-ordered provider-neutral media and representations.
4. Aggregate explicit audio state across usable video formats before filtering/ranking. Select
   progressive HTTPS MP4s with confirmed audio for audio-bearing items, silent AVC sources for
   confirmed silence, and existing video candidates for unknown/conflicting evidence. Retain
   deterministic quality ranking, streamed unknown-size enforcement, and bounded safe fallback.
5. For each item sequentially, the downloader validates and pins the public destination, follows at most three revalidated redirects, streams into a generated `.part` path with an absolute deadline and hard byte counter, then renames a complete file.
6. Allocate one shared item processing budget. Audio/uncertain MP4s remain unchanged; confirmed
   silent MP4s become GIFs via palette generation, encoding, structural inspection, and full decode.
   The prepared artifact carries its actual upload path/container/size. Upload GIF with
   `sendAnimation`; MP4 with `sendVideo`. Clean item artifacts before fallback or moving on.
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

- Retain the processing port. `GifMediaProcessor` delegates non-silent MP4s to direct video
  preparation and converts only `audioPresence: absent`; no label or selected silent alternative
  can authorize conversion of an audio-bearing/unknown item.
- Freeze [sound-aware contracts](./contracts/sound-aware-media.md) before parallel implementation.
  Use generated palette/GIF partial/final paths in the existing workspace, hard-capped binary stdout
  sinks through `ProcessRunner`, fixed local input formats/protocols, non-shell arrays, and one
  shared budget. GIF validation requires complete structure and full decode, not just a signature.
- Research decisions, source citations, and alternatives are in [research.md](./research.md#11-sound-aware-completion-decisions).
  HLS-only conversion, merging, repair, size-reduction transcoding, and a generic transformation
  graph remain excluded.

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
| `MediaProcessingFailed` | Item-level outcome | No eligible source for the required audio/delivery path, or conversion/validation failed. |
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
| `FFMPEG_PATH` | required | Trusted deployment-installed executable; never provider-selected |
| `FFMPEG_EXPECTED_VERSION` | required | Exact approved token from the first line of `ffmpeg -version`; mismatch/missing/malformed result prevents polling |
| `EXTRACTION_TIMEOUT_MS` | `30000` | Bounded extraction deadline |
| `DOWNLOAD_TIMEOUT_MS` | `60000` | Absolute per-attempt deadline |
| `PROCESSING_TIMEOUT_MS` | `60000` | One item budget across palette/encoding/validation/fallback, also bounded by job lifetime |
| `DELIVERY_TIMEOUT_MS` | `30000` | Delivery bound |
| `JOB_TIMEOUT_MS` | `115000` | Whole-job deadline |
| `MAX_MEDIA_BYTES` | `51380224` (49 MiB) | Independent source and GIF write/upload caps; may only be lowered |
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
Apply the same provenance/pin/license ownership to FFmpeg. Its verifier uses `-version` with a
16 KiB bounded banner, parses the first-line token, and uses a 5-second timeout. Do not call the
yt-dlp-only `--version` helper or invent an approved FFmpeg token. Runtime configuration and
`.env.example` updates are planned implementation tasks, not changes made by this planning command.

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
- Media disk bound is `MAX_CONCURRENT_JOBS * (2 * MAX_MEDIA_BYTES + 16384)` plus filesystem
  overhead, provided per-attempt retirement succeeds. At defaults this is 196 MiB + 32 KiB.
  Binary sinks hard-count writes; source, palette, and GIF never accumulate across items/fallbacks.
  Captured metadata/diagnostics have separate caps. Failed cleanup prevents further acquisition
  after bounded retry; it cannot silently invalidate the bound.
- On SIGINT/SIGTERM, shutdown stops polling/admission, cancels queued work deterministically, signals active jobs, closes HTTP resources, terminates owned children, cleans workspaces, and releases permits. It waits at most the configured `SHUTDOWN_GRACE_MS=30000` before force termination; no unsafe final user message is attempted.

## Testing Strategy

Follow red-green-refactor for every behavior.

- **URL/provider**: exactly-one URL, allowed variants, lookalikes/credentials/ports/non-post paths, single/playlist metadata, filtering/order/ranking, malformed/capped process output, exit/timeout mapping.
- **Application**: video/animation happy paths, ordered multiple items, every isolated item failure with continuation, request-wide deadline/cancellation/global-destination termination, failed-versus-unattempted summaries, permit release, and no cross-chat delivery using fakes.
- **Downloader**: IPv4/IPv6/mapped and prohibited ranges, mixed DNS answers, redirect revalidation/cap, status/type/length, unknown/lying length, streamed overflow, midstream failure, and timeouts with MockAgent/fake resolver; disable unmocked network.
- **Filesystem**: assert partials/workspaces disappear after success, every failure, cancellation, timeout, and cleanup-error logging.
- **Telegram adapter**: translation, use-case call, safe copy, delivery kind, and no diagnostic leak without live API.
- **Process integration**: controlled fixture process verifies arrays, caps, termination, exit handling, cancellation. Live X is separately tagged opt-in.
- **Audio classification/selection**: table-drive missing/null/blank/unknown fields, one-field
  evidence, conflicts, mixed audio/silent alternatives, silent-plus-unknown, audio only in unsupported
  or oversized formats, and GIF labels. Preserve existing codec-omitted CDN inference and static exclusion.
- **Conversion**: controlled process and real tiny GIF fixtures test two-pass arguments, streamed
  output caps, full structural validation, missing/empty/truncated/undecodable output, cleanup,
  processing/job deadlines, cancellation, and zero remaining time before spawn. Encoding and decode
  validation share one item budget; no binary required in ordinary unit tests.
- **Prepared delivery**: assert exact uploaded bytes/path/container and method; audio-bearing and
  unknown MP4 bytes are unchanged; silent upload is a distinct valid GIF. Test permanent destination
  rejection, cancellation, later-item continuation, source/palette/GIF removal, and permit release.
- **Real FFmpeg integration**: a separate gated command uses the approved local binary with synthetic
  MP4/real GIF fixtures and no live network. Verify all frames decode and deliberately truncated
  output fails. Missing binary/version fails this required completion lane rather than silently skipping.
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
└── tasks.md                 # Existing completed tasks; append revised work with $speckit-tasks
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

**Structure Decision**: Retain this implemented single-service layout and direct composition in
`index.ts`. Add only `src/media/gif-media-processor.ts`, `src/media/gif-validator.ts`, and
`src/config/verify-ffmpeg-version.ts`, their focused tests, controlled FFmpeg integration support,
and `docs/media-processing.md`. No registry/plugin framework or unrelated layer is planned.

## Contract Freeze and Implementation Work Packages

These packages guide the next Spec Kit task update; they are not completion claims or one-commit-per-task rules.
Each future package includes failing tests before behavioral implementation, targeted verification,
lint/typecheck, relevant build checks, and a coherent checkpoint commit under `AGENTS.md`.

### Serial foundation

**S0 — Freeze and migrate shared contracts.** Single owner implements the exact
[sound-aware contracts](./contracts/sound-aware-media.md): audio evidence/state, copied downloaded
state, discriminated upload artifact, workspace paths/method signatures, stage-aware process request
and optional binary sink, and shared processing budget. Migrate existing builders/port doubles and
direct processor construction sites once. Declare every consumer touched and get typecheck/build
green before owners split. During the incomplete conversion rollout, direct preparation must fail
silent items safely rather than encode a falsely successful MP4 animation artifact.
S0 explicitly replaces obsolete direct-MP4 animation success assertions with contract-correct
interim coverage: explicit silent test inputs fail preparation until the converter is wired, while
unknown inputs use video. F adds full real-GIF integration success coverage. Document the changed
requirement; do not weaken retained security/lifecycle tests or leave a
checkpoint knowingly failing. Audio evidence derivation remains A's work; S0 migrates legacy
production values conservatively to unknown rather than inventing a sound classification.

S0 owns `src/application/models.ts`, `src/application/ports.ts`, `tests/support/builders.ts`, and
mechanical signature/construction migrations in existing source/test consumers. It also updates
`src/media/safe-media-downloader.ts` to copy audio state and `src/media/direct-media-processor.ts`
to populate direct-video upload fields. No other owner edits those shared files during parallel work.
After S0, contract changes return to that owner at a synchronization barrier; no silent divergence.

### Exclusive owners and dependencies

| Package | Depends on | Exclusive files after S0 | Observable completion |
|---|---|---|---|
| A — Audio classification and sound-preserving selection | S0 | `src/providers/x/yt-dlp-schema.ts`, `src/media/representation-selector.ts`; provider/selector/animation unit tests; X audio fixtures | Frozen truth table, audio-safe fallback, unchanged uncertain-video ranking/static filtering |
| B — FFmpeg config and approved-version verifier | S0 | `src/config/load-config.ts`, new `verify-ffmpeg-version.ts`; config tests; `.env.example` | Required settings, correct bounded `-version` parse/compare, safe missing/mismatch failure; no startup wiring yet |
| C — Process sink and workspace lifecycle | S0 | `src/infrastructure/process-runner.ts`, `src/infrastructure/temporary-workspace.ts`; their unit tests, `tests/integration/process-runner.integration.test.ts`, `tests/fixtures/process/`, `tests/support/process/` | Stage-aware errors with preserved provider exit classification, exact cap/one-byte overflow, binary streaming/close, generated paths/retirement, fatal-resource notification |
| D — Converter and full GIF validator | S0, C | new `src/media/gif-media-processor.ts`, `gif-validator.ts`; new converter/validator unit tests; `tests/fixtures/media/`, `tests/support/ffmpeg/`, `tests/integration/ffmpeg/` | Two-pass local conversion, complete/decodable GIF, one budget, bounded output and prompt partial removal |
| E — Prepared-artifact Telegram upload | S0 | `src/bot/telegram-delivery.ts`; existing delivery/destination unit tests and new artifact cases | Actual prepared path and correct method; unchanged native cancellation/permanent-destination behavior |
| F — Orchestration, production wiring, operator docs | A, B, C, D, E | `src/application/download-post-media.ts`, `src/index.ts`; application/lifecycle tests; US1/US2 integration tests; acceptance workloads; README/security/media-processing docs; quickstart executable integration invocation | One item budget across fallback, item retirement, fatal-resource callback wired to existing service cancellation/shutdown, both binaries verified before polling, GIF upload end-to-end |
| G — Final verification and review | F | Review only; fixes assigned back to the affected exclusive owner | All gates, controlled FFmpeg lane, spec/contract/task consistency, no unresolved blocking defect or intended uncommitted work |

After S0, A/B/C/E can proceed independently. D starts only after C's sink/path contracts are
implemented and verified; D can overlap unfinished A/B/E. F is the serial integration barrier.
F alone edits `src/index.ts` and orchestration after S0; A/B/D/E must not independently wire startup
or edit shared integration fixtures. B and F synchronize the environment/config names, while D
receives executable/options through constructor injection rather than importing environment access.
Do not edit package tooling or lockfiles in multiple lanes; F owns the explicit FFmpeg integration
script/test exclusion configuration when adding that required command. Defaults remain binary-free.
F owns `package.json`, `vitest.config.ts`, and new `vitest.ffmpeg.config.ts` for that lane; no dependency
or lockfile change is expected. C/D notify the service through the frozen callback rather than
modifying admission, transport, or startup independently. If bounded final cleanup or child closure
fails, F synchronously cancels service acquisition before releasing permits and schedules existing
shutdown without self-await deadlock; ordinary faults retain per-item/unrelated-job isolation.
The integration owner also changes safe `MediaProcessingFailed` copy from the old direct-only
wording to include preparation failure; it owns `src/bot/telegram-bot.ts` and related copy tests for
that specific change, retaining all other handler behavior.

```text
S0 -> A -----\
   -> B ------\
   -> C -> D ---> F -> G
   -> E ------/
```

### Planned verification and traceability

| Requirement | Packages and required evidence |
|---|---|
| FR-008/FR-022 | A: per-format and item truth tables; audio-bearing lower-quality alternative wins over silent; undeliverable audio prevents conversion |
| FR-011/SC-001 | A/D/E/F: audio MP4/video, confirmed silent real GIF/animation, unknown/conflicting MP4/video; exact artifact bytes/path |
| FR-023/SC-007 | B/C/D/F: approved startup pin, structured local-only process input, hard byte cap, GIF structure+decode, shared budget, observed termination and cleanup |
| FR-010/FR-015–FR-018 | C/D/F: source/palette/GIF removal before fallback/next item; later-item continuation; partial termination; admission release; isolated destinations |
| SC-002/SC-005/SC-006 | F/G: revise sound-aware controlled workloads while preserving exact existing counts, handler timing, taxonomy/copy, duplicates, busy cases and cleanup retries |

At completion run existing `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, and
`npm run format:check`, plus the planned explicit controlled FFmpeg integration command. Record
pre-existing repository formatting issues separately; do not weaken checks. Review all changes
since this planning checkpoint for audio loss, unsafe arguments/references/paths, output validation,
storage/termination leaks, timeout resets, and secret exposure. Preserve completed task history;
append unchecked tasks for S0–G, then run Spec Kit analysis before implementation.

## Complexity Tracking

No constitution violations require justification.
