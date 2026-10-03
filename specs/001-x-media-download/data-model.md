# Data Model: X/Twitter Media Download

The feature is stateless. These are in-memory domain/application values and request-scoped resources, not database entities. Raw Telegram, yt-dlp, Undici, and process payloads are validated and mapped before entering this model.

**Updated**: 2026-10-03. Sound-aware additions are planned, not yet implemented.
The exact shared contract and audio truth table are in [sound-aware-media.md](./contracts/sound-aware-media.md).

## DownloadRequest

| Field | Type | Rules |
|---|---|---|
| `requestId` | opaque string | Service-generated, collision-safe, log-safe |
| `destination` | opaque `DeliveryDestination` | Created by Telegram adapter; never mixed across requests |
| `messageText` | string | Untrusted and transport-size-bounded; used only to extract one URL |
| `candidateUrl` | URL value | Exactly one unambiguous candidate before provider validation |
| `deadline` | injected deadline/signal | Finite; covers admission and full job |
| `limits` | `RequestLimits` | Immutable startup-validated policy |
| `state` | `RequestState` | Monotonic transition below |

No candidate, malformed sole candidate, multiple candidates, or over-limit input produces
`InvalidUrl`; a syntactically valid URL outside the supported host/status allowlist produces
`UnsupportedPostUrl`.
Raw payloads are not persisted/logged.

## PostReference

| Field | Type | Rules |
|---|---|---|
| `provider` | `'x'` | Only provider in this feature |
| `postId` | numeric string | 1–20 ASCII digits, first digit 1–9, from exact accepted status path |
| `canonicalUrl` | URL value | HTTPS, allowed exact host, default port, no credentials, harmless query/fragment removed |

Recognition/validation remain provider responsibilities. Application code treats this as opaque and does not know X variants.

## DiscoveredMedia

| Field | Type | Rules |
|---|---|---|
| `mediaId` | opaque string | Unique within result; never a path |
| `position` | positive integer | One-based source order; stable for feedback |
| `kind` | `video \| animation` | Animation only for confirmed absence of audio; labels do not override |
| `audioPresence` | `present \| absent \| unknown` | Required conservative item state, aggregated before direct/size filtering |
| `representations` | non-empty list | Validated candidates before application ranking |

Mixed posts omit unsupported items while retaining deterministic supported-media order.

## MediaRepresentation

| Field | Type | Rules |
|---|---|---|
| `representationId` | string | Provider-generated; not a filename |
| `url` | URL value | Untrusted until downloader policy |
| `container` | validated string | Only progressive MP4 is selected; unsupported formats may still establish audio evidence |
| `protocol` | validated string | Only HTTPS direct sources selected; HLS video evidence is retained for classification |
| `videoCodec` / `audioCodec` | optional string/null | Advisory validated metadata |
| `audioEvidence` | `present \| absent \| unknown \| conflicting` | Normalized separate audio codec/container fields; conflicts are not lost |
| `width` / `height` | optional positive integer | Quality ranking |
| `bitrate` | optional positive number | Quality ranking |
| `sizeBytes` | optional non-negative integer | Advisory; streamed cap authoritative |
| `durationSeconds` | optional non-negative number | Advisory delivery metadata |

Classify the item before filtering. Selection removes non-progressive HTTPS MP4, audio-ineligible,
and known oversized candidates, preserves sound, and returns the existing bounded quality-ordered
fallback list. Unknown size is permitted but byte-counted. A mixed sound/silent item is audio-bearing;
any internally conflicting format makes the item unknown; only unanimous explicit absence confirms silence.

## DownloadedMedia and PreparedMedia

`DownloadedMedia` contains copied item identity/kind/audioPresence, a controlled absolute path inside
the owning workspace, actual positive bytes at/below the cap, and `mp4`. A `.part` is never a
downloaded value; completion and controlled rename come first. Item audio state is not replaced
with the selected format's state after download.

`PreparedMedia` retains downloaded provenance and adds `deliveryPath`, `deliverySizeBytes`, and
`deliveryContainer`. Its discriminated valid combinations are `video/mp4/transformed:false` for
audio-bearing/unknown items and `animation/gif/transformed:true` for converted confirmed silence.
Video upload path equals the source path; GIF upload path is a distinct validated owned artifact.
There is no deliverable MP4-animation shortcut or generic transformation graph.

