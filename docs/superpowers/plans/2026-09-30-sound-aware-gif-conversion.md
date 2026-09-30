# Sound-Aware GIF Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send sound-bearing X clips as videos and convert explicitly silent clips into real GIF files for Telegram animation delivery.

**Architecture:** Extend validated yt-dlp metadata into item-level audio-presence state, then require sound-bearing items to select an audio-bearing direct MP4. Add an FFmpeg-backed processor that converts silent MP4s inside the request workspace and returns a separate delivery path. Pin the FFmpeg executable in runtime configuration and keep conversion under existing process, time, and byte limits.

**Tech Stack:** Node.js 24, TypeScript, Zod, Vitest, existing `ProcessRunner`, external pinned FFmpeg, grammY Telegram adapter.

**Spec:** `docs/superpowers/specs/2026-09-30-silent-media-gif-design.md`

## Global Constraints

- Runtime is Node.js 24 and strict TypeScript.
- FFmpeg is a trusted external executable with required `FFMPEG_PATH` and `FFMPEG_EXPECTED_VERSION` configuration.
- Invoke FFmpeg with argument arrays and `shell: false`; use only generated paths inside the request workspace.
- Convert at 15 frames per second and maximum width 640 pixels, preserving aspect ratio.
- Use `PROCESSING_TIMEOUT_MS` and cap generated GIF output at `MAX_MEDIA_BYTES` (default `51380224`, 49 MiB); verify actual output size after FFmpeg exits.
- Convert only clips explicitly known to have no audio. Audio-bearing clips remain videos; unknown or contradictory audio metadata remains on the video path.
- A known audio-bearing item may not fall back to a video-only representation.
- Keep process output, executable paths, and temporary paths out of user-visible replies and logs.
- Preserve per-item failure isolation, request-wide cancellation/deadline behavior, and workspace cleanup.

## Review Focus

- A sound-bearing post exposes both audio and silent formats; selection must choose an audio-bearing direct MP4. Test in Task 2.
- A sound-bearing post has no direct audio-bearing format; it must fail safely instead of losing sound. Test in Task 2.
- Audio metadata is missing or contradictory; the item must stay on the existing video path. Test in Task 2.
- FFmpeg exits successfully but emits an empty, malformed, or over-limit file; delivery must not run and partial output must be removed. Test in Task 3.
- FFmpeg stalls or the job is cancelled during conversion; the process must terminate and keep the established timeout/cancellation outcomes. Test in Task 3.

## File Structure

- `src/config/load-config.ts`: validate and expose the trusted FFmpeg path and approved version.
- `src/config/verify-executable-version.ts`: compare an executable's reported version with its approved value.
- `src/application/models.ts`: carry item audio-presence state and the final prepared delivery path.
- `src/providers/x/yt-dlp-schema.ts`: validate audio container metadata and derive audio presence conservatively.
- `src/media/representation-selector.ts`: require audio-bearing formats for known audio-bearing items.
- `src/media/gif-media-processor.ts`: convert silent MP4s to controlled, validated GIF files through `ProcessRunner`.
- `src/infrastructure/process-runner.ts`: support processing-stage timeout and cancellation errors for media conversion.
- `src/bot/telegram-delivery.ts`: upload `PreparedMedia.deliveryPath` using its existing video/animation method selection.
- `src/index.ts`: verify FFmpeg version at startup and wire the processor.
- `tests/fixtures/x/`: silent, audio-bearing, and ambiguous yt-dlp metadata fixtures.
- `tests/unit/config/`, `tests/unit/providers/x/`, `tests/unit/media/`, and `tests/unit/bot/`: focused regression coverage.
- `tests/integration/`: end-to-end silent GIF and sound-bearing video delivery through controlled ports.
- `.env.example`, `README.md`, and `docs/media-processing.md`: configure, install, pin, and document FFmpeg.

## Tasks

### Task 1: Pin FFmpeg in runtime configuration

**Files:**

- Modify: `src/config/load-config.ts`
- Create: `src/config/verify-executable-version.ts`
- Modify: `src/index.ts`
- Modify: `.env.example`
- Modify: `tests/unit/config/load-config.test.ts`
- Create: `tests/unit/config/verify-executable-version.test.ts`

**Interfaces:**

- Consumes: `ProcessRunnerPort.checkVersion(executable: string): Promise<string>`.
- Produces: `RuntimeConfig.ffmpegPath: string`, `RuntimeConfig.ffmpegExpectedVersion: string`, and `verifyExecutableVersion(runner: Pick<ProcessRunnerPort, 'checkVersion'>, executable: string, expectedVersion: string): Promise<void>`.

