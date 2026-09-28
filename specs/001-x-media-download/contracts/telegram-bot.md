# Telegram Bot Interaction Contract

## Accepted update

- A Telegram text message in a chat where the bot can reply.
- Exactly one unambiguous candidate URL; surrounding prose is allowed.
- Only public X/Twitter status URLs are supported: canonical `https://x.com/<account>/status/<post-id>` and `https://twitter.com/<account>/status/<post-id>`, plus only enumerated variants.
- Query/fragment data may be accepted but is discarded. Credentials, non-default ports, lookalike hosts, and non-post paths are rejected.

No URL, multiple URLs, or malformed/obscured URLs are rejected before discovery.

## Success behavior

1. Resolve all supported video/animated items.
2. Attempt each individually in source order.
3. Upload video as Telegram video and compatible X animated media as Telegram animation.
4. Ignore static images/unsupported attachments.
5. If all succeed, delivered media is sufficient.
6. If some fail, retain successes and send one concise summary with delivered/total count and failed one-based positions.

Non-normative example: “Delivered 2 of 3 media items. Item 2 could not be sent. You can try again later.”

## Failure categories

| Category | Required user meaning |
|---|---|
| Invalid URL | Send exactly one valid URL/X post URL |
| Unsupported platform | Only X/Twitter is supported |
| Inaccessible post | Post may be private, deleted, restricted, or unavailable |
| No supported media | No supported video/animated media |
| Retrieval failure | Item could not be downloaded; retry may help |
| Too large | Item exceeds current send limit |
| Processing failure | Item could not be prepared |
| Delivery failure | Prepared item could not be sent |
| Timeout | Bounded operation stopped; retry may help |
| Busy | Capacity is full; retry shortly |

Never return stacks, raw third-party errors, process output, paths, tokens, headers, internal host/IP details, or the submitted URL in an error response.

## Partial and terminal rules

- One item failure does not skip later items.
- A job-wide cancellation/deadline may stop remaining work; delivered items are not retracted.
- If zero items succeed, use the most actionable safe category and optionally failed positions without diagnostics.
- Duplicate updates are not persistently deduplicated in this stateless MVP and may produce another delivery.

## Delivery constraints

- Upload from bounded temporary storage; never ask Telegram to fetch provider URLs.
- Default maximum is 49 MiB, below the current cloud Bot API multipart limit.
- Use individual messages, not media groups.
- Pass the originating opaque destination through the request for every item/summary. Concurrency tests prove destinations cannot cross.

## Commands and non-text updates

Only the URL workflow is required. Optional `/start` or `/help` may state that one public X/Twitter post URL is accepted, but never advertise other platforms. Non-text updates consistently receive no response or a short URL instruction and never start discovery.
