# Feature Specification: X/Twitter Media Download

**Feature Branch**: Not created (no branch hook configured)

**Created**: 2026-09-28

**Status**: Draft

**Input**: User description: "Users submit an X/Twitter post URL through Telegram and receive
supported video or animated media, with clear feedback and safe failure handling."

## Clarifications

### Session 2026-09-28

- Q: If a job deadline or cancellation occurs after some media items are delivered but before all remaining items are attempted, what should the bot do? → A: Stop remaining work at the deadline or cancellation, preserve successful deliveries, and send a partial-result summary identifying unattempted items as timed out or cancelled.
- Q: Which URL forms should the bot accept as supported X/Twitter post URLs? → A: Only HTTPS `x.com` or `twitter.com` status URLs with an optional `www` prefix; query parameters and fragments are ignored, while mobile hosts, short links, HTTP, credentials, and non-default ports are rejected.
- Q: For the MVP, must the bot support transforming media that is not already Telegram-deliverable, or may it fail safely when no directly deliverable representation exists? → A: The MVP supports directly deliverable media only; if no compatible representation exists, it returns a clear processing or delivery failure.
- Q: What maximum media size should the MVP allow for each Telegram upload? → A: Use a default 49 MiB application limit, configurable downward but never above the supported Telegram cloud upload ceiling.
- Q: How should the MVP handle duplicate Telegram updates or a user resubmitting the same X/Twitter URL? → A: Process each received request independently with no deduplication state; duplicate deliveries are acceptable in this stateless MVP.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Receive Video from a Valid Post (Priority: P1)

A user sends one valid, publicly accessible X/Twitter post URL containing a supported video and
receives a deliverable version of that video in the same Telegram chat.

**Why this priority**: Returning requested media is the feature's primary user value and defines the
minimum viable end-to-end workflow.

**Independent Test**: Submit a valid post URL with one supported video and verify that the same chat
receives the selected video without requiring further user action.

**Acceptance Scenarios**:

1. **Given** a publicly accessible X/Twitter post with a supported video, **When** the user sends its
   URL, **Then** the bot delivers the best-quality representation that can be sent successfully.
2. **Given** a supported video that is already suitable for delivery, **When** the user submits its
   post URL, **Then** the bot delivers it without unnecessary media transformation.
3. **Given** a supported video with no directly deliverable representation, **When** the user
   submits its post URL, **Then** the bot returns a clear processing or delivery failure without
   claiming successful delivery.
4. **Given** a post containing multiple supported media items, **When** the user submits its URL,
   **Then** the bot attempts to deliver every supported item to the originating chat.

---

### User Story 2 - Receive Animated Media (Priority: P2)

A user sends a valid, publicly accessible X/Twitter post URL containing GIF or animated media and
receives a playable result in the same Telegram chat.

**Why this priority**: Animated media is explicitly included in the initial feature but is secondary
to the primary video workflow.

**Independent Test**: Submit a valid post URL with supported animated media and verify that the same
chat receives a playable representation.

**Acceptance Scenarios**:

1. **Given** a publicly accessible X/Twitter post with supported animated media, **When** the user
   sends its URL, **Then** the bot delivers a playable representation to the same chat.
2. **Given** animated media with no directly deliverable representation, **When** the user submits
   its post URL, **Then** the bot returns a clear processing or delivery failure.

---

### User Story 3 - Understand Invalid or Unsupported Input (Priority: P3)

A user who submits malformed input, an unsupported domain, or a non-post X/Twitter URL receives
clear feedback explaining that the request cannot be processed.

**Why this priority**: Immediate, specific validation feedback prevents confusion and avoids
attempting media retrieval for input outside the feature's scope.

**Independent Test**: Submit representative malformed URLs, unsupported domains, and unsupported
X/Twitter URL forms and verify that each receives clear feedback without initiating media retrieval.

**Acceptance Scenarios**:

1. **Given** a message without a well-formed URL, **When** it is submitted, **Then** the user is told
   that a valid URL is required.
2. **Given** a syntactically valid URL outside the supported host/status allowlist, **When** it is
   submitted, **Then** the user receives the `UnsupportedPostUrl` safe outcome.
3. **Given** a message with multiple HTTP(S)-style URL tokens, including a malformed or unsupported
   token, **When** it is submitted, **Then** it is rejected as multiple-input `InvalidUrl` before parsing.

---

### User Story 4 - Receive Actionable Failure Feedback (Priority: P4)

