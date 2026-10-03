# X Media Completion Preparation

**Assessed**: 2026-10-03
**Authoritative requirement**: [spec.md](./spec.md), Session 2026-10-03, FR-008,
FR-011, FR-022, FR-023, and SC-001/SC-007.
**Scope of this checkpoint**: Specification alignment and implementation assessment only.
No production code, tests, dependency configuration, or runtime environment files were changed.

## Current implementation

The repository has the original stateless X download workflow and all T001–T091 are checked off.
Those checks record the earlier scope; they do not demonstrate completion of real GIF conversion.

| Boundary | Implemented evidence | Remaining gap |
|---|---|---|
| Provider mapping | `src/providers/x/yt-dlp-schema.ts` validates codec metadata, maps `acodec`, infers `none` from `audio_ext`, and can infer AVC from approved Twitter CDN paths | No item audio state; `representations.some(isDirectSilentAvcMp4)` makes an entire mixed item animation; explicit GIF labels override uncertainty; conflicting audio fields are collapsed rather than preserved |
| Selection | `src/media/representation-selector.ts` filters progressive HTTPS MP4s, ranks deterministically, caps candidate fallbacks, and filters animation to silent AVC | Known sound is not protected; video selection can prefer a silent candidate; animation compatibility is tied to direct MP4 animation upload rather than GIF conversion input |
| Processing/model | `DirectMediaProcessor` validates size/path and returns the MP4 unchanged; `PreparedMedia.transformed` is literally `false` | No FFmpeg converter, generated GIF artifact, distinct upload path, output validation, or conversion storage accounting |
| Delivery | `TelegramDelivery` supports `sendVideo` and `sendAnimation`, bounded delivery, native cancellation bridging, and permanent destination classification | Both methods upload `media.downloaded.path`; animation currently sends the MP4, not a generated GIF |
| Configuration/startup | Validated configuration includes a processing timeout; startup pins yt-dlp and wires direct processing | No FFmpeg path/version settings or startup check; processing timeout is not wired into an actual conversion operation |
| Process infrastructure | `ProcessRunner` uses argument arrays, `shell: false`, controlled environment, bounded output, and termination timers | Errors/stages are provider-specific; `checkVersion` hardcodes `--version`, so the proposed generic version helper must support the actual FFmpeg invocation/output contract rather than blindly reuse yt-dlp behavior |
| Safety/lifecycle | Safe streaming downloader, generated isolated workspaces, admission, ordered item continuation, request-wide timeout/cancellation, destination-unavailable stop, and finally cleanup are present | Reuse these boundaries; add tests observing conversion children and both source/output artifacts, including bounded fallback and shutdown |

## Existing tests and verification

- Provider/animation tests retain GIF entries and exclude static images. The codec-omitted fixture
  proves `audio_ext: none` and the known CDN AVC-path inference work in the current mapping.
- Selector tests cover ranking, direct-format filtering, size limits, and silent AVC animation
  eligibility. They do not cover a sound-bearing item with higher-quality silent alternatives,
  unknown/contradictory fields, or sound available only in an unsupported source.
- `tests/unit/media/animation-delivery.test.ts` explicitly expects `transformed: false`.
  `tests/integration/us2-download-animation.test.ts` sends the string `animation bytes` from an
  MP4 download through `sendAnimation`. It verifies method selection and cleanup, not GIF creation.
- Configuration/process/workflow tests cover the existing extraction and lifecycle boundaries.
  There is no GIF processor test, FFmpeg version test, or real conversion integration fixture.
- Baseline run: `npm test` passed **36 files / 216 tests**. Lint, typecheck, and build also passed.
  Passing these tests establishes the existing baseline; it does not satisfy the revised behavior.

## Conflicts resolved in the specification

The September 28 direct-delivery-only clarification, FR-011, deterministic direct-delivery policy,
SC-001, animated-media scenarios, assumptions, and simplicity statement excluded GIF conversion.
They now allow only bounded local silent MP4-to-GIF conversion while preserving unrelated URL,
SSRF, upload cap, statelessness, admission, partial-result, cancellation, and cleanup requirements.

The September 30 design and plan are useful implementation input but require reconciliation:

1. Their instruction to keep explicit X GIF labels on animation conflicts with the requested
   unknown/contradictory-audio video path. Audio classification must take precedence over labels.
2. Looking only at usable direct MP4s can misclassify an item as silent when reliable audio exists
   only in an unsupported source. Known sound must prevent silent conversion; absent an eligible
   audio-bearing MP4, fail safely. Contradictory fields make the item unknown; mixed valid silent
   and audio-bearing alternatives establish audio presence rather than a metadata contradiction.
3. Their GIF-signature check is insufficient to establish a valid completed GIF. Add decodability
   coverage and reject truncated output, including a file stopped by an encoder byte cap.
