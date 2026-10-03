# Silent X Media GIF Conversion

## Status

**Planning reconciliation 2026-10-03**: This dated design is preserved as an input. The updated
[Spec Kit specification](../../../specs/001-x-media-download/spec.md),
[plan](../../../specs/001-x-media-download/plan.md), and
[sound-aware contracts](../../../specs/001-x-media-download/contracts/sound-aware-media.md)
govern completion. They supersede direct-format-only audio classification, GIF-label override,
and signature-only validation, and define shared-budget, hard-output-cap, and storage ownership.
No production implementation is claimed by this planning update.

Design approved in chat on 2026-09-30. Implementation plan and code are pending written-spec
review.

## Goal

When an X post contains supported video media, preserve sound by sending audio-bearing clips as
videos. Convert clips that are explicitly known to have no audio into actual GIF files and send
those files through Telegram's animation API. When audio presence is unknown, keep the existing
video path.

Telegram accepts GIF uploads as animation messages and converts them to silent MPEG-4 for storage.
The file produced and uploaded by this bot must be a `.gif` before Telegram receives it.
See the [Telegram Bot API](https://core.telegram.org/bots/api) and
[Telegram GIF documentation](https://core.telegram.org/api/gifs).

## Chosen approach

Use the trusted FFmpeg executable already available to the deployment. Invoke it through the
existing process-runner boundary with an argument array, `shell: false`, a processing deadline,
bounded diagnostics, and paths generated inside the request's temporary workspace. Do not add a
JavaScript GIF encoder or use Telegram's MP4-as-animation shortcut as the conversion.

At startup, compare the configured FFmpeg version with the deployment's approved version, as the
application already does for yt-dlp. The deployment remains responsible for supplying a pinned
FFmpeg build and its applicable license notices.

## Audio classification and representation selection

- Parse audio codec/container metadata from yt-dlp format records.
- Classify an item as audio-bearing when a usable direct MP4 representation explicitly reports an
  audio stream. Classify it as silent only when every usable direct MP4 representation explicitly
  reports no audio. Missing metadata or contradictory fields within a representation are unknown
  and follow the existing video path.
- For an item known to contain audio, select an audio-bearing direct MP4 representation. Do not
  silently select a video-only representation for a known audio-bearing item; if none is directly
  deliverable, fail that item safely.
- Keep explicitly identified X GIFs on the animation path. Static images remain excluded.

## Conversion and delivery

- Convert a known-silent MP4 to a `.gif` inside the same request workspace. Keep the downloaded MP4
  as the conversion input; use a generated GIF output path, never a metadata-derived filename.
- Use FFmpeg's palette-based GIF encoding with a bounded profile (15 frames per second and a
  maximum width of 640 pixels, preserving aspect ratio) to control output size and CPU work.
- Deliver the GIF with the existing `sendAnimation` adapter path. Deliver audio-bearing MP4s with
  `sendVideo` and preserve their sound.
- Mark conversion as transformed in `PreparedMedia`. The converted artifact remains workspace
  local and is removed by normal request cleanup.

## Resource and failure policy

- Apply the existing processing timeout and `MAX_MEDIA_BYTES` limit to the generated GIF.
- Ask FFmpeg to stop near the output byte cap, then verify the completed file's actual size before
  delivery; reject empty, invalid, or oversized outputs and remove partial artifacts.
- A conversion failure is an item-level `MediaProcessingFailed`; later items continue under the
  existing partial-results policy. Request cancellation and deadline expiry retain their current
  request-wide behavior.
- Keep process output, executable paths, and temporary paths out of user-visible replies and logs.

## Configuration and operations

Add required `FFMPEG_PATH` and `FFMPEG_EXPECTED_VERSION` settings, validate them with the existing
configuration boundary, check the executable version before polling, and document installation,
pinning, and licensing in the README and media operations documentation. Update `.env.example` with
placeholders only.

## Verification

Use deterministic fixtures and a controlled process runner to verify:

1. Explicitly silent metadata selects GIF conversion; audio-bearing metadata remains video; unknown
   audio metadata stays on the video path.
2. Known audio-bearing items cannot select a video-only representation.
3. Conversion receives only controlled arguments and generated workspace paths, honors timeout and
   cancellation, and rejects missing, empty, and oversized output.
4. Successful silent conversion produces a `.gif` `PreparedMedia` with animation delivery; audio
   items continue through video delivery.
5. Workspace cleanup removes both source and converted files on success and failure.
6. Startup rejects a missing or mismatched approved FFmpeg executable version.

Run the full test suite, lint, typecheck, build, and final code review when implementation is
complete.
