# X-to-GIF Telegram Bot Redesign

## Goal

Replace the current multi-path media downloader with a small Telegram bot whose single job is to
accept a public X post link and return its animated media as an actual GIF file. The bot must never
deliver an MP4 or use Telegram's video delivery method.

The rebuild replaces project source, tests, and product documentation as needed. It preserves Git
history, the local ignored `.env`, and the repository instructions. The checked-in `.env.example`
may be replaced with a minimal placeholder-only configuration example.

## User flow

1. A user sends a message containing one X/Twitter status URL to the bot.
2. The bot accepts only HTTPS status URLs on `x.com`, `www.x.com`, `twitter.com`, or
   `www.twitter.com`; it rejects other domains and malformed or multiple links with a short
   explanation.
3. The bot asks `yt-dlp` for the post's animated media and downloads a suitable source into a
   request-scoped temporary directory.
4. FFmpeg converts the source to GIF with a bounded size, dimensions, frame rate, and runtime.
5. The bot validates the produced GIF and uploads that file with Telegram `sendAnimation`.
6. Temporary source and output files are removed on success, failure, timeout, and shutdown.

If the post is inaccessible, has no supported animation, extraction or conversion fails, or the GIF
cannot be delivered, the bot sends a safe and understandable error message. It does not claim that a
video file is a GIF and does not send the source media as a fallback.

## Architecture

Keep the application intentionally small and separate the external boundaries:

- **Telegram bot** receives messages, extracts the one candidate URL, and reports outcomes.
- **X media extractor** invokes a pinned local `yt-dlp` executable without a shell, validates its
  structured output, and retrieves the selected source.
- **GIF converter** invokes a pinned local FFmpeg executable with a fixed conversion profile and
  enforces time and output-size limits.
- **GIF check and delivery** verifies the output is a non-empty GIF and passes only that path to
  Telegram's animation API.
- **Request workspace** owns temporary files and removes them after every request.

Use long polling and local temporary storage. The MVP needs no database, Redis, webhook server, X
credentials, or user accounts. Limit concurrent requests and bound per-request download size,
conversion time, GIF dimensions, and output size so the lightweight process has predictable
resource use.

The delivery boundary accepts a GIF artifact only. Its public interface must not expose a video
delivery operation. Validate the file signature and decode the GIF with the trusted local media tool
before upload; a `.gif` filename or MIME label by itself is insufficient.

## Security and operations

- Treat message text, URLs, extractor output, metadata, and filenames as untrusted.
- Allow only the documented X status URL hosts and path shape; do not fetch arbitrary user URLs.
- Invoke local tools with argument arrays, fixed options, timeouts, bounded output, and no shell.
- Use per-request temporary directories with restrictive permissions and reliable cleanup.
- Keep logs free of bot tokens, full user messages, media URLs, and local temporary paths.
- Load the Telegram token and trusted executable paths from environment configuration; commit only
  placeholder values in `.env.example`.
- Never delete or overwrite the developer's ignored `.env` during the rebuild.

## Acceptance criteria

1. One valid public X status link containing animated media produces a GIF file in the same chat.
2. Telegram receives the verified GIF via `sendAnimation`; `sendVideo` is never called.
3. A non-GIF output, including an MP4 renamed with a GIF extension, is rejected before delivery.
4. Invalid, multiple, unsupported, or non-X URLs receive clear feedback and do not start extraction.
5. Posts with no supported animation and inaccessible posts receive distinct safe feedback.
6. Download, conversion, validation, timeout, and Telegram errors do not leak internals and do not
   prevent a subsequent request from being handled.
7. Temporary media is removed after all terminal outcomes, and bounded concurrency/resource limits
   are enforced.
8. Automated tests cover URL validation, tool boundaries, GIF validation, Telegram method choice,
   cleanup, and representative end-to-end failure cases without calling live X or Telegram.

## Out of scope

- Sending videos, audio, still images, albums, or generic media.
- Telegram commands beyond a minimal start/help response and link handling.
- User accounts, databases, persistent job queues, webhooks, hosting dashboards, and analytics.
- Arbitrary URL downloads, X login/cookies, and private or protected posts.
- General-purpose transcoding or user-selectable conversion settings.

## Implementation checkpoints

1. Replace the current feature contracts with a minimal typed GIF-only domain and configuration.
2. Implement strict X URL handling and a bounded local `yt-dlp` extraction boundary.
3. Implement request workspaces and bounded source download/conversion to a validated GIF.
4. Implement GIF-only Telegram delivery, request feedback, and graceful lifecycle handling.
5. Replace obsolete project documentation and fixtures, then run full verification and review.

Each checkpoint should include its behavior tests and be committed independently when verified.