A user receives a safe, clear outcome when the referenced post or media cannot be accessed,
retrieved, processed, or delivered.

**Why this priority**: External services and media operations can fail; predictable feedback makes
the bot trustworthy and keeps failures from affecting other users.

**Independent Test**: Simulate each defined failure category and verify that the user receives the
corresponding safe message, temporary resources are released, and a subsequent valid request can
complete.

**Acceptance Scenarios**:

1. **Given** a deleted, private, restricted, or otherwise inaccessible post, **When** its URL is
   submitted, **Then** the user is told that the post cannot be accessed.
2. **Given** an accessible post with no supported video or animated media, **When** its URL is
   submitted, **Then** the user is told that no supported media was found.
3. **Given** supported media whose retrieval fails, **When** the request is processed, **Then** the
   user is told that the item retrieval failed and later supported items continue to be attempted.
4. **Given** a supported media item cannot be prepared for direct delivery, **When** the request is
   processed, **Then** the user is told that the item processing failed and later supported items
   continue to be attempted.
5. **Given** a prepared file that cannot be delivered, **When** delivery is attempted, **Then** the
   user is told that the item delivery failed and later supported items continue to be attempted
   unless the adapter returns `DeliveryDestinationUnavailable` for an authoritative permanent
   destination-level rejection.
6. **Given** any failed request, **When** another valid request is submitted afterward, **Then** the
   later request can complete normally.
7. **Given** a request-wide deadline, cancellation, or globally unusable delivery destination occurs
   after one or more items were delivered, **When** the request stops, **Then** delivered items remain
   delivered, later items are not attempted, and the bot sends a safe partial-result summary when
   delivery remains possible. A cancellation safely stops an in-progress operation, cleans up owned
   resources, and releases admission in `finally`; a destination-unavailable outcome sends no final
   Telegram summary.
8. **Given** a deadline or cancellation stops a request before any item is delivered, **When** the
   outcome is reported, **Then** the user receives a safe timeout or cancellation outcome rather than
   a partial-success claim.

### Edge Cases

- A message contains surrounding text as well as exactly one supported post URL.
- A message contains no URL, more than one URL, or a URL split or obscured by malformed text.
- The submitted URL uses an optional `www` X/Twitter hostname prefix, optional query parameters,
  or a fragment.
- The submitted URL uses misleading hostname text, embedded credentials, an unexpected port, or a
  redirect toward a non-approved destination.
- The post redirects, is deleted, private, age-restricted, region-restricted, temporarily
  unavailable, or rate-limited.
- The post exists but contains only text, static images, or another unsupported media type.
- The post contains both supported and unsupported media.
- The post contains more than one supported media item.
- The available representations vary in quality, size, format, or deliverability.
- The preferred representation exceeds the delivery service's current file-size or duration limits.
- No directly deliverable representation exists for a supported item.
- Retrieval or delivery times out or is cancelled partway through.
- A job deadline or cancellation occurs after some supported items are delivered but before later
- Telegram reports a permanent destination-level rejection, such as bot blocked, removed, missing or
  inaccessible chat, or missing send permission; this stops later delivery attempts. An individual
  upload failure, transient network/server error, timeout, rate limit, media-specific rejection, or
  unknown Telegram error does not by itself make the destination globally unusable.
  items are attempted.
- Media metadata or filenames contain unexpected, missing, extremely long, or unsafe values.
- Two users submit requests concurrently, including requests for the same post.
- The bot receives a duplicate update or the user resubmits the same URL.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST accept a Telegram message containing exactly one candidate URL and
  associate the request with the originating chat.
- **FR-002**: The system MUST recognize supported X/Twitter post URL forms and validate only the
  candidate URL submitted by the Telegram user, including its hostname, scheme, port, and path. The
  submitted post URL MUST NOT be followed through arbitrary redirects during input validation.
  Representation-download redirects are separate and MUST follow the Safe HTTP Downloader policy.
  The complete accepted hostname set is `x.com`, `www.x.com`, `twitter.com`, and
  `www.twitter.com`, using HTTPS status URLs with a numeric post identifier. Hostname comparison is
  case-insensitive. Query parameters and fragments MAY be accepted but MUST be removed from the
  canonical post reference and ignored after validation. `mobile.twitter.com`, `t.co`, HTTP URLs,
  embedded credentials, non-default ports, lookalike hosts, and every other hostname MUST be
  rejected.
