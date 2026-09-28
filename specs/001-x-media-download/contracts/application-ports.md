# Application Port Contracts

These conceptual strict-TypeScript contracts define dependency direction. Exact syntax may be refined test-first, but semantics/ownership remain stable. No interface accepts grammY, yt-dlp, Undici, child-process, or raw environment types.

## Primary use case

```text
DownloadPostMedia.execute({
  destination: DeliveryDestination,
  messageText: string,
  requestId: RequestId,
  signal: AbortSignal
}) -> Promise<RequestOutcome>
```

It orchestrates validation, admission, workspace, discovery, selection, per-item download/preparation/delivery, results, and cleanup. It returns typed safe outcomes and never sends Telegram copy itself.

## MediaProvider

```text
recognizes(candidate: URL) -> boolean
validate(candidate: URL) -> PostReference | InvalidUrl | UnsupportedPostUrl
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

## ProcessRunner

```text
run({
  executable: trusted configured path,
  args: readonly string[],
  cwd?: controlled path,
  timeoutMs: number,
  stdoutLimitBytes: number,
  stderrLimitBytes: number,
  signal: AbortSignal
}) -> Promise<ProcessResult>
```

Always direct-spawns with `shell: false`. It rejects output overflow, kills/awaits the child on timeout or cancellation, and returns bounded output plus exit metadata. Callers cannot supply shell command strings or uncontrolled environment/cwd.

## RepresentationSelector

```text
select(media: DiscoveredMedia, limits: DeliveryLimits)
  -> readonly MediaRepresentation[]
```

Pure/deterministic; retains only progressive HTTPS MP4 direct-send candidates and orders known size
eligibility, direct-compatibility evidence, pixel area, bitrate, duration, then source index; absent
or invalid numeric values compare as zero and unknown size is stream-enforced. It returns a non-empty
best-first bounded fallback list or a typed size/compatibility error. Provider metadata is advisory.

## MediaDownloader

```text
download({
  representation: MediaRepresentation,
  workspace: TemporaryWorkspace,
  position: number,
  limits: DownloadLimits,
  signal: AbortSignal
}) -> Promise<DownloadedMedia>
```

Owns URL, DNS, connected-address, redirect, status/type, timeout, byte, stream, and partial-file enforcement. It uses `Accept-Encoding: identity`, rejects non-identity encoding, zero/invalid type bodies, missing or malformed redirect locations, loops, and unsafe revalidated hops; `Content-Length` is advisory and the first byte above the cap aborts/deletes the partial. It uses generated workspace paths and returns only a complete finalized file with stable error mapping.

## MediaProcessor

```text
prepare(media: DownloadedMedia, context: OperationContext)
  -> Promise<PreparedMedia>
```

The initial adapter validates direct Telegram compatibility and returns the same owned file with `transformed: false`. A concrete FFmpeg adapter can replace it later only for demonstrated need.

## MediaDelivery

```text
deliver(destination: DeliveryDestination,
        media: PreparedMedia,
        context: OperationContext)
  -> Promise<DeliveredReceipt>
```

Uploads to the exact originating destination, selects video/animation from prepared media, applies a finite deadline, and exposes no Telegram types/errors inward. It returns `DeliveryDestinationUnavailable` only for an authoritative permanent destination-level rejection (blocked bot, removed bot, missing/inaccessible destination, missing send permission, or an explicitly permanent equivalent). Individual upload failures, transient network/server failures, timeouts, rate limits, media-specific rejections, and unknown errors remain `TelegramDeliveryFailed` or their existing typed error.

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
