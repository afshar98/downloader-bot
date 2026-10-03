# Application Port Contracts

These conceptual strict-TypeScript contracts define dependency direction. Exact syntax may be refined test-first, but semantics/ownership remain stable. No interface accepts grammY, yt-dlp, Undici, child-process, or raw environment types.

**Updated**: 2026-10-03. Existing capabilities are retained; planned sound-aware fields, signatures,
ownership, and failure behavior are frozen in [sound-aware-media.md](./sound-aware-media.md).

## Primary use case

```text
DownloadPostMedia.execute({
  destination: DeliveryDestination,
  messageText: string,
  candidateUrl: string,
  requestId: RequestId,
  signal: AbortSignal
}) -> Promise<RequestOutcome>
```

It orchestrates validation, admission, workspace, discovery, selection, per-item download/preparation/delivery, results, and cleanup. It returns typed safe outcomes and never sends Telegram copy itself.

## MediaProvider

```text
recognizes(candidate: URL) -> boolean
validate(candidate: string) -> PostReference | InvalidUrl | UnsupportedPostUrl
resolve(post: PostReference, context: OperationContext)
  -> Promise<readonly DiscoveredMedia[]>
```

- Recognition performs no network/process work; validation applies submitted-URL-only host/status
  validation and never follows submitted post redirects.
- Resolve returns provider-neutral validated supported items in source order and distinguishes
  `PostInaccessible`, `MediaNotFound`, `ProviderRateLimited`, `ProviderOutputInvalid`, and timeout.
  It receives only the canonical allowed post URL; yt-dlp egress is separate from `SafeHttpClient`
  controls, has no cookies/credentials/plugins/remote components, and is metadata-only.
- Compose one `XMediaProvider` directly; no registry/plugin lifecycle.
- Resolve carries conservative item audio state and four-state per-format audio evidence. Aggregate
  before direct/size filtering; GIF labels never override uncertainty or known sound.

## ProcessRunner

```text
run({
  executable: trusted configured path,
  stage: provider | processing,
  args: readonly string[],
  cwd?: controlled path,
  timeoutMs: number,
  stdoutLimitBytes: number,
  stderrLimitBytes: number,
  stdoutFile?: { path: generated partial path, maxBytes: number },
  signal: AbortSignal
}) -> Promise<ProcessResult>
closeResources() -> Promise<void>  // bounded drain for shutdown; no new process may start
```

Always direct-spawns with `shell: false`. It rejects output overflow, kills/awaits the child on timeout or cancellation, and returns bounded output plus exit metadata. Callers cannot supply shell command strings or uncontrolled environment/cwd.

Binary stdout can stream to an exclusive bounded file sink instead of UTF-8 capture. The first
over-limit byte stops the child and deletes the partial; result is not successful until the sink
closes. Retain yt-dlp `checkVersion`; FFmpeg has its own bounded `-version` verifier. Error stages
and ordinary failure codes follow the request, preserving typed timeout/cancellation reasons.
Completed nonzero provider exit results remain available for existing inaccessible/rate-limit
mapping. The runner does not replace every unsuccessful yt-dlp exit with `ProviderOutputInvalid`.

## RepresentationSelector

```text
select(media: DiscoveredMedia, limits: DeliveryLimits)
  -> readonly MediaRepresentation[]
```

Pure/deterministic; retains only progressive HTTPS MP4 candidates compatible with item audio state and orders known size
eligibility, direct-compatibility evidence, pixel area, bitrate, duration, then source index; absent
or invalid numeric values compare as zero and unknown size is stream-enforced. It returns a non-empty
best-first bounded fallback list or a typed size/compatibility error. Known sound requires confirmed
audio evidence on every selected fallback; unknown keeps existing video ranking; silent requires
confirmed silent AVC conversion input. Provider metadata remains advisory at the HTTP boundary.

## MediaDownloader

```text
download({
  representation: MediaRepresentation,
  media: DiscoveredMedia,
  workspace: TemporaryWorkspace,
  limits: DownloadLimits,
  signal: AbortSignal
}) -> Promise<DownloadedMedia>
```

Owns URL, DNS, connected-address, redirect, status/type, timeout, byte, stream, and partial-file enforcement. It uses `Accept-Encoding: identity`, rejects non-identity encoding, zero/invalid type bodies, missing or malformed redirect locations, loops, and unsafe revalidated hops; `Content-Length` is advisory and the first byte above the cap aborts/deletes the partial. It uses generated workspace paths and returns only a complete finalized file with stable error mapping.
Copies item audioPresence into downloaded provenance. It does not infer absence from the selected
representation or initiate conversion.