- **FR-003**: The system MUST classify no candidate, a malformed sole candidate, or multiple
  candidate tokens as `InvalidUrl`; a syntactically valid URL outside the supported X/Twitter host
  and status-path allowlist MUST be `UnsupportedPostUrl`. Each MUST receive clear safe feedback.
- **FR-004**: The system MUST treat submitted URLs, redirects, post data, media metadata, filenames,
  and provider responses as untrusted and MUST reject unsafe or disallowed destinations.
- **FR-005**: The system MUST attempt to access the referenced post and MUST distinguish an
  inaccessible post from an accessible post containing no supported media.
- **FR-006**: The system MUST detect supported X/Twitter video and GIF or animated media and MUST
  exclude static images and all other media types from this feature.
- **FR-007**: If a post contains both supported and unsupported media, the system MUST process the
  supported media and ignore unsupported media.
- **FR-008**: For a supported media item, the system MUST select the highest-quality available
  representation that is compatible with successful delivery; a lower-quality representation MAY
  be selected when necessary to satisfy delivery constraints.
- **FR-009**: The system MUST retrieve selected media without requiring the user to interact with
  X/Twitter directly.
- **FR-010**: When a post contains multiple supported media items, the system MUST select, retrieve,
  and attempt to deliver every supported item independently to the originating chat. Failure of one
  item MUST NOT prevent delivery attempts for the remaining supported items, and the user MUST
  receive clear feedback identifying any items that could not be delivered. This obligation is
  bounded by request-wide termination: a job deadline, caller/job cancellation, or
  `DeliveryDestinationUnavailable` MUST stop remaining work. Cancellation MUST safely stop the
  in-progress operation, release owned resources and admission in `finally`, preserve delivered
  items, and prevent every remaining item from being attempted. `DeliveryDestinationUnavailable`
  occurs only when the Telegram adapter classifies an authoritative permanent destination-level
  rejection (blocked bot, removed bot, missing/inaccessible destination, missing send permission, or
  another explicitly permanent destination rejection); ordinary item upload failure, transient
  network/server error, timeout, rate limit, media-specific rejection, and unknown error remain
  item-local. Remaining items MUST be classified as unattempted for the applicable terminal reason.
  A partial-result summary is required after timeout/cancellation when the destination remains
  usable; no final Telegram summary is attempted after `DeliveryDestinationUnavailable`.
- **FR-011**: The MVP MUST deliver a supported media item directly when a compatible representation
  is available. If no directly deliverable representation exists within the applicable constraints,
  the system MUST return a clear processing or delivery failure; media transformation is outside the
  MVP scope and MAY be added later without changing the user-facing X/Twitter workflow.
- **FR-012**: The system MUST send each successful result to the same Telegram chat from which the
  request originated.
- **FR-013**: The system MUST use the canonical outcome taxonomy below. User-sendable outcomes MUST
  use the listed safe meaning; item-level outcomes MUST remain attached to the affected item;
  request-wide outcomes MUST stop remaining work and classify unattempted items accordingly.
  `DeliveryDestinationUnavailable` and secondary `CleanupFailed` are logged-only outcomes; the
  former MUST suppress a final Telegram send to that destination.
- **FR-014**: User-facing failures MUST NOT disclose secrets, unsafe input details, internal
  diagnostics, or sensitive service information.
- **FR-015**: Retrieval, processing, and delivery MUST have explicit finite time and resource bounds.
  Each media item MUST be limited to a default maximum of 49 MiB for Telegram upload; this limit
  MAY be configured downward but MUST NOT be configured above the supported Telegram cloud upload
  ceiling. A per-item stage or resource bound being reached MUST terminate that item safely and MUST
  NOT prevent later items unless it is classified as a request-wide terminal condition. The job
  deadline maps to `OperationTimedOut`; explicit caller/job/shutdown cancellation maps to
  `OperationCancelled`. Cancellation is never item-level in this MVP: it safely stops in-progress
  work, cleans up resources, and releases admission in `finally` before producing the appropriate
  safe partial or zero-delivery outcome.
- **FR-016**: Media MUST NOT be retained longer than needed to complete the request. All temporary
  media and acquired resources MUST be released after success, failure, cancellation, or timeout.
- **FR-017**: A failed, cancelled, or timed-out request MUST NOT crash the bot, prevent unrelated
  requests from progressing, or cause one user's result to be delivered to another chat.