`ProcessingBudget` has one composed abort signal, `remainingMs()` using the context's injected
monotonic clock, and a monotonic deadline bounded by the original
job deadline. It is allocated after the first successful item download and reused for every pass,
full output validation, and any fallback. Subsequent fallback downloads cannot outlive it.

## ItemResult and RequestOutcome

```text
ItemResult =
  Delivered { position, mediaId }
  Failed    { position, mediaId, errorCode, retryable }
  Unattempted { position, reason: OperationTimedOut | OperationCancelled | DeliveryDestinationUnavailable }

RequestOutcome =
  Complete { ordered item results }
  Partial  { ordered item results, delivered count, failed positions }
  Failed   { safe error code, ordered item results? } // includes OperationTimedOut, OperationCancelled, DeliveryDestinationUnavailable
  Rejected { InvalidUrl | UnsupportedPostUrl | ServiceBusy }
```

Each item has one terminal result. Ordinary item failure does not stop later items. Caller/job/shutdown cancellation and deadline expiry stop the whole job; cancellation safely aborts in-progress work, cleanup and permit release occur in `finally`, and later positions become unattempted. `DeliveryDestinationUnavailable` stops later deliveries only after the adapter classifies an authoritative permanent destination-level rejection; item-local, transient, rate-limited, timeout, media-specific, and unknown Telegram errors do not do so. User outcomes never contain causes, URLs, paths, process output, or stacks.

## TemporaryWorkspace

| Field | Type | Rules |
|---|---|---|
| `root` | controlled absolute path | `mkdtemp` beneath validated trusted parent |
| `requestId` | opaque string | Ownership only; not user-derived path input |
| `resources` | generated paths/handles | Internal and never exposed |
| `state` | `open \| cleaning \| closed` | Cleanup idempotent |

Only generated basenames are used: source `.part`/`.mp4`, palette `.palette.part`/`.palette.png`, and
GIF `.gif.part`/`.gif`. Workspace methods own finalization, conversion removal, and complete item
retirement. Source/GIF each have the media byte cap; palette has a 16 KiB cap. Remove all attempt
artifacts after settled delivery/failure and before fallback/next item. The directory is removed
in request `finally`; cleanup failure is logged without replacing the primary outcome. Failed
bounded retirement prevents further acquisition rather than accumulating artifacts.

## ProcessExecution

The shared process request retains executable/argument array, cwd, timeout, diagnostic byte caps,
and signal, with required `stage: provider | processing`. Optional `stdoutFile` is a generated
partial path and hard binary byte cap; absent it, stdout is bounded captured UTF-8 as before.
The result carries bounded captured stdout/stderr, exit metadata, and streamed `outputBytes` when
a file sink is used. Processing spawn/pipe failures use `MediaProcessingFailed`; binary media
overflow uses `MediaTooLarge`; typed timeout/cancellation codes survive stage mapping.

## ApplicationError

```text
code:
  InvalidUrl | UnsupportedPostUrl | PostInaccessible | MediaNotFound |
  ProviderRateLimited | ProviderOutputInvalid | CleanupFailed |
  MediaDownloadFailed | MediaTooLarge | MediaProcessingFailed |
  TelegramDeliveryFailed | DeliveryDestinationUnavailable | OperationTimedOut |
  OperationCancelled | ServiceBusy
stage:
  input | admission | provider | download | processing | delivery | cleanup
retryable: boolean
operatorContext?: bounded structured fields
cause?: unknown (operator side only)
```

`CleanupFailed` is a secondary logged-only lifecycle event, not a replacement request or item outcome.

User copy is selected by code at the Telegram boundary. Third-party/error message strings never become copy or control flow.

## State Transitions

```text
Received
  -> Rejected
  -> Admitted
       -> Discovering
            -> Failed
            -> ProcessingItems
                 -> Downloading(i)
                 -> Preparing(i)
                      -> VideoPassthrough | Palette -> GIFEncoding -> StructureAndDecodeValidation
                 -> Delivering(i)
                 -> ItemTerminal(i) -> next item
            -> Complete | Partial | Failed
       -> Cleaning
  -> Closed
```

`Cleaning` is reached from every post-workspace path through `finally`. `Closed` is terminal. State is request-local; no persistent/global request registry exists.
