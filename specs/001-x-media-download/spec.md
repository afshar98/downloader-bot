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
2. **Given** a well-formed URL for an unsupported domain, **When** it is submitted, **Then** the user
   is told that the platform is unsupported.
3. **Given** an X/Twitter URL that does not identify a supported post, **When** it is submitted,
   **Then** the user is told that the URL is not a supported X/Twitter post URL.

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
   user is told that media retrieval failed and the request terminates safely.
4. **Given** a supported media item cannot be prepared for direct delivery, **When** the request is
   processed, **Then** the user is told that media processing failed and the request terminates
   safely.
5. **Given** a prepared file that cannot be delivered, **When** delivery is attempted, **Then** the
   user is told that delivery failed and the request terminates safely.
6. **Given** any failed request, **When** another valid request is submitted afterward, **Then** the
   later request can complete normally.

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
  items are attempted.
- Media metadata or filenames contain unexpected, missing, extremely long, or unsafe values.
- Two users submit requests concurrently, including requests for the same post.
- The bot receives a duplicate update or the user resubmits the same URL.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST accept a Telegram message containing exactly one candidate URL and
  associate the request with the originating chat.
- **FR-002**: The system MUST recognize supported X/Twitter post URL forms and MUST validate the
  entire parsed URL, including hostname, scheme, port, path, and redirect destination where
  applicable. The supported forms are HTTPS `x.com` or `twitter.com` status URLs with an
  optional `www` prefix and a numeric post identifier; query parameters and fragments MUST be
  ignored. Mobile hosts, short links, HTTP URLs, embedded credentials, and non-default ports MUST
  be rejected.
- **FR-003**: The system MUST reject malformed URLs, messages with no URL, messages with multiple
  URLs, unsupported domains, and unsupported X/Twitter URL forms with clear, category-specific
  feedback.
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
  receive clear feedback identifying any items that could not be delivered. A job deadline or
  cancellation MAY stop attempts for remaining items; successfully delivered items MUST be
  preserved and unattempted items MUST be identified in the final partial-result feedback.
- **FR-011**: The MVP MUST deliver a supported media item directly when a compatible representation
  is available. If no directly deliverable representation exists within the applicable constraints,
  the system MUST return a clear processing or delivery failure; media transformation is outside the
  MVP scope and MAY be added later without changing the user-facing X/Twitter workflow.
- **FR-012**: The system MUST send each successful result to the same Telegram chat from which the
  request originated.
- **FR-013**: The system MUST provide distinct, user-facing outcomes for invalid input, unsupported
  platform, inaccessible post, no supported media, retrieval failure, processing failure, and
  delivery failure.
- **FR-014**: User-facing failures MUST NOT disclose secrets, unsafe input details, internal
  diagnostics, or sensitive service information.
- **FR-015**: Retrieval, processing, and delivery MUST have explicit finite time and resource bounds.
  Each media item MUST be limited to a default maximum of 49 MiB for Telegram upload; this limit
  MAY be configured downward but MUST NOT be configured above the supported Telegram cloud upload
  ceiling. A bound being reached MUST terminate the request safely and produce an appropriate
  user-facing failure.
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

- **SC-001**: In acceptance testing, 100% of valid, accessible fixtures containing one or more
  supported video or animated items result in every deliverable supported item being sent to the
  originating chat.
- **SC-002**: At least 95% of requests using valid, accessible test posts and media within supported
  delivery limits reach delivery or clear terminal feedback within two minutes under normal
  operating conditions.
- **SC-003**: Invalid or unsupported input receives category-specific feedback within five seconds
  in 95% of acceptance-test attempts under normal operating conditions.
- **SC-004**: Every defined failure category produces its specified safe user-facing outcome in
  acceptance tests, with no secret or internal diagnostic exposed.
- **SC-005**: In a 100-request mixed success-and-failure test, every result is sent only to its
  originating chat, no request failure prevents a later valid request from completing, and no
  request-scoped temporary media remains after termination.
- **SC-006**: At least 90% of representative users in usability review can identify whether their
  request succeeded and, after a failure, understand whether correcting the URL or retrying later is
  an appropriate next action.

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