- **FR-018**: Concurrent requests MUST remain isolated by request and originating chat.
- **FR-019**: The initial feature MUST support only X/Twitter videos and GIF or animated media and
  MUST NOT claim support for Instagram, TikTok, YouTube, Facebook, Reddit, or other platforms.
- **FR-020**: The feature's behavior MUST permit other social-media platforms to be introduced later
  without changing the user-facing X/Twitter workflow defined here.
- **FR-021**: The MVP MUST process duplicate Telegram updates and user resubmissions independently
  without persistent or in-memory deduplication state; duplicate deliveries are acceptable.

### Deterministic MVP Policy

**Input and post identity.** Extract candidate HTTP(S)-style URL tokens using the preceding tokenization rules. If there are zero, return `InvalidUrl`; if there are two or more, return `InvalidUrl` for multiple input BEFORE parsing any candidate. Parse only the sole candidate. A malformed sole token is `InvalidUrl`; a syntactically valid sole URL that does not match the allowlisted host and exact status-path grammar is `UnsupportedPostUrl`. Only a valid supported post proceeds to discovery. Surrounding prose and terminal punctuation handling remain as already defined above; no URL is recovered by decoding, joining, whitespace removal, or linkification. Input is limited to 4,096 UTF-16 code units and a candidate to 2,048 ASCII characters. The supported raw pathname is exactly `/[A-Za-z0-9_]{1,15}/status/[1-9][0-9]{0,19}` with no trailing slash, extra segment, percent escape, Unicode character, or alternate spelling. Query and fragment are excluded from canonical identity.

**Canonical outcome taxonomy.** The outcome code has one stable meaning and handling class:

| Code | Class | Safe meaning / terminal handling |
|---|---|---|
| `InvalidUrl` | User-sendable rejection | No candidate, malformed sole candidate, multiple candidates, or input limit exceeded; ask for exactly one URL. |
| `UnsupportedPostUrl` | User-sendable rejection | Well-formed URL outside the supported HTTPS X/Twitter host/status allowlist; ask for one supported status URL. |
| `PostInaccessible` | User-sendable request outcome | The post cannot be accessed; check availability or retry later. |
| `MediaNotFound` | User-sendable request outcome | No supported video or animated media was found. |
| `ProviderRateLimited` | User-sendable request outcome | The provider temporarily limited access; retry later. |
| `ProviderOutputInvalid` | User-sendable request outcome | Media details could not be read safely; retry later. Never expose provider output. |
| `MediaDownloadFailed` | Item-level outcome | This item could not be retrieved; later items continue; retry may help. |
| `MediaTooLarge` | Item-level outcome | This item exceeds the configured media limit. |
| `MediaProcessingFailed` | Item-level outcome | This item has no supported direct-delivery representation or could not be prepared. |
| `TelegramDeliveryFailed` | Item-level outcome | This item could not be sent; later items continue unless a request-wide terminal outcome occurs. |
| `OperationTimedOut` | Request-wide terminal | Stop remaining work; preserve successes; send timeout copy or partial summary only if delivery remains usable. |
| `OperationCancelled` | Request-wide terminal | Stop remaining work; preserve successes; send cancellation copy or partial summary only if delivery remains usable. |
| `ServiceBusy` | User-sendable rejection | Capacity is unavailable; retry shortly. |
| `DeliveryDestinationUnavailable` | Logged-only request-wide terminal | Stop delivery, preserve successes, classify remaining items unattempted, and do not send a final summary. |
| `CleanupFailed` | Logged-only secondary outcome | Record safe structured operator context; never replace the primary outcome or expose paths to users. |

**Direct delivery.** “Directly deliverable” means an unmodified, progressive HTTPS MP4 representation whose validated metadata identifies video/animation kind, `mp4` container, direct Telegram send path, and bytes within `MAX_MEDIA_BYTES`; video is sent with `sendVideo`, animation with `sendAnimation`. No FFmpeg, transcoding, remuxing, GIF conversion, or duration repair occurs. A representation missing any required compatibility metadata is ineligible. This definition is used by FR-008, FR-011, and SC-001; a supported X item without one fails safely as `MediaProcessingFailed`/unsupported direct delivery.

**Ordering.** Eligible representations are ordered deterministically: known oversize makes a candidate ineligible; then direct-compatibility evidence; then known pixel area (unknown is zero); then known bitrate (unknown is zero); then known duration (unknown is zero); then stable provider source order. Unknown size remains eligible only with streamed enforcement. Missing/invalid numeric metadata is treated as unknown, never as a favorable value.