## MediaProcessor

```text
prepare(media: DownloadedMedia, context: OperationContext,
        workspace: TemporaryWorkspace, budget: ProcessingBudget)
  -> Promise<PreparedMedia>
```

The direct adapter validates video MP4 passthrough and returns the source upload artifact with
`transformed:false`. The planned GIF adapter delegates audio/uncertain video, converts only confirmed
silence using local generated paths, and returns a separate fully validated GIF with
`transformed:true`. All passes/validation/fallback share the supplied item budget. See the sound-aware
contract for validation, resource, and cleanup rules; no general transformation graph is introduced.

## MediaDelivery

```text
deliver(destination: DeliveryDestination,
        media: PreparedMedia,
        context: OperationContext)
  -> Promise<DeliveredReceipt>
```

Uploads to the exact originating destination, selects video/animation from prepared media, applies a finite deadline, and exposes no Telegram types/errors inward. It returns `DeliveryDestinationUnavailable` only for an authoritative permanent destination-level rejection (blocked bot, removed bot, missing/inaccessible destination, missing send permission, or an explicitly permanent equivalent). Individual upload failures, transient network/server failures, timeouts, rate limits, media-specific rejections, and unknown errors remain `TelegramDeliveryFailed` or their existing typed error.
Uploads `PreparedMedia.deliveryPath`, not necessarily the downloaded source. Valid GIF artifacts
use `sendAnimation`; audio-bearing/uncertain MP4 artifacts use `sendVideo`.

## TemporaryWorkspaceFactory

```text
create(requestId: RequestId) -> Promise<TemporaryWorkspace>
cleanup(workspace: TemporaryWorkspace) -> Promise<void>
```

Creates a unique directory under a startup-validated writable non-symlink parent and generates only
exclusive, application-owned paths below it. `.part` and final files remain on the same filesystem;
rename failure is an item failure. Cleanup is idempotent, recursive, and always called from use-case
`finally`; a cleanup failure emits `CleanupFailed` safe structured context without replacing the
primary outcome.

Workspace exposes generated palette/GIF partial/final paths, safe finalization, `removeConversion`,
and idempotent `removeItem`. Orchestration retires all attempt files before fallback/next item and
does not acquire more if a bounded cleanup retry cannot clear them. Request-finally cleanup remains
the final safety net. No other owner derives output paths from provider filenames.
Exhausted final cleanup or unconfirmed child closure invokes the internal fatal-resource callback
defined in the sound-aware contract, synchronously stopping service acquisition before permit reuse
and initiating existing bounded shutdown. Ordinary failures retain unrelated-job isolation.

## AdmissionControl

```text
acquire({ requestId, deadline, signal }) -> Promise<Permit>
Permit.release() -> void
```

Active/queued counts are finite. Full queue/wait expiry maps to `ServiceBusy`; release is idempotent and required in `finally`.

## SafeHttpClient / outbound policy

The infrastructure client accepts only a URL, adapter-selected safe headers, signal, byte cap, timeouts, and redirect cap. Per hop it:

1. validates scheme, credentials, port, length, and IP literals;
2. resolves all A/AAAA records and rejects the host if any are non-global;
3. connects through lookup/connector bound to a validated address;
4. disables automatic redirects, resolves relative `Location`, and repeats full validation;
5. rejects malformed/missing location, loop, downgrade, credentials/port change, or new non-global
   destination; caps redirects and destroys prior response bodies;
6. exposes only successful bounded responses.

## Logger, errors, and cancellation

The small structured logger permits correlation ID, provider, stage, item position, duration, stable code, and bounded non-sensitive metrics; callers do not pass raw external objects.

Every async port accepts caller cancellation. Job and stage deadlines compose; the earliest wins. `OperationTimedOut` represents a deadline expiry; `OperationCancelled` represents caller/job/shutdown cancellation. Expected failures use discriminated `ApplicationError`; unknown faults are safely normalized at transport and never crash polling or reveal diagnostics.

Outcome codes and handling classes mirror the canonical taxonomy in `spec.md`. An isolated retrieval, preparation, or ordinary delivery error produces an item result and orchestration continues with the next supported item. Caller/job cancellation is request-wide: it aborts the in-progress operation safely, stops before every remaining item, preserves delivered items, cleans up owned resources, and releases admission in `finally`. `DeliveryDestinationUnavailable` is logged-only and request-wide after authoritative adapter classification; it stops later deliveries and suppresses a final Telegram summary. Remaining positions are typed as unattempted for the terminal reason. A safe partial summary is requested only when at least one item was delivered and the destination remains usable.
