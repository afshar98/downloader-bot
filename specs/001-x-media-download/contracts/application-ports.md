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
validate(candidate: URL) -> PostReference | InvalidUrl
resolve(post: PostReference, context: OperationContext)
  -> Promise<readonly DiscoveredMedia[]>
```

- Recognition performs no network/process work; validation checks the entire provider URL.
- Resolve returns provider-neutral validated supported items in source order and distinguishes `PostInaccessible`, `MediaNotFound`, and timeout.
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

Pure/deterministic; returns a non-empty best-first bounded fallback list or a typed size/compatibility error. Provider metadata is advisory.

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

Owns URL, DNS, connected-address, redirect, status/type, timeout, byte, stream, and partial-file enforcement. It uses generated workspace paths and returns only a complete finalized file with stable error mapping.

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

Uploads to the exact originating destination, selects video/animation from prepared media, applies a finite deadline, and exposes no Telegram types/errors inward.

## TemporaryWorkspaceFactory

```text
create(requestId: RequestId) -> Promise<TemporaryWorkspace>
cleanup(workspace: TemporaryWorkspace) -> Promise<void>
```

Creates a unique directory under the trusted parent and generates all item paths. Cleanup is idempotent, recursive, and always called from use-case `finally`.

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
4. disables automatic redirects and repeats validation for `Location`;
5. caps redirects and destroys prior response bodies;
6. exposes only successful bounded responses.

## Logger, errors, and cancellation

The small structured logger permits correlation ID, provider, stage, item position, duration, stable code, and bounded non-sensitive metrics; callers do not pass raw external objects.

Every async port accepts caller cancellation. Job and stage deadlines compose; the earliest wins. Timeout remains distinguishable from network/process/delivery failure. Expected failures use discriminated `ApplicationError`; unknown faults are safely normalized at transport and never crash polling or reveal diagnostics.