**Bounds and media response.** `MAX_MEDIA_BYTES=51380224` is exactly 49 MiB and applies to bytes written to both the `.part` and finalized file. The authoritative counter permits `<=` that value; the first byte that would exceed it aborts and deletes the partial. `Content-Length` is only an early rejection when declared above the cap. Missing or false length remains stream-counted; zero bytes, unexpected media content type, compressed content encoding, and midstream disconnect fail that item. Application-controlled requests require `Accept-Encoding: identity` and reject a non-identity content encoding.

**Provider and lifecycle outcomes.** yt-dlp JSON is untrusted and schema-validated before domain mapping. A deleted/private/restricted result is `PostInaccessible`; a valid accessible result with no supported video/animation is `MediaNotFound`; an extractor rate limit is `ProviderRateLimited`; deadline expiry is `OperationTimedOut`; malformed JSON, output overflow, an empty/null playlist, missing/duplicate item ID, invalid/extreme numeric field, or an unexpected shape is `ProviderOutputInvalid`. The conservative rule is that any invalid entry fails discovery rather than partially accepting a multi-entry result. Valid entries retain source order; provider filenames are never paths. `OperationCancelled` covers explicit caller/job/shutdown cancellation. Duplicate updates are explicitly accepted at-least-once behavior; no special duplicate warning is sent.

**Cleanup and shutdown.** Each admitted request owns an application-generated workspace under a validated non-symlink temp parent, exclusive generated files, and no cross-device finalization: `.part` and final paths are in the same workspace and rename failure fails the item. Unwritable parent, workspace creation, collision, exclusive-create, rename, or path-safety failure fails the request/item safely. `finally` attempts cleanup on every terminal path. A cleanup error is logged as a structured `CleanupFailed` event with correlation/stage/code but no path, and does not replace the primary user outcome; acceptance requires its observation and that no accessible finalized or partial file remains in the controlled test root after a retryable cleanup pass.

On SIGINT/SIGTERM the runner stops accepting updates, deterministically cancels queued jobs as `OperationCancelled`, signals active jobs, terminates owned children, closes HTTP resources, runs cleanup/release, and stops polling. It waits at most `SHUTDOWN_GRACE_MS=30000`; after that it force terminates. It sends no user message when the destination is unavailable or shutdown cannot safely deliver one. This is a request-wide terminal path, not an item cancellation.

### Key Entities *(include if feature involves data)*

- **Download Request**: A single user-initiated attempt, including the originating chat, submitted
  candidate URL, current outcome, and applicable processing bounds.
- **Post Reference**: A validated reference to one X/Twitter post, independent of Telegram message
  details.
- **Discovered Media**: A supported media item associated with a post, including media type and the
  available representations relevant to selection.
- **Media Representation**: One retrievable version of a media item, characterized by quality,
  format, size or duration when known, and delivery suitability.
- **Delivery Result**: The terminal outcome returned to the originating chat: delivered media or one
  defined safe failure category.
- **Temporary Resource**: Request-scoped media or external resource that exists only while the
  request is active and must be released at termination.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In acceptance testing, 100% of valid, accessible fixtures result in every supported
  item satisfying the Deterministic MVP Policy definition of directly deliverable (progressive HTTPS
  MP4, validated kind/container/direct-send metadata, streamed size at or below 51,380,224 bytes)
  being sent with its defined Telegram method to the originating chat; unsupported direct forms are
  counted only as their safe per-item failure, never as a required delivery.
- **SC-002**: In a controlled acceptance run of 100 valid requests, each fixture contains one to four
  directly deliverable media items no larger than 1 MiB, at most two requests execute concurrently,
  the admission queue is not saturated, and injected provider, download, and delivery doubles each
  complete or fail deterministically within 100 ms without live network access. Measure elapsed
  monotonic time from handler acceptance of the request until the final delivery attempt or terminal
  feedback completes. Using the nearest-rank method, the 95th-percentile elapsed time MUST be no more
  than two minutes. This verifies application-controlled latency separately from live X/Twitter and
  Telegram service latency.
- **SC-003**: In a controlled acceptance run of 100 invalid or unsupported messages covering no URL,
  multiple URLs, malformed URLs, unsupported hosts, and unsupported X/Twitter paths, at most two
  messages execute concurrently and the fake Telegram response completes deterministically within
  100 ms. No provider, HTTP, filesystem, or media operation may be called. Measure monotonic elapsed
  time from handler entry until category-specific response completion; using the nearest-rank method,
  the 95th-percentile elapsed time MUST be no more than five seconds. No live network is permitted.
