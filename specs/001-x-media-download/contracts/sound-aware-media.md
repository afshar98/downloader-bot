# Sound-Aware Media Contracts

**Status**: Planned contracts, 2026-10-03; production code still implements the earlier scope.
**Authority**: [spec.md](../spec.md), FR-008/FR-011/FR-022/FR-023 and SC-001/SC-007.
These contracts must be implemented and frozen by the shared-contract owner before parallel work.
Existing provider, downloader, admission, error taxonomy, and operation-context boundaries remain.

## Audio evidence and item classification

```text
AudioPresence = present | absent | unknown
AudioEvidence = present | absent | unknown | conflicting
MediaRepresentation.audioEvidence: AudioEvidence
DiscoveredMedia.audioPresence: AudioPresence
DownloadedMedia.audioPresence: AudioPresence
```

Validate and normalize `acodec` and `audio_ext` separately at the provider boundary: trim and
case-normalize; missing, null, blank, and the literal `unknown` are unknown, never evidence of sound
or silence. Concrete non-`none` codec/container values indicate sound; `none` indicates absence.
One explicit field with the other unknown is usable evidence. Opposing explicit fields produce
`conflicting`. Preserve that fourth state when mapping formats; do not use nullish coalescing to
discard contradictions. Keep the existing bounded audio codec field as descriptive metadata.

Aggregate over all schema-valid, usable supported video representations (valid parsed URL and
nonempty non-`none` video codec, including existing approved-CDN AVC inference), before direct MP4,
size, or quality filtering. Unsupported static/audio-only formats do not contribute. A usable video
format can supply audio evidence even when its protocol/container/size prevents direct delivery.

| Evidence across usable video representations | Item state | Required path |
|---|---|---|
| Any `conflicting` field pair | `unknown` | MP4 / video |
| No conflict; at least one `present`, even with silent/unknown alternatives | `present` | Audio-bearing MP4 / video |
| Nonempty set, all `absent` | `absent` | Silent MP4 -> real GIF / animation |
| Otherwise, including silent plus unknown | `unknown` | MP4 / video |

`DiscoveredMedia.kind` and `DownloadedMedia.kind` remain for compatibility: `animation` only for
item `absent`; otherwise `video`. A GIF label cannot override this table. The processor checks audio
state rather than trusting `kind`. The downloader copies the item state, not just the selected
format's evidence. A conflicting format plus a reliable audio format remains unknown per FR-022;
it does not authorize conversion.

## Representation selection

Retain current progressive HTTPS MP4, credentials/port, video-codec, size, ranking, and maximum-three
fallback rules. Apply audio eligibility before ranking and size diagnosis:

- `present`: candidates must have `audioEvidence: present`. Silent/unknown/conflicting alternatives
  cannot be selected, including on fallback. Known audio only in HLS or another ineligible source
  yields safe failure rather than converting a direct silent alternative.
- `absent`: candidates must have `audioEvidence: absent`; retain the existing AVC/H.264 conversion
  source subset. This feature does not broaden supported input codecs.
- `unknown`: keep existing direct video compatibility and quality ordering; uncertainty never
  triggers GIF.

No otherwise eligible source: `MediaProcessingFailed`. All audio-eligible/direct-compatible sources
known oversized: `MediaTooLarge`. Unknown size remains eligible behind the existing stream cap.

## Prepared upload artifact

```text
PreparedMedia =
  { downloaded, deliveryPath, deliverySizeBytes,
    deliveryKind: video, deliveryContainer: mp4, transformed: false }
  | { downloaded, deliveryPath, deliverySizeBytes,
      deliveryKind: animation, deliveryContainer: gif, transformed: true }
ProcessingBudget = { signal: AbortSignal, deadlineAt: monotonic number, remainingMs(): number }
MediaProcessor.prepare(media, context, workspace, budget: ProcessingBudget) -> Promise<PreparedMedia>
```

