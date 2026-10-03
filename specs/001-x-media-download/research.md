# Phase 0 Research: X/Twitter Media Download

**Research date**: 2026-09-28; sound-aware update 2026-10-03

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
The provider accepts only HTTPS status URLs on `x.com`, `www.x.com`, `twitter.com`, or `www.twitter.com`; it rejects `mobile.twitter.com`, `t.co`, HTTP, and every other host. Query and fragment data may be accepted after whole-URL validation but is removed from the canonical post reference.


**Rationale**: yt-dlp has an actively maintained Twitter extractor for public x.com/twitter.com posts, cards, and multi-entry results. Structured output includes formats, dimensions, codecs, protocols, and size estimates. It consolidates volatile guest-token/GraphQL/syndication behavior. `--dump-single-json --skip-download` separates discovery from the secured application downloader. A single entry or playlist `entries` maps to source-ordered provider-neutral values. Fixtures and a fake runner keep unit tests deterministic.

Hardened arguments include `--ignore-config`, `--no-plugin-dirs`, `--no-remote-components`, socket timeout, `--dump-single-json`, `--skip-download`, `--yes-playlist`, and `--use-extractors twitter`. Spawn an argument array with `shell: false`, cap output, apply a deadline, and validate JSON.

**Tradeoffs**: yt-dlp adds a Python/standalone deployment artifact and needs deliberate updates as X changes. Public posts normally need no user credentials, but deletion, privacy, age/region restrictions, and rate limits still fail safely. Check the version at startup, pin artifact/checksum, and forbid runtime self-update.