- **SC-004**: Every defined failure category produces its specified safe user-facing outcome in
  acceptance tests, with no secret or internal diagnostic exposed.
- **SC-005**: A controlled acceptance run submits exactly 100 requests with default admission limits
  of two active and eight queued, using fake provider, HTTP, Telegram, clock, process, and filesystem
  dependencies and no live service/network. Exact categories are 40 one-item successes (at most 1
  MiB), 15 isolated item failures, 10 no-direct-representation failures, 10 size-boundary cases
  (five exactly `MAX_MEDIA_BYTES`, five one byte over), 10 duplicate/resubmission requests arranged
  as five original/duplicate pairs, five timeout partials, five cancellation partials, and five
  `ServiceBusy` rejections: 40+15+10+10+10+5+5+5=100. To produce busy results deterministically, hold two active
  requests behind a fake dependency gate, fill all eight queue slots with eight of the non-busy
  requests, submit exactly five additional requests and assert each is rejected `ServiceBusy`, then
  release the gate. Submit the remaining non-busy requests in batches that never exceed active plus
  queue capacity. Observe unique workspace roots/path ownership, each destination's delivery list,
  queue and permit counts, child/HTTP closure, and the controlled temp root. Pass only if deliveries
  stay within their originating chat, duplicate pairs are processed independently, failures do not
  stop later items, terminal partials preserve successes and start no remaining items, every permit
  is released, and no temporary files remain after cleanup (including the injected cleanup-failure
  retry pass).
- **SC-006**: A table-driven review and automated copy test MUST verify every defined terminal and
  partial-result message. Each message MUST state whether the request or item succeeded, failed, or
  was not attempted; each correctable-input outcome MUST instruct the user to submit one valid
  X/Twitter post URL; each retryable external or capacity outcome MUST advise retrying later; and
  non-retryable outcomes MUST NOT advise an ineffective retry. The review table MUST cover every
  error code and expose no secret or internal diagnostic.

## Constitution Compliance *(mandatory)*

- **Explicit boundaries**: Requirements distinguish Telegram interaction, provider discovery,
  downloading, processing, delivery, and request outcomes; future providers must preserve the
  existing user-facing workflow without requiring a speculative plugin framework.
- **Security and resource safety**: External data is untrusted, destinations are restricted,
  operations are bounded, temporary resources are released on every exit path, and user feedback
  excludes sensitive internals.
- **Strict validation**: URLs, provider results, configuration limits, and outcome categories have
  explicit validation rules before they become trusted request data.
- **Deterministic quality**: Acceptance criteria use controlled fixtures and test doubles rather than
  mandatory live Telegram or X/Twitter dependencies, and cover success, failure, cancellation,
  cleanup, isolation, and measurable timing.
- **Simplicity and maintainability**: The MVP is stateless, supports one platform, directly delivers
  compatible media without transformation, and excludes speculative persistence, caching, and
  provider frameworks.

No constitutional exception is requested by this specification. The technical plan must document
the concrete boundaries, dependency justifications, resource values, and verification gates before
implementation begins.

## Assumptions

- The initial feature serves ordinary Telegram users in direct chats or group chats where the bot
  can receive the message and send media.
- Each request contains exactly one candidate URL. Messages with multiple URLs are rejected rather
  than partially processed.
- Surrounding message text is allowed when exactly one unambiguous candidate URL is present.
- Initial access is limited to posts available without the user supplying X/Twitter credentials.
- Static images are outside this feature, even when attached to a post containing supported media.
- "Best appropriate media" means the highest-quality representation that can be delivered within
  the applicable delivery and resource constraints, not necessarily the source's absolute
  highest-quality representation.
- When no representation can be delivered within applicable limits, the request ends with delivery
  failure feedback; splitting files or publishing external download links is outside this feature.
- Exact safety policy, timeouts, and retry behavior will be decided and documented during planning.
  The MVP delivers directly compatible representations only; transformation is outside the MVP
  scope. The per-item upload limit defaults to 49 MiB and may only be lowered by configuration.
- Telegram and X/Twitter availability, rate limits, content restrictions, and delivery constraints
  are external dependencies that can affect an otherwise valid request.
- Persistent user accounts, download history, caching, analytics, administrative controls, and
  support for platforms other than X/Twitter are outside this feature.
