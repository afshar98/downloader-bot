# Phase 0 Research: X/Twitter Media Download

**Research date**: 2026-09-28  
**Scope**: Technical choices for `001-x-media-download` only

## 1. Telegram framework and transport

**Decision**: Use [grammY](https://grammy.dev/) with [`@grammyjs/runner`](https://grammy.dev/plugins/runner) and long polling.

**Rationale**: grammY is TypeScript-first, lightweight, MIT-licensed, recently released, and exposes current Bot API types. Its runner supports explicitly bounded concurrent long-running work such as file transfer. Long polling needs no public HTTPS endpoint and suits local MVP development. Handlers remain translation adapters with no business logic.

**Alternatives considered**:

- [Telegraf](https://github.com/telegraf/telegraf) is capable and typed, but its published v4/Bot API release cadence is less current than grammY's at the research date.
- Direct [Bot API](https://core.telegram.org/bots/api) calls avoid a framework but require custom offset/retry/shutdown, multipart upload, error normalization, and typings.
- Webhooks require reachable HTTPS, secret validation, and server lifecycle. They can replace polling without changing application logic.

## 2. Multiple-media delivery

**Decision**: Upload items individually and sequentially in source order; send one final partial-failure summary.

**Rationale**: Individual calls isolate failures, support continuation/reporting, handle video and animation methods, and work for any item count. Local multipart upload avoids asking Telegram to fetch an untrusted URL. The cloud Bot API documents a 50 MB multipart limit, so the default is 49 MiB.

**Alternatives considered**: [`sendMediaGroup`](https://core.telegram.org/bots/api#sendmediagroup) accepts only 2–10 compatible album items and makes a group one operation, complicating animation, counts over ten, and item-level failure. URL sends have lower documented limits and delegate an untrusted fetch.

## 3. X extraction and yt-dlp

**Decision**: Implement the X provider with a pinned external [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) executable in metadata-only mode behind `MediaProvider` and `ProcessRunner`.

**Rationale**: yt-dlp has an actively maintained Twitter extractor for public x.com/twitter.com posts, cards, and multi-entry results. Structured output includes formats, dimensions, codecs, protocols, and size estimates. It consolidates volatile guest-token/GraphQL/syndication behavior. `--dump-single-json --skip-download` separates discovery from the secured application downloader. A single entry or playlist `entries` maps to source-ordered provider-neutral values. Fixtures and a fake runner keep unit tests deterministic.

Hardened arguments include `--ignore-config`, `--no-plugin-dirs`, `--no-remote-components`, socket timeout, `--dump-single-json`, `--skip-download`, `--yes-playlist`, and `--use-extractors twitter`. Spawn an argument array with `shell: false`, cap output, apply a deadline, and validate JSON.

**Tradeoffs**: yt-dlp adds a Python/standalone deployment artifact and needs deliberate updates as X changes. Public posts normally need no user credentials, but deletion, privacy, age/region restrictions, and rate limits still fail safely. Check the version at startup, pin artifact/checksum, and forbid runtime self-update.

**Licensing/deployment**: Source/PyPI is Unlicense. The Unix zipimport artifact includes ISC/MIT components; PyInstaller standalone builds include GPLv3+ code. Select and pin deliberately and ship applicable notices; see [licensing](https://github.com/yt-dlp/yt-dlp/blob/master/README.md#licensing) and [third-party licenses](https://github.com/yt-dlp/yt-dlp/blob/master/THIRD_PARTY_LICENSES.txt).

**Alternatives considered**:

- Official X API metadata requires developer credentials and adds plan/cost/rate coupling; it remains a possible future provider implementation.
- Small npm downloaders generally wrap undocumented endpoints with less coverage and maintenance evidence.
- Custom scraping duplicates brittle reverse-engineered behavior.
- Hosted APIs add privacy, trust, availability, and vendor limits.

## 4. Representation selection

**Decision**: Retain progressive HTTPS MP4 candidates and rank deliverable choices by known size and quality. Try the best fitting candidate; enforce unknown size while streaming. Permit only a bounded lower-quality fallback for representation-specific size/compatibility failure.

**Rationale**: Progressive MP4 is directly downloadable/Telegram-compatible and avoids manifests, merging, or provider-controlled downloading. All provider output remains advisory/untrusted.

**Alternatives considered**: Unconstrained yt-dlp `best` may choose HLS or split streams requiring FFmpeg and bypassing application network policy. Supporting every protocol/container expands scope without a requirement.

## 5. FFmpeg

**Decision**: Do not require FFmpeg. Upload progressive MP4 directly; use `sendAnimation` for X animated media (normally silent MP4) and `sendVideo` otherwise.

**Rationale**: Telegram accepts the selected direct formats. Routine transcoding adds CPU, latency, quality loss, packaging, and license complexity.

**Alternatives considered**: Add a narrow adapter later only for a demonstrated HLS-only, split-stream, incompatible-codec/container, fast-start repair, or size-reduction case. Future execution stays non-shell, bounded, isolated, and cleanup-safe; [FFmpeg guidance](https://ffmpeg.org/ffmpeg.html) favors stream copy when transcoding is unnecessary.

## 6. HTTP download and SSRF

**Decision**: Use explicit [`undici.request`](https://github.com/nodejs/undici) with an application-owned dispatcher/connector and [`ipaddr.js`](https://github.com/whitequark/ipaddr.js). Disable automatic redirects, validate every hop, bind DNS validation to connection lookup, and stream through a hard byte counter.

**Rationale**: Undici offers typed dispatchers, Node readable bodies, timeout/response-size controls, custom lookup/connectors, AbortSignal, and MockAgent. Resolve all A/AAAA answers, reject a hostname if any answer is non-global, then return a validated address to the actual socket, avoiding a validate-then-resolve window. Manual redirects repeat policy. Check Content-Length early and byte-count actual data.

Permit HTTPS, no credentials, default port, bounded URL length, and public destinations only. Reject loopback, private/ULA, link-local, unspecified, multicast, CGNAT, documentation, reserved, and mapped equivalents. Send no secrets/cookies and use identity encoding. Cap redirects at three. Use an egress firewall as defense in depth, following [OWASP SSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html).

**Alternatives considered**:

- Global `fetch` lacks a standard DNS lookup/socket binding surface and uses Web streams.
- Core `https.request` supports lookup injection but needs much more redirect/pooling/error plumbing.
- Automatic redirects and full buffering were rejected for security/resource reasons.

## 7. Temporary storage and concurrency

**Decision**: One `fs.mkdtemp` workspace per admitted job under a trusted parent; internally generated basenames, exclusive writes, prompt partial cleanup, and recursive top-level `finally` cleanup. Process items sequentially; admit two active jobs with eight bounded in-memory waiters by default.

**Rationale**: This isolates paths/users, preserves order, limits one active large file per job, and bounds approximate disk to active jobs times maximum size. A semaphore meets MVP needs without Redis/BullMQ.

**Alternatives considered**: Buffers violate large-media guidance; shared paths risk collision; parallel items multiply pressure; persistent/distributed queues solve absent scale/durability needs.

## 8. Configuration

**Decision**: Use [Zod](https://zod.dev/) to parse one explicit environment object at startup into immutable typed config. Use Node `--env-file` locally and add a secret-free `.env.example` during implementation.

**Rationale**: Zod is TypeScript-first, MIT, dependency-free itself, handles coercion/ranges/defaults, and also validates yt-dlp JSON. Tests pass plain input without global environment mutation.

**Alternatives considered**: Hand parsing duplicates validation/type logic; `dotenv` is unnecessary on Node 24; env-specific validators are less reusable.

## 9. Logging

**Decision**: Use [Pino](https://github.com/pinojs/pino) JSON stdout logs with request child loggers and static redaction.

**Rationale**: Pino is lightweight, maintained, typed, and supplies levels, child context, safe error serialization, and redaction. Correlation IDs plus stage/item/duration/stable code diagnose failures without sensitive payloads.

**Alternatives considered**: A console wrapper recreates levels/child/redaction/error handling; Winston's transport surface is unnecessary.

## 10. Test/build tooling

**Decision**: Establish npm scripts for strict TypeScript build/typecheck, ESLint flat/typescript-eslint, and Vitest. Inject all external boundaries; controlled resources only in integration tests.

**Rationale**: The repository has no package tooling. This satisfies mandatory lint/typecheck/test/build gates and deterministic TDD without live services, network, clocks, randomness, or binaries in normal tests.

**Alternatives considered**: Node's runner is smaller but Vitest offers mature TypeScript/ESM fake timers, fixtures, and coverage. Jest adds heavier ESM transformation setup.