Paths are absolute application-generated paths in the supplied workspace. `downloaded` retains
source identity/provenance; `deliveryPath` identifies the actual upload artifact. For video it equals
the source path; for animation it identifies a separate validated `.gif`. Bytes are actual positive
sizes at/below the configured cap. No `animation/mp4/transformed:false` value is deliverable.
`DirectMediaProcessor` supports video passthrough only and rejects silent animation requests safely.
`GifMediaProcessor` delegates video to that processor and converts only confirmed silence.
`TelegramDelivery` uses `deliveryPath`; its existing method switch, signal bridge, opaque destination,
timeout, and permanent-destination classification remain intact.

## Workspace and artifact ownership

Retain source `partPath`, `mediaPath`, `finalizeItem`, and `removePartial`. Extend generated item paths
with `palettePartPath`, `palettePath`, `gifPartPath`, and `gifPath`:

```text
item-NNNN.part / item-NNNN.mp4
item-NNNN.palette.part / item-NNNN.palette.png
item-NNNN.gif.part / item-NNNN.gif
TemporaryWorkspace.finalizePalette(position) -> Promise<void>
TemporaryWorkspace.finalizeGif(position) -> Promise<void>
TemporaryWorkspace.removeConversion(position) -> Promise<void>
TemporaryWorkspace.removeItem(position) -> Promise<void>
```

All finalizations rename within the workspace after validation; no metadata filename becomes a
path. Conversion/source files are exclusively created, non-symlink regular files, mode `0600`.
`removeConversion` removes palette and GIF partial/final artifacts but retains source; `removeItem`
removes all six paths and is idempotent. Workspace factory cleanup remains recursive and authoritative.

Application orchestration calls `removeItem` after every attempt, including before fallback or the
next item, and after delivery has settled. It awaits process/stream closure before deleting files.
Converter failure promptly calls `removeConversion`; it never owns admission or deletes unrelated
items. A removal failure logs `CleanupFailed` without replacing delivery/primary outcome; before
any new attempt, repeat removal and verify absence. If bounded retry cannot clear prior artifacts,
do not reuse paths or allocate more: invoke the fatal-resource callback below, preserve results,
and mark remaining items unattempted with the existing request-wide cancellation outcome.
Final cleanup still retries. Ordinary item failures and cleanup failures that recover on retry do
not stop unrelated jobs.

`ProcessRunner` and `TemporaryWorkspaceFactory` receive one internal
`onFatalResourceFailure(reason: 'process-termination-unconfirmed' | 'workspace-cleanup-incomplete')`
callback. These internal reason strings are not new user outcome codes. The integration owner wires
it to synchronously abort the existing service controller before releasing a permit, cancel queued
and active acquisition, and initiate the existing bounded polling shutdown without awaiting the
current request from within its own callback. Exhausted final workspace cleanup also invokes it.
Safe logs use existing `MediaProcessingFailed`/`CleanupFailed` codes and no artifact/process paths.
Confirmed live children/streams retain workspace ownership until closure; do not rename, delete,
or reuse paths while a writer may still run. Retain the handle internally for bounded termination
and `ProcessRunner.closeResources()`; if closure remains unconfirmed, shutdown grace enforces
terminal service exit. The process port adds that bounded drain operation for the existing polling
shutdown closeResources hook; it introduces no global application job registry.
If termination cannot be confirmed after escalation, `run` notifies the callback but remains
pending until child and sink closure (or terminal service exit). It must not reject early and let
request `finally` delete a live writer's workspace. Preserve the original terminal error to reject
once closure is confirmed; the service shutdown grace bounds this exceptional wait.
Unremovable leftovers require operator remediation before restart. This is resource-integrity
shutdown, not a global reaction to an ordinary conversion/upload error; no new scheduler or health
service is introduced. Permits still release in `finally`, but the service signal prevents reuse.

