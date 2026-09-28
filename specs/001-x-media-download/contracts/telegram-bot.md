# Telegram Bot Interaction Contract

## Accepted update

- A Telegram text message in a chat where the bot can reply. Candidate-token precedence is:
  zero tokens -> `InvalidUrl`; two or more tokens -> multiple-input `InvalidUrl` before parsing any
  token; exactly one malformed token -> `InvalidUrl`.
- Surrounding prose is allowed. Only a syntactically valid sole URL matching the supported HTTPS
  X/Twitter host/status allowlist proceeds to discovery.
- Only HTTPS public X/Twitter status URLs with the exact case-normalized hostname `x.com`, `www.x.com`, `twitter.com`, or `www.twitter.com` are supported.
- The submitted post URL is validated as provided; input validation does not follow its redirects.
  Query/fragment data is removed from canonical identity. Representation-download redirects follow
  the separate Safe HTTP Downloader policy. Other hosts and non-post paths produce `UnsupportedPostUrl`.

No URL, multiple URLs, or malformed/obscured URLs are rejected before discovery.

## Success behavior

1. Resolve all supported video/animated items.
2. Attempt each individually in source order.
3. Upload video as Telegram video and compatible X animated media as Telegram animation.
4. Ignore static images/unsupported attachments.
5. If all succeed, delivered media is sufficient.
6. If some fail, retain successes and send one concise summary with delivered/total count and failed one-based positions.

Non-normative example: “Delivered 2 of 3 media items. Item 2 could not be sent. You can try again later.”

## Canonical outcome taxonomy

The outcome codes and handling classes mirror the canonical taxonomy in `spec.md`.

| Code | Class and required safe meaning |
|---|---|
| `InvalidUrl` | User-sendable rejection: ask for exactly one URL. |
| `UnsupportedPostUrl` | User-sendable rejection: ask for a supported HTTPS X/Twitter status URL. |
| `PostInaccessible` | User-sendable request outcome: post cannot be accessed; check access or retry later. |
| `MediaNotFound` | User-sendable request outcome: no supported video or animated media was found. |
| `ProviderRateLimited` | User-sendable request outcome: provider temporarily limited access; retry later. |
| `ProviderOutputInvalid` | User-sendable request outcome: media details could not be read safely; retry later. |
| `MediaDownloadFailed` | Item-level: this item could not be retrieved; later items continue. |
| `MediaTooLarge` | Item-level: this item exceeds the configured media limit. |
| `MediaProcessingFailed` | Item-level: no directly deliverable representation is available or preparation failed. |
| `TelegramDeliveryFailed` | Item-level: this item could not be sent; later items continue. |
| `OperationTimedOut` | Request-wide terminal: preserve successes; send timeout/partial copy only while delivery is usable. |
| `OperationCancelled` | Request-wide terminal: preserve successes; send cancellation/partial copy only while delivery is usable. |
| `ServiceBusy` | User-sendable rejection: capacity is full; retry shortly. |
| `DeliveryDestinationUnavailable` | Logged-only request-wide terminal: stop delivery, preserve successes, suppress final send. |
| `CleanupFailed` | Logged-only secondary event: safe operator context only; preserve the primary outcome. |

Never return stacks, raw third-party errors, process output, paths, tokens, headers, internal host/IP details, or the submitted URL in an error response.

## Partial and terminal rules

- An isolated retrieval, preparation, or ordinary Telegram delivery failure affects that item only and does not skip later items.
- Caller/job/shutdown cancellation is request-wide. It stops in-progress work safely, prevents remaining items from starting, preserves delivered items, and classifies remaining positions as unattempted due to cancellation.
- `DeliveryDestinationUnavailable` is request-wide only after an authoritative permanent destination rejection: blocked bot, removed bot, missing/inaccessible chat, missing send permission, or another adapter-classified permanent equivalent. Media-specific rejection, upload failure, timeout, rate limit, transient network/server failure, and unknown Telegram error do not establish it.
- A deadline/cancellation partial with one or more delivered items sends a safe summary that distinguishes failed from unattempted positions. If no item was delivered after cancellation, send concise safe cancellation copy. After `DeliveryDestinationUnavailable`, retain only the safe typed/logged outcome and do not attempt another Telegram message.
- If zero items succeed, use the most actionable safe category and optionally failed positions without diagnostics.
- Duplicate updates are not persistently deduplicated in this stateless MVP and may produce another delivery.

## Delivery constraints

- Upload from bounded temporary storage; never ask Telegram to fetch provider URLs.
- Default maximum is 49 MiB, below the current cloud Bot API multipart limit.
- Use individual messages, not media groups.
- Pass the originating opaque destination through the request for every item/summary. Concurrency tests prove destinations cannot cross.

## Non-text updates

Only the text-message URL workflow is required. Non-text updates are ignored without a response and never start discovery. The MVP defines no `/start` or `/help` behavior.