- [ ] **Step 1: Write config and version-check tests** asserting valid FFmpeg settings load, missing or blank settings reject, exact versions pass, and mismatched versions reject without exposing process output.
- [ ] **Step 2: Run `npm test -- --run tests/unit/config/load-config.test.ts tests/unit/config/verify-executable-version.test.ts` and confirm the new assertions fail.**
- [ ] **Step 3: Implement required `FFMPEG_PATH` and `FFMPEG_EXPECTED_VERSION` parsing and the reusable approved-version check; call it before polling starts.** Reuse the helper for the existing yt-dlp version comparison.
- [ ] **Step 4: Re-run the two config tests and `npm run typecheck`; expect all to pass.**
- [ ] **Step 5: Inspect and commit the config boundary as `feat(config): pin the FFmpeg executable`.**

### Task 2: Classify audio and preserve sound-bearing formats

**Files:**

- Modify: `src/application/models.ts`
- Modify: `src/providers/x/yt-dlp-schema.ts`
- Modify: `src/media/representation-selector.ts`
- Modify: `tests/support/builders.ts`
- Create: `tests/fixtures/x/audio-bearing.json`
- Create: `tests/fixtures/x/audio-unknown.json`
- Modify: `tests/fixtures/x/direct-codec-omitted.json`
- Create: `tests/unit/providers/x/yt-dlp-audio-classification.test.ts`
- Modify: `tests/unit/media/representation-selector.test.ts`
- Modify: `tests/unit/providers/x/yt-dlp-schema-direct-formats.test.ts`

**Interfaces:**

- Consumes: validated yt-dlp `acodec` and `audio_ext` fields.
- Produces: `AudioPresence = 'present' | 'absent' | 'unknown'` on every `DiscoveredMedia`; explicit `audioCodec` values on mapped representations; selector behavior that restricts known audio-bearing items to audio-bearing direct MP4 candidates.

- [ ] **Step 1: Write tests** for explicit silent, audio-bearing, missing, and contradictory audio metadata; assert known audio-bearing media selects an audio-bearing candidate despite a higher-quality silent candidate and fails when no direct audio candidate exists.
- [ ] **Step 2: Run `npm test -- --run tests/unit/providers/x/yt-dlp-audio-classification.test.ts tests/unit/providers/x/yt-dlp-schema-direct-formats.test.ts tests/unit/media/representation-selector.test.ts` and confirm the new assertions fail.**
- [ ] **Step 3: Add `audioPresence` to `DiscoveredMedia`; map `audio_ext` and `acodec`; set `present` when a usable direct MP4 reports audio, `absent` only when every usable direct MP4 explicitly reports none, otherwise `unknown`. Derive animation only from explicit GIF metadata or `absent`.**
- [ ] **Step 4: Update the selector and test builders so `audioPresence === 'present'` excludes candidates whose `audioCodec` is missing or `none`; leave unknown-media selection unchanged.**
- [ ] **Step 5: Run the three focused test files and typecheck; expect all to pass, including existing ordinary-video selection tests.**
- [ ] **Step 6: Inspect and commit the metadata and selection boundary as `feat(media): preserve audio when selecting X video formats`.**

### Task 3: Convert silent MP4s into bounded GIF artifacts

**Files:**

- Modify: `src/application/models.ts`
- Modify: `src/infrastructure/process-runner.ts`
- Modify: `src/providers/x/x-media-provider.ts`
- Create: `src/media/gif-media-processor.ts`
- Modify: `src/media/direct-media-processor.ts`
- Modify: `tests/support/builders.ts`
- Create: `tests/unit/media/gif-media-processor.test.ts`
- Modify: `tests/unit/infrastructure/process-runner.test.ts`
- Modify: `tests/unit/media/direct-media-processor.test.ts`
- Modify: `tests/unit/providers/x/x-media-provider.test.ts`

**Interfaces:**

- Consumes: `DownloadedMedia`, `OperationContext`, `ProcessRunnerPort`, approved FFmpeg path, processing timeout, and media byte cap.
- Produces: `PreparedMedia.deliveryPath: string` and `PreparedMedia.transformed: boolean`; `GifMediaProcessor.prepare(media, context): Promise<PreparedMedia>` returns the source MP4 unchanged for video items and a workspace-local `.gif` path for animation items.