At most one item's artifacts remain per job: one capped MP4, one capped GIF partial/final, and a
palette capped at 16 KiB. Default media-storage bound is two jobs times `(2 * 49 MiB + 16 KiB)` =
196 MiB + 32 KiB, plus separately capped captured diagnostics/metadata and filesystem overhead.
Palette partial/final and GIF partial/final never coexist after rename. No previous item or fallback
source/output accumulates. A failed deletion cannot silently invalidate this bound.

## Process execution and version verification

```text
ProcessExecution.stage: provider | processing
ProcessExecution.stdoutFile?: { path: generated workspace partial path, maxBytes: positive integer }
ProcessExecutionResult.stdout: string  // empty for a binary file sink
ProcessExecutionResult.outputBytes?: number  // actual streamed binary bytes
```

Retain executable, argument array, controlled cwd/environment, timeout, diagnostic caps, and signal.
`ProcessRequest` aliases the application contract instead of maintaining a drifting duplicate.
Captured provider/version stdout remains bounded UTF-8 text. With `stdoutFile`, the runner streams
binary stdout into exclusive owned storage without collecting it in memory. The sink refuses the
first byte above `maxBytes`, kills/awaits the child, closes/unlinks the partial, and returns
`MediaTooLarge` at `processing`. Do not reuse the text stdout limit as the media limit. Success
requires completed sink closure; callers require zero exit before validating/accepting an artifact.
No prepared artifact may appear while writes remain outstanding. Stderr is capped separately,
never logged or sent.

Ordinary spawn/pipe/capture errors use `ProviderOutputInvalid` at `provider` or
`MediaProcessingFailed` at `processing`; processing output overflow uses `MediaTooLarge`.
Return nonzero completed exit results intact so XMediaProvider retains inaccessible/rate-limit
classification; the converter classifies unsuccessful exit as `MediaProcessingFailed`.
Typed timeout/cancellation reasons retain their codes and adopt the caller's stage. Keep existing
termination escalation; a process that cannot be confirmed closed must prevent further acquisition
and invoke the fatal-resource callback, not be treated as a cleaned-up successful conversion.

Keep `checkVersion(executable)` for yt-dlp's `--version`. Add a focused config verifier using
`run({stage: processing, args: ['-version'], ...})` for FFmpeg: 5-second timeout, 16 KiB stdout,
16 KiB stderr, require successful exit and parse the first-line `ffmpeg version <token>` token.
Compare exactly against nonblank `FFMPEG_EXPECTED_VERSION`; do not compare the entire banner or
invent an approved release. Missing executable, malformed output, and mismatch fail before polling.
The deployment records the artifact checksum/provenance separately from the version token.

## Processing lifetime and output validation

Application orchestration creates one processing budget after the first successful download for
each item, using `context.createStageSignal('processing', processingTimeoutMs)` and a monotonic
deadline `min(jobDeadline, processingStart + processingTimeoutMs)`. Its `remainingMs()` derives from
the same injected monotonic clock as OperationContext (or from changes in its remaining job time);
consumers do not substitute an independent clock. This budget covers palette generation,
encoding, structural inspection, full GIF decode, and finalization. All subprocesses receive that
same signal and only the remaining positive duration; check exhaustion before spawning. No fresh
60-second budget per pass/fallback and no reset of the original 115-second job deadline. Subsequent
fallback downloads use the same budget signal as well as their own existing download bound, so
processing expiry cannot start or prolong further acquisition. Each fallback consumes the remaining
item-processing budget, not a new conversion lifetime. Delivery retains its original independent
delivery/job deadlines and original context signal; the processing budget is not a new 60-second
Telegram upload limit. Check the budget before delivery begins, and dispose it in the item's `finally`.

The concrete conversion/validation decisions are in [research.md](../research.md#11-sound-aware-completion-decisions).
Invalid/missing/empty/truncated GIF: `MediaProcessingFailed`; actual output overflow: `MediaTooLarge`.
Processing/job timeout or caller/shutdown cancellation stops the whole request under the existing
outcome taxonomy, preserving successes. Item-local conversion failure permits later items after
owned-artifact cleanup. No new outcome code, storage service, scheduler, or provider framework.