4. Generated GIF overflow must use `MediaTooLarge`; malformed/nonexistent output and conversion
   execution failure use `MediaProcessingFailed`. Preserve typed timeout/cancellation outcomes.
5. Source and output coexist. The old plan's approximate disk bound of active jobs times one media
   cap does not cover conversion or retained multi-item source files. Define aggregate storage and
   per-item retirement/fallback cleanup explicitly before implementing the converter.
6. The newer design status says implementation planning is pending although a plan already exists;
   its review status needs reconciliation without inventing prior approval.

No constitution amendment is needed: it already permits controlled FFmpeg and requires explicit
resource bounds, validated configuration, deterministic tests, dependency justification, and cleanup.

## Remaining work, in dependency order

1. Refresh the Spec Kit plan, supporting contracts/models/research, and operational decisions against
   the revised specification. Specify per-format/item audio rules, conversion input eligibility,
   startup pinning/version parsing, actual GIF validation, finite storage/CPU/memory controls,
   process stages, and fallback ownership. Retain existing source ranking and network boundaries.
2. Add unchecked dependency-ordered tasks to `tasks.md` for the new scope, preserving completed
   historical tasks. Trace them to FR-008/FR-011/FR-022/FR-023 and SC-001/SC-007. Use Spec Kit
   planning, task generation/convergence, then cross-artifact analysis before implementation.
3. Add audio-state fixtures and failing regression tests; carry validated audio evidence through
   the provider-neutral model. Require audio-bearing MP4 selection for confirmed sound; keep
   uncertain/contradictory items on video, even with a GIF label.
4. Add trusted FFmpeg configuration and startup verification with controlled version-test doubles.
   Extend process requests/errors for the processing stage without regressing yt-dlp behavior.
5. Add a bounded local converter and a distinct prepared upload artifact. Test controlled arguments,
   generated paths, palette profile, real GIF validity, byte limits, storage bounds, spawn/exit
   failure, deadlines, cancellation, partial removal, and fallback cleanup.
6. Wire startup and upload the prepared path. Update end-to-end tests to inspect GIF bytes/artifacts
   and exact Telegram methods, preserve audio-bearing MP4 bytes, and observe cleanup after success,
   conversion/delivery failure, cancellation, timeout, and shutdown. Include controlled real FFmpeg
   integration coverage separately from binary-free unit tests.
7. Update operator documentation and placeholder-only environment examples. Run the full tests,
   lint, typecheck, build, applicable formatting/security/integration gates, and final review.
   Commit coherent implementation checkpoints and any distinct fixes under `AGENTS.md` policy.

## Documents requiring follow-up

| Document | Required update |
|---|---|
| `specs/001-x-media-download/plan.md` | Remove FFmpeg exclusion; revise architecture, dependency rationale, startup configuration, resource/storage bounds, errors, constitution evidence, and verification strategy |
| `specs/001-x-media-download/tasks.md` | Append new unchecked work and final verification; identify earlier direct-only tasks as historical scope |
| `specs/001-x-media-download/data-model.md` | Audio presence/evidence, downloaded versus prepared artifact, upload path/container/size, transformation flag, process stage and ownership |
| `specs/001-x-media-download/contracts/application-ports.md` | Processor output and workspace/process contracts; local conversion and stage-aware failures |
| `specs/001-x-media-download/contracts/telegram-bot.md` | Sound-aware MP4/video versus real GIF/animation semantics and safe conversion failures |
| `specs/001-x-media-download/research.md` | Supersede direct-only FFmpeg decision, justify pinned executable, document validated conversion approach and revised disk accounting |
| `specs/001-x-media-download/quickstart.md` | FFmpeg prerequisite/pin, configuration and new video/GIF/unknown-audio smoke checks |
| `specs/001-x-media-download/checklists/clarified-acceptance.md` and `checklists/security-lifecycle.md` | Reassess checked claims and add sound/GIF/process/storage/lifecycle coverage |
| `docs/superpowers/specs/2026-09-30-silent-media-gif-design.md` | Reconcile label precedence, non-direct audio evidence, output validity/overflow, storage, and status |
| `docs/superpowers/plans/2026-09-30-sound-aware-gif-conversion.md` | Align tasks with the revised specification and Spec Kit tasks, version invocation, GIF validation, resource ownership, and regression coverage |
| `README.md`, `docs/security.md`, and planned `docs/media-processing.md` | Installation, version/provenance/licensing, conversion bounds, local-only process inputs, storage/cleanup, safe failures and uncertain audio behavior |
| `.env.example` | Add placeholder-only FFmpeg executable/version settings during configuration work; no real environment file is needed |

Updated at this checkpoint: `spec.md`, `checklists/requirements.md`, and this assessment.
All other documents above remain unchanged pending the planning/task refresh. The feature is ready
for that refresh, not for an implementation-complete declaration.