- [ ] **Step 1: Write processor tests** proving video items bypass FFmpeg, silent items invoke FFmpeg with controlled palette filters, 15 fps, max width 640, no audio, `-fs` at the configured cap, and generated input/output paths; verify successful output returns a `.gif` delivery path.
- [ ] **Step 2: Add failure tests** for nonzero exit, spawn failure, timeout, cancellation, absent output, invalid GIF signature, zero-byte output, and output above `MAX_MEDIA_BYTES`; expect no prepared delivery artifact and cleanup of partial GIF files.
- [ ] **Step 3: Run `npm test -- --run tests/unit/media/gif-media-processor.test.ts tests/unit/infrastructure/process-runner.test.ts` and confirm new assertions fail.**
- [ ] **Step 4: Extend `PreparedMedia` with a delivery path and boolean transformed marker; update direct processing to return the original path and `transformed: false`.**
- [ ] **Step 5: Add a processing stage to process requests and propagate it through timeout/cancellation/error construction; specify `provider` for yt-dlp and `processing` for FFmpeg.**
- [ ] **Step 6: Implement `GifMediaProcessor` using argument-array FFmpeg invocation, the operation deadline, the approved output cap, generated GIF paths, post-run size/stat checks, and `GIF87a`/`GIF89a` signature validation.** Use a static palette filter graph and fixed `fps=15`, width `min(640,iw)`, aspect-preserving height.
- [ ] **Step 7: Re-run processor, process-runner, and direct-processor tests; expect timeout/cancellation codes and all output validation cases to pass.**
- [ ] **Step 8: Inspect and commit the conversion adapter as `feat(media): convert silent MP4 clips to bounded GIF files`.**

### Task 4: Deliver the converted artifact and wire production startup

**Files:**

- Modify: `src/bot/telegram-delivery.ts`
- Modify: `src/index.ts`
- Modify: `tests/unit/bot/telegram-delivery.test.ts`
- Modify: `tests/integration/us2-download-animation.test.ts`
- Modify: `tests/integration/us1-download-video.test.ts`
- Modify: `README.md`
- Create: `docs/media-processing.md`

**Interfaces:**

- Consumes: `PreparedMedia.deliveryPath`, `deliveryKind`, the FFmpeg runtime config, `GifMediaProcessor`, and `verifyExecutableVersion` from Tasks 1 and 3.
- Produces: production startup verifies yt-dlp and FFmpeg before polling; Telegram uploads GIF paths via `sendAnimation` and audio-bearing MP4 paths via `sendVideo`.

- [ ] **Step 1: Write delivery/integration tests** asserting the exact silent fixture is converted to a `.gif` and passed to `sendAnimation`, while the audio-bearing fixture's MP4 is passed to `sendVideo`.
- [ ] **Step 2: Add cleanup assertions** for both source MP4 and converted GIF on delivery success and conversion/delivery failure.
- [ ] **Step 3: Run `npm test -- --run tests/unit/bot/telegram-delivery.test.ts tests/integration/us1-download-video.test.ts tests/integration/us2-download-animation.test.ts` and confirm the new assertions fail.**
- [ ] **Step 4: Make `TelegramDelivery` upload `PreparedMedia.deliveryPath`; wire `GifMediaProcessor` into `src/index.ts` and verify the approved FFmpeg version before polling.**
- [ ] **Step 5: Document FFmpeg installation, pinned version, licensing responsibility, conversion profile, and safe fallback for unknown audio metadata in README and `docs/media-processing.md`.** FFmpeg environment placeholders were added in Task 1.
- [ ] **Step 6: Run focused delivery/integration tests, lint, typecheck, and build; expect both file types to use their correct Telegram methods and all checks to pass.**
- [ ] **Step 7: Inspect and commit production wiring and operator docs as `feat(telegram): deliver silent clips as GIF animations`.**

### Task 5: Full verification and final review

**Files:**

- Review all changes from Tasks 1–4.

- [ ] **Step 1: Run `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, and `npm run format:check`; record any pre-existing formatting failures separately from changed-file formatting.**
- [ ] **Step 2: Review the complete diff for audio loss, unsafe FFmpeg arguments or paths, output-limit gaps, timeout/cancellation regressions, partial-file cleanup, and secret exposure.**
- [ ] **Step 3: Fix any blocking finding in a focused commit, rerun affected checks, and verify `git status --short` contains no intended uncommitted changes.**

## Coverage Self-Review

- Audio-state classification and conservative fallback: Task 2.
- Audio-preserving direct selection and safe failure without an audio format: Task 2.
- Palette conversion profile, generated paths, actual GIF validation, byte cap, processing deadline, and cancellation: Task 3.
- Converted-path upload, correct Telegram method, and request cleanup: Task 4.
- Required executable configuration and startup version pin: Task 1 and Task 4.
- Setup, licensing, and environment documentation: Task 4.
