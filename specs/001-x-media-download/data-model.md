# Data Model: X/Twitter Media Download

The feature is stateless. These are in-memory domain/application values and request-scoped resources, not database entities. Raw Telegram, yt-dlp, Undici, and process payloads are validated and mapped before entering this model.

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
| `kind` | `video \| animation` | Static/unsupported media excluded |
| `representations` | non-empty list | Validated candidates before application ranking |

Mixed posts omit unsupported items while retaining deterministic supported-media order.

## MediaRepresentation

| Field | Type | Rules |
|---|---|---|
| `representationId` | string | Provider-generated; not a filename |
| `url` | URL value | Untrusted until downloader policy |
| `container` | `mp4` | Other containers not selected in MVP |
| `protocol` | `https` | HLS/manifests not selected |
| `videoCodec` / `audioCodec` | optional string/null | Advisory validated metadata |
| `width` / `height` | optional positive integer | Quality ranking |
| `bitrate` | optional positive number | Quality ranking |
| `sizeBytes` | optional non-negative integer | Advisory; streamed cap authoritative |
| `durationSeconds` | optional non-negative number | Advisory delivery metadata |

Selection removes non-progressive HTTPS MP4 and known oversize candidates, prefers compatible higher quality within limits, and returns a bounded fallback list. Unknown size is permitted but byte-counted.

## DownloadedMedia and PreparedMedia

`DownloadedMedia` contains copied item identity/kind, a controlled absolute path inside the owning workspace, actual positive bytes at/below the cap, and `mp4`. A `.part` is never a downloaded value; completion and controlled rename come first.

`PreparedMedia` contains the downloaded value, `deliveryKind: video | animation`, and `transformed`. The direct MVP processor always sets `transformed: false`. No generic transformation graph is modeled.

## ItemResult and RequestOutcome

```text
ItemResult =
  Delivered { position, mediaId }
  Failed    { position, mediaId, errorCode, retryable }

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

Only generated basenames such as `item-0001.part` and `item-0001.mp4` are used. Partials are unlinked on item failure. The directory is removed in request `finally`; cleanup failure is logged without changing the primary outcome.

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
                 -> Delivering(i)
                 -> ItemTerminal(i) -> next item
            -> Complete | Partial | Failed
       -> Cleaning
  -> Closed
```

`Cleaning` is reached from every post-workspace path through `finally`. `Closed` is terminal. State is request-local; no persistent/global request registry exists.