**Licensing/deployment**: Source/PyPI is Unlicense. The Unix zipimport artifact includes ISC/MIT components; PyInstaller standalone builds include GPLv3+ code. Select and pin deliberately and ship applicable notices; see [licensing](https://github.com/yt-dlp/yt-dlp/blob/master/README.md#licensing) and [third-party licenses](https://github.com/yt-dlp/yt-dlp/blob/master/THIRD_PARTY_LICENSES.txt).

**Operational ownership**: Dependency maintenance owns the deployed yt-dlp artifact and Telegram
Bot API compatibility assumption. Pin the approved version and provenance record; verify
checksum/signature where the distribution supplies one; disable self-update; and review on an
extractor regression, upstream security release, Bot API format/limit change, or planned upgrade.
The deployment ships the license notices applicable to the chosen artifact.

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

**Decision (superseded 2026-10-03)**: The earlier direct-MP4 animation path is replaced by bounded
silent-MP4-to-GIF conversion. Audio-bearing and uncertain media remain direct MP4/video. See section 11.

**Rationale**: The revised requirement explicitly requires a real uploaded GIF. Limit transformation
to confirmed silence; retain the earlier exclusion of HLS assembly, split streams, remuxing, repair,
and arbitrary transcoding. The constitution already permits controlled external media programs.

**Alternatives considered**: The earlier unchanged-MP4 animation upload does not satisfy real-GIF
delivery. HLS assembly, merging, repair, and general size/codec conversion remain excluded; only
the confirmed-silent conversion adapter in section 11 is approved by this feature's requirements.

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

**Rationale**: This isolates paths/users and preserves order. Retire complete item artifacts before
the next attempt/item. Conversion storage is bounded to active jobs times two media caps plus a
16 KiB palette per job, rather than retaining every item's source. A semaphore meets MVP needs
without Redis/BullMQ.

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

**Rationale**: These package scripts are now implemented. Retain them and deterministic TDD without
live services, network, clocks, randomness, or binaries in normal tests.

**Alternatives considered**: Node's runner is smaller but Vitest offers mature TypeScript/ESM fake timers, fixtures, and coverage. Jest adds heavier ESM transformation setup.

## 11. Sound-aware completion decisions

Current source inspection confirms the existing schema coalesces audio fields and labels a whole
item animation if any silent AVC format exists. The selector, processor, and Telegram upload path
then permit unchanged silent MP4 uploads. The new design below retains existing module boundaries
and resolves the dated design/implementation inputs against FR-022/FR-023.

### Audio state and candidate selection

**Decision**: Four-state per-format audio evidence, tri-state item audio presence, aggregation before
direct compatibility/size filtering, and GIF labels subordinate to audio state. Conflicts take
precedence over positive evidence; otherwise any positive evidence confirms sound, all explicit
absence confirms silence, and missing/ambiguous evidence means unknown. Retain conservative AVC
conversion inputs and existing unknown-video quality ranking. Freeze the complete table in
[sound-aware-media.md](./contracts/sound-aware-media.md).

**Rationale**: A missing field and a contradictory field need different aggregation behavior.
Audio available only in an undeliverable format must still prevent silent conversion. Classification
based on the winning representation or an oversize filter can discard known sound.

**Alternatives considered**: Boolean audio state, one silent-format test, label-driven animation,
and direct-format-only aggregation cannot meet conservative routing and sound preservation.

### Version pin and deployment dependency

**Decision**: Required `FFMPEG_PATH` and `FFMPEG_EXPECTED_VERSION`; verify with `-version`, parse the
first-line version token, and compare exactly before polling. Use the existing runner's `run` port
with 5-second lifetime and separate 16 KiB stdout/stderr caps; keep yt-dlp's `--version` behavior.
The deployment selects the approved token, immutable build, provenance/checksum, and applicable
license notices. No runtime auto-update, npm encoder, or ffprobe dependency.

**Rationale**: FFmpeg's version output is a banner and differs from yt-dlp; the existing hardcoded
probe cannot simply be reused. [FFmpeg CLI documentation](https://ffmpeg.org/ffmpeg.html) documents
`-version`. Exact token comparison checks approval; artifact verification establishes the build.

**Alternatives considered**: Whole-banner comparison is environment-sensitive; accepting any version
weakens the pin; a JS encoder duplicates a maintained media conversion tool.

### Local conversion profile and resource bounds

**Decision**: Two sequential FFmpeg passes: create one palette PNG, then apply it to the same local
MP4 to produce GIF. Both apply fixed 15 fps and aspect-preserving scale into at most 640 by 640
pixels without upscaling, plus square sample aspect ratio. Palette is at most 256 colors; application
uses deterministic Bayer dithering and looped GIF output. No `-t` or intentional clipping.
Use one decoder/encoder thread and one filter/complex-filter thread, a 16,777,216 source-pixel ceiling,
and a 64 MiB per-allocation guard; excessive input fails safely. These are fixed adapter constants,
not a new user-facing configuration surface. Use separate finite process/diagnostic/file limits.

**Rationale**: The dated whole-stream split/palettegen/paletteuse graph can buffer frames awaiting
the palette. Two passes avoid that unbounded full-clip buffering; this is a design inference based on
the [palettegen/paletteuse filters](https://ffmpeg.org/ffmpeg-filters.html#palettegen).
Constraining both output dimensions bounds portrait images too; width-only scaling does not.
The [codec options](https://ffmpeg.org/ffmpeg-codecs.html) describe thread and pixel limits.
`max_alloc` bounds one allocation, not total RSS; do not claim it is a hard process memory limit.
Deployment capacity must include decoded frames/filter buffers for every admitted conversion,
not just file bytes. No whole-video frame queue or in-memory media-file capture is allowed.

**Alternatives considered**: One-pass global palette can accumulate frames; per-frame palettes
change color consistency; extra processes/services or a generalized transcoding framework add
unneeded architecture. A deployment-wide memory limit does not replace per-operation bounds.

### File and network boundary

**Decision**: FFmpeg only receives application-generated local paths. Force MOV/MP4 input,
`enable_drefs=0`, `use_absolute_path=0`, and input protocol whitelist `file`; palette input is forced
PNG/image input. Encode palette/GIF output to `pipe:1` into the runner's bounded binary-file sink,
not directly to a provider-selected path. GIF validation forces GIF input and ignores stored looping.
Apply format/protocol restrictions to every input, not just the first.

**Rationale**: A [protocol whitelist](https://ffmpeg.org/ffmpeg-protocols.html) prevents network
protocols but is not a filesystem sandbox. Disable MOV external data references according to
[MOV demuxer options](https://ffmpeg.org/ffmpeg-formats.html#mov_002fmp4_002f3gp), use generated
paths in a private workspace, and retain deployment egress policy. Fixed filter expressions and
argument arrays prevent metadata-driven command or filter injection.

**Alternatives considered**: URL input bypasses SafeHttpClient's SSRF policy; file-only whitelist
without controlling references is incomplete; shell command strings violate the constitution.

### Hard output byte cap and completed GIF validity

**Decision**: Extend the existing runner narrowly with an optional binary stdout file sink.
Palette bytes cap at 16 KiB; GIF bytes cap at `MAX_MEDIA_BYTES`. Stream to an exclusively created
partial file, refuse the first over-limit byte, terminate/await FFmpeg, and unlink the partial.
Do not use `-fs` to truncate a conversion into an apparently successful shorter GIF.
Stat/lstat the completed partial, inspect complete GIF block boundaries through a bounded stream,
require a real trailer, at least one complete image, and bounded dimensions, then fully decode with
the pinned FFmpeg (`-xerror`, `-err_detect explode`, forced GIF, `-ignore_loop 1`, null muxer).
Reject any structural/decode error before controlled rename to the final GIF. The null-muxer
validation produces no media output file and cannot loop forever on animation metadata.

**Rationale**: [FFmpeg's `-fs` option](https://ffmpeg.org/ffmpeg.html) may overshoot and stops writing
early. A byte-counted sink makes the storage cap authoritative rather than advisory. Zero exit and
GIF signature do not prove completeness; the [GIF demuxer](https://ffmpeg.org/ffmpeg-formats.html#gif)
has loop behavior and its [source](https://ffmpeg.org/doxygen/trunk/libavformat_2gifdec_8c_source.html)
includes tolerant EOF handling. Structural traversal plus strict whole-file decoding covers both
truncation and invalid image payloads without implementing a new LZW decoder.

**Alternatives considered**: Post-exit size checks alone do not enforce the write cap; polling file
size permits overshoot; signature/trailer-only checks miss broken blocks or undecodable pixels;
ffprobe alone does not prove every frame decodes. A stdout sink reuses the existing process boundary.

### Shared budget, cleanup, and verification

**Decision**: One item processing budget covers palette, encoding, validation, and any fallback.
Stage/job/caller signals preserve existing typed request-wide timeout/cancellation. Retire source,
palette, and GIF files per attempt; recursive request cleanup remains the final safety net.
If a child/stream cannot close or prior artifacts cannot be removed after bounded retries, an
internal fatal-resource callback aborts the existing service controller and initiates bounded
shutdown before permit reuse. Keep successful deliveries and primary outcomes; ordinary item
failures and recovered cleanup retries do not stop unrelated jobs. Final cleanup exhaustion also
stops acquisition; operator remediation is required before restart with orphaned artifacts.

**Rationale**: Fresh per-pass deadlines can exceed the original job; existing fallback keeps finalized
MP4s until request cleanup and would otherwise accumulate GIFs. Shared budgets and generated paths
make later-item isolation and aggregate storage verifiable.

**Alternatives considered**: Separate stage timers for each pass, detached children, and best-effort
path reuse hide leaks or extend processing. A new scheduler is unnecessary.

**Verification**: Fake runners/filesystems/clocks establish routing, bounds, faults, and lifecycle.
A separate required controlled integration lane uses the approved FFmpeg binary and a synthetic
local MP4 to prove real GIF conversion and complete decoding; no live Telegram/X/network. Do not
silently skip the integration lane at feature completion. All Phase 0 unknowns are resolved here;
the exact approved executable version is deployment configuration, not a planning clarification.
