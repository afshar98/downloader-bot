---

description: "Implementation tasks for X/Twitter media download"
---

# Tasks: X/Twitter Media Download

**Input**: Design documents from `specs/001-x-media-download/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, and `contracts/`

**Tests**: Tests are required by the project constitution and follow red-green-refactor. Test tasks are listed before the implementation they drive.

## Phase 1: Setup

**Purpose**: Establish the strict TypeScript service and deterministic verification tooling.

- [X] T001 Initialize Node.js 24 ESM project metadata, scripts, and pinned runtime/dependency versions in `package.json`
- [X] T002 [P] Configure strict TypeScript source/build settings and NodeNext module resolution in `tsconfig.json` and `tsconfig.build.json`
- [X] T003 [P] Configure ESLint flat config, formatting conventions, and ignored generated/temp paths in `eslint.config.mjs` and `.prettierrc.json`
- [X] T004 [P] Configure deterministic Vitest execution, coverage defaults, and test path aliases in `vitest.config.ts`
- [X] T005 [P] Create planned source and test directories under `src/` and `tests/` without empty architectural layers
- [X] T006 [P] Add secret-free runtime examples and ignore rules for `.env`, temp workspaces, build output, and coverage in `.env.example` and `.gitignore`
- [X] T007 Document local Node.js, yt-dlp executable, long-polling, and verification prerequisites in `README.md`

---

## Phase 2: Foundational

**Purpose**: Implement shared contracts and safety infrastructure required by every user story.

**CRITICAL**: No user-story implementation starts until this phase is complete.

- [X] T008 Write unit tests for discriminated application errors, request/item outcomes, safe normalization, and user-safe error codes in `tests/unit/shared/errors.test.ts` and `tests/unit/application/outcomes.test.ts`
- [X] T009 Implement domain errors, request/item outcome types, and bounded operator context in `src/shared/errors.ts` and `src/application/outcomes.ts`
- [X] T010 [P] Write configuration validation tests for required token, every numeric cap/default (text/URL, media, metadata/stdout/stderr, redirects, jobs, stage/job/shutdown lifetimes), 49 MiB upper limit, absolute non-symlink writable temp directory, log level, and defaults in `tests/unit/config/load-config.test.ts`
- [X] T011 [P] Implement startup-only Zod configuration loading and immutable runtime configuration in `src/config/load-config.ts`
- [X] T012 [P] Write logger tests proving correlation/stage fields are retained and tokens, raw URLs, payloads, paths, and process output are redacted in `tests/unit/infrastructure/logger.test.ts`
- [X] T013 [P] Implement the structured Pino logger facade and static redaction policy in `src/infrastructure/logger.ts`
- [X] T014 [P] Write request identifier and deadline/cancellation tests for unique opaque IDs, composed abort signals, and finite stage/job deadlines in `tests/unit/shared/identifiers.test.ts` and `tests/unit/application/deadlines.test.ts`
- [X] T015 [P] Implement opaque request IDs, operation context, deadline composition, and cancellation helpers in `src/shared/identifiers.ts` and `src/application/operation-context.ts`
- [X] T016 [P] Write admission-control tests for FIFO queuing, active/queued limits, deadline expiry, busy mapping, and idempotent permit release in `tests/unit/infrastructure/admission-control.test.ts`
- [X] T017 [P] Implement bounded in-process admission control with no durable queue in `src/infrastructure/admission-control.ts`
- [X] T018 [P] Write temporary-workspace lifecycle tests covering trusted-parent/symlink rejection, unique exclusive names, traversal resistance, partial/rename/create failure, cleanup idempotence, injected deletion failure logging, retry cleanup, and no residual controlled-root files in `tests/unit/infrastructure/temporary-workspace.test.ts`
- [X] T019 [P] Implement request-isolated temporary workspaces, generated item paths, and recursive cleanup in `src/infrastructure/temporary-workspace.ts`
- [X] T020 [P] Write process-runner tests for argument-array execution, shell disabled, exact stdout/stderr caps, timeout, cancellation, non-zero exit, bounded grace/child cleanup, and startup version prerequisite in `tests/unit/infrastructure/process-runner.test.ts`
- [X] T021 [P] Implement the bounded direct-spawn process runner with `shell: false`, controlled cwd/env, output caps, and termination handling in `src/infrastructure/process-runner.ts`
- [X] T022 [P] Write safe URL/HTTP policy tests for HTTPS-only URLs, credentials/ports, DNS/private ranges, relative/missing/malformed/loop/downgrade redirects and revalidation/caps, identity encoding, type/zero body, declared/lying/missing length, exact-one-byte streamed overflow/partial deletion, and timeouts in `tests/unit/infrastructure/safe-http-client.test.ts`
- [X] T023 [P] Implement the Undici-based safe HTTP client with manual redirects, DNS/IP validation, connection pinning, byte counting, and bounded response bodies in `src/infrastructure/safe-http-client.ts`
- [X] T024 Define provider-neutral ports for provider, downloader, processor, delivery, process runner, workspace, admission, and safe HTTP in `src/application/ports.ts`
- [X] T025 Add shared domain types for post references, discovered media, representations, downloaded/prepared media, destinations, limits, and request state in `src/application/models.ts`

**Checkpoint**: Strict build, lint, and unit tests pass before story work begins.

---

## Phase 3: User Story 1 - Receive Video from a Valid Post (Priority: P1) 🎯 MVP

**Goal**: Accept one valid public X/Twitter status URL, discover every supported video item, select a directly deliverable representation, stream it into isolated storage, and deliver each successful item.

**Independent Test**: Run a deterministic end-to-end fixture with fake Telegram, fixture yt-dlp metadata, mocked HTTP responses, and a multi-item post; verify ordered delivery, bounds, cleanup, and no live network.

### Tests for User Story 1 (write first and verify they fail)

- [X] T026 [US1] Create checked-in yt-dlp provider fixtures, deterministic fake ports, injected clock/identifier helpers, and builders required by US1 tests under `tests/fixtures/` and `tests/support/`
- [X] T027 [P] [US1] Write X URL tests for exact ASCII username/status-ID grammar, punctuation/Markdown extraction, malformed/multiple/split tokens, encoded/Unicode lookalikes, query/fragment canonicalization, multiple-token rejection before parsing, and `InvalidUrl` versus `UnsupportedPostUrl` outcomes in `tests/unit/providers/x/x-url.test.ts`
- [X] T028 [P] [US1] Write yt-dlp fixture tests for inaccessible/no-media/rate-limit mapping, supported filtering/source order, malformed/capped/empty/null/duplicate-ID/extreme-metadata output rejection, timeout mapping, and metadata-only canonical-URL process invocation in `tests/unit/providers/x/x-media-provider.test.ts`
- [X] T029 [P] [US1] Write representation-selection tests for progressive HTTPS MP4/direct-send eligibility, video/animation method, total quality ordering with missing metadata, known-size exclusion, unknown-size streaming cap, and no-direct-representation failure in `tests/unit/media/representation-selector.test.ts`
- [X] T030 [P] [US1] Write streaming downloader tests for generated paths, complete safe redirect policy, identity/type/zero-body validation, declared/missing/lying length, exact byte cap and one-byte overflow, midstream disconnect, partial cleanup, and finalized output in `tests/unit/media/safe-media-downloader.test.ts`
- [X] T031 [P] [US1] Write direct processor tests proving compatible MP4 is returned unchanged and incompatible media maps to `MediaProcessingFailed` without FFmpeg in `tests/unit/media/direct-media-processor.test.ts`
- [X] T032 [P] [US1] Write delivery adapter tests for destination isolation, video upload, timeout, Telegram error normalization, and no diagnostic leakage in `tests/unit/bot/telegram-delivery.test.ts`
- [X] T033 [P] [US1] Write application workflow tests for discovery, ordered per-item processing, delivery, permit release, workspace cleanup, provider-output failure mapping, and deterministic shutdown cancellation of queued/active work in `tests/unit/application/download-post-media.test.ts`
- [X] T034 [US1] Write deterministic end-to-end US1 coverage with T026 support, including the SC-002 100-valid-request workload with one-to-four media items at most 1 MiB, maximum concurrency two without queue saturation, injected dependency latency at most 100 ms, monotonic handler-entry-to-terminal timing, nearest-rank p95 at most two minutes, and no live network in `tests/integration/us1-download-video.test.ts` and `tests/acceptance/valid-request-performance.test.ts`

### Implementation for User Story 1

- [X] T035 [US1] Implement strict X/Twitter status URL parsing and canonical post-reference validation in `src/providers/x/x-url.ts`
- [X] T036 [US1] Implement bounded yt-dlp metadata schema validation and provider-neutral mapping in `src/providers/x/yt-dlp-schema.ts`
- [X] T037 [US1] Implement `MediaProvider` and X provider using the process runner, pinned executable configuration, metadata-only arguments, and safe error mapping in `src/providers/media-provider.ts` and `src/providers/x/x-media-provider.ts`
- [X] T038 [US1] Implement deterministic best-first direct-representation selection in `src/media/representation-selector.ts`
- [X] T039 [US1] Implement streamed media downloading through the safe HTTP client with generated workspace files, timeout/cap enforcement, and partial cleanup in `src/media/safe-media-downloader.ts`
- [X] T040 [US1] Implement the direct media processor that validates Telegram-compatible MP4 delivery and never transcodes in `src/media/direct-media-processor.ts`
- [X] T041 [US1] Implement Telegram delivery using grammY API calls, per-item timeout, video upload, and opaque destination handling in `src/bot/telegram-delivery.ts`
- [X] T042 [US1] Implement use-case orchestration, admission/job deadline, item continuation, ordered results, and workspace cleanup in `src/application/download-post-media.ts`
- [X] T043 [US1] Implement grammY long-polling transport with thin handlers, safe outcome mapping, and bounded runner shutdown in `src/bot/telegram-bot.ts` and `src/index.ts`

**Checkpoint**: US1 works end-to-end without live X/Twitter or Telegram and passes lint, typecheck, tests, and build.

---

## Phase 4: User Story 2 - Receive Animated Media (Priority: P2)

**Goal**: Deliver supported animated X media through Telegram animation messages when directly compatible.

**Independent Test**: Feed an animation fixture through the use case and verify ordered animation upload, safe incompatible-media failure, and cleanup.

- [X] T044 [P] [US2] Add animation metadata fixtures and provider tests proving animated items are retained while static images are excluded in `tests/unit/providers/x/x-media-provider-animation.test.ts` and `tests/fixtures/x/animation.json`
- [X] T045 [P] [US2] Add animation selector/direct-compatibility tests in `tests/unit/media/animation-delivery.test.ts`
- [X] T046 [P] [US2] Add animation upload and incompatible-animation integration coverage in `tests/integration/us2-download-animation.test.ts`
- [X] T047 [US2] Extend validated X mapping and domain classification for animation without admitting static images in `src/providers/x/yt-dlp-schema.ts` and `src/providers/x/x-media-provider.ts`
- [X] T048 [US2] Extend selection/preparation to preserve compatible animation metadata without conversion in `src/media/representation-selector.ts` and `src/media/direct-media-processor.ts`
- [X] T049 [US2] Add Telegram animation upload selection and safe failure mapping while preserving video behavior in `src/bot/telegram-delivery.ts`

**Checkpoint**: US1 video behavior remains green and US2 animation fixtures independently complete or return safe processing/delivery failure.

---

## Phase 5: User Story 3 - Understand Invalid or Unsupported Input (Priority: P3)

**Goal**: Reject malformed, multiple, unsupported-domain, and unsupported X/Twitter URLs before retrieval and send category-specific safe guidance.

**Independent Test**: Exercise representative messages with a fake use case/provider and verify no discovery occurs and each category receives the expected response.

- [X] T050 [P] [US3] Write message URL extraction tests for prose, no URL, multiple URLs, split/obscured URLs, and exactly-one-candidate enforcement in `tests/unit/bot/message-url-extractor.test.ts`
- [X] T051 [P] [US3] Write transport tests for `InvalidUrl` and `UnsupportedPostUrl`, including unsupported hosts/paths, multiple-token precedence, and ignored non-text updates with no provider call in `tests/unit/bot/telegram-bot-validation.test.ts`
- [X] T052 [US3] Add deterministic integration coverage for all invalid-input scenarios in `tests/integration/us3-input-validation.test.ts`
- [X] T053 [US3] Add deterministic SC-003 acceptance coverage for 100 invalid/unsupported messages, maximum concurrency two, injected monotonic timing, nearest-rank p95 at most five seconds, fake response latency at most 100 ms, and zero provider/HTTP/filesystem/media calls in `tests/acceptance/input-validation-performance.test.ts`
- [X] T054 [US3] Implement bounded candidate URL extraction without logging or retaining raw message payloads in `src/bot/message-url-extractor.ts`
- [X] T055 [US3] Integrate extraction, provider recognition/validation, ignored non-text updates, and category-specific safe responses in `src/bot/telegram-bot.ts`

**Checkpoint**: Invalid or unsupported messages finish quickly without yt-dlp, HTTP, filesystem, or media calls.

---

## Phase 6: User Story 4 - Receive Actionable Failure Feedback (Priority: P4)

**Goal**: Make retrieval, processing, delivery, timeout, capacity, cleanup, and partial-success paths safe, understandable, recoverable, and isolated.

**Independent Test**: Inject each failure category into fake ports, verify safe mapping and cleanup, then run a later success and concurrent cross-chat isolation test.

- [X] T056 [P] [US4] Write table-driven SC-006 tests for every user-sendable and item-level taxonomy outcome, `ProviderRateLimited`/`ProviderOutputInvalid` safe copy, distinct timeout/cancellation copy, and logged-only/no-send behavior for `DeliveryDestinationUnavailable`/`CleanupFailed`; verify partial status, retry guidance, and diagnostic redaction in `tests/unit/bot/error-mapping.test.ts`
- [X] T057 [P] [US4] Write workflow tests for cancellation before delivery, after one or more deliveries, and during an item; assert safe in-progress stop, no remaining-item attempts, delivered-item preservation, unattempted-cancelled positions, usable-destination partial summary or zero-delivery `OperationCancelled`, cleanup, and permit release in `tests/unit/application/partial-results.test.ts`
- [X] T058 [P] [US4] Write Telegram delivery classification tests proving authoritative blocked/removed/missing/inaccessible/permission-denied destination responses become `DeliveryDestinationUnavailable`, stop later deliveries, preserve prior deliveries, suppress final summary, and log only safe stable context in `tests/unit/bot/telegram-delivery-destination.test.ts`
- [X] T059 [P] [US4] Before implementation, author failing tests for the exact SC-005 100-request fixture in `tests/acceptance/mixed-request-isolation.test.ts`: 40 successes, 15 isolated item failures, 10 no-direct-representation failures, 10 size-boundary cases (5 at limit/5 one byte over), 10 duplicate/resubmission requests as five original/duplicate pairs, 5 timeout partials, 5 cancellation partials, and 5 busy rejections (total 100); use default 2-active/8-queued admission, gate two active requests, fill eight queue slots, submit five and assert `ServiceBusy`, then release and batch the remainder without saturation. Assert workspace/path isolation, chat destination isolation, permits, resource closure, and no residual files. Also author deterministic failing graceful-shutdown lifecycle coverage in `tests/integration/shutdown-lifecycle.test.ts` with fake time/controlled ports: assert stop polling/new admission; cancel queued work; signal active cancellation; abort HTTP; terminate child processes; clean workspaces; release permits; stop runner; honor the configured 30-second grace bound without waiting 30 seconds; and suppress unsafe sends. Preserve existing ordinary-versus-transient Telegram classification and concurrent isolation coverage in `tests/integration/us4-failure-lifecycle.test.ts` and `tests/integration/concurrency-isolation.test.ts`.
- [X] T060 [US4] Create the controlled child-process fixture and process-test support required by integration tests under `tests/fixtures/process/` and `tests/support/process/`
- [X] T061 [US4] Add controlled process integration tests using T060 support for yt-dlp timeout, non-zero exit, malformed/capped output, and cancellation in `tests/integration/process-runner.integration.test.ts`
- [X] T062 [US4] Implement canonical taxonomy normalization and safe mappings, including provider rate-limit/output-invalid categories; classify `DeliveryDestinationUnavailable` only from authoritative permanent destination responses and retain stage-aware safe logging in `src/shared/errors.ts`, `src/bot/telegram-delivery.ts`, and `src/application/download-post-media.ts`
- [X] T063 [US4] Implement per-item results, isolated-failure continuation, request-wide cancellation stop of in-progress/remaining work, destination-unavailable stop of later deliveries, failed-versus-unattempted partial summaries, cleanup/permit release in `finally`, and duplicate-independent execution in `src/application/download-post-media.ts` and `src/application/outcomes.ts`
- [X] T064 [US4] Implement safe Telegram mappings for every user-sendable taxonomy outcome, including `UnsupportedPostUrl`, `ProviderRateLimited`, and `ProviderOutputInvalid`, plus complete/partial/item outcomes; suppress a final summary after `DeliveryDestinationUnavailable` in `src/bot/telegram-bot.ts`
- [X] T065 [US4] Add structured lifecycle logs and cleanup-failure handling with request correlation, stage, item position, duration, stable code, and safe destination-unavailable context without Telegram payloads/tokens/URLs/paths in `src/application/download-post-media.ts`, `src/infrastructure/logger.ts`, and `src/infrastructure/temporary-workspace.ts`
- [X] T066 [US4] Add graceful polling shutdown, active-job cancellation/grace handling, and resource closure in `src/bot/telegram-bot.ts` and `src/index.ts`

**Checkpoint**: Every defined failure is actionable; failed jobs do not crash polling; successes are preserved; later/concurrent jobs stay isolated.

---

## Phase 7: Polish & Cross-Cutting Verification

- [X] T067 [P] Document yt-dlp pinning, installation/licensing considerations, and opt-in live-provider tests in `README.md` and `docs/yt-dlp.md`
- [X] T068 [P] Document SSRF, resource limits, temp ownership, secret handling, and log redaction in `docs/security.md`
- [X] T069 [P] Validate the quickstart from a clean environment and update commands/configuration examples in `specs/001-x-media-download/quickstart.md`
- [X] T070 Run and reconcile deterministic acceptance coverage authored before implementation in T034, T046, T053, and T056–T059 for SC-002/SC-003 timing, the exact SC-005 fixture, all taxonomy mappings, partial/shutdown lifecycle, destination-unavailable no-send behavior, 49 MiB boundary, duplicate updates, isolation, and cleanup in `tests/acceptance/`
- [X] T071 Verify normal tests require no live network and record opt-in integration commands in `README.md`
- [X] T072 Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`; fix defects without weakening strictness or security

---

## Dependencies & Execution Order

### Phase Dependencies

- Setup has no feature dependencies and establishes verification commands.
- Foundational depends on Setup and blocks every story because all use the shared typed ports, configuration, safety, logging, workspace, process, and admission boundaries.
- US1–US4 depend on Foundational. US1 is the MVP; US2–US4 may proceed in parallel after contracts stabilize, subject to shared-file coordination.
- Polish depends on the selected stories and final implementation.

### User Story Dependencies

- US1 starts after Foundational and has no story dependency.
- US2 starts after Foundational and reuses US1 provider/domain/delivery seams while preserving video behavior.
- US3 starts after Foundational and can be tested with a fake use case before transport integration.
- US4 starts after Foundational and exercises the full US1 workflow; complete it before calling the bot production-ready.

### Within Each User Story

- Write tests first and confirm failure before implementation.
- Implement pure parsing/domain logic before adapters, then adapters before application/transport integration.
- Keep application code dependent only on ports/domain values; grammY, yt-dlp, Undici, filesystem, and child-process types stay at boundaries.
- Run each story checkpoint before the next priority increment.

### Parallel Opportunities

- T002–T006 are independent after T001.
- Foundational test/implementation pairs T010–T023 can proceed in separate files; T024–T025 finalize shared contracts before integration.
- T026 creates US1 test support before any fixture-dependent test; T027–T033 are then parallelizable. T035–T041 are parallelizable once ports and fixtures exist, with T042/T043 integrating sequentially.
- US2, US3, and US4 test groups can run in parallel after Foundational, avoiding simultaneous edits to shared integration files.
- T060 creates controlled-process support before T061. T067–T069 are parallelizable; T072 is the final gate.

### Parallel Example: User Story 1

```text
T026 checked-in fixtures, fake ports, clocks, IDs, and builders
T027 URL validation tests
T028 yt-dlp/provider fixture tests
T029 representation selection tests
T030 streaming downloader tests
T031 direct processor tests
T032 Telegram delivery adapter tests
T033 application workflow tests
```

## Implementation Strategy

### MVP First (US1 only)

1. Complete Setup and Foundational.
2. Complete US1 test-first implementation.
3. Run the deterministic US1 integration test and all verification scripts.
4. Stop for a demo/deployment decision before adding later increments.

### Incremental Delivery

1. Add US2 animation delivery while preserving direct-MP4 behavior.
2. Add US3 validation behavior without retrieval for rejected messages; ignore non-text updates and add no optional command behavior.
3. Add US4 partial outcomes, timeouts, cleanup, concurrency isolation, and safe mapping.
4. Complete operational documentation and acceptance fixtures.

### Scope Guardrails

- Do not add provider registries/plugins, databases, persistent history, distributed queues, caching, cloud storage, other platforms, or FFmpeg without a new approved requirement.
- Do not introduce direct Telegram, yt-dlp, or Undici dependencies into the application layer.
- Do not add deduplication state; independent duplicate processing is specified.

## Phase 8: Convergence

- [X] T073 Validate the submitted raw X/Twitter status path before URL normalization can collapse dot segments or other alternate spellings, and add regression tests for normalized paths that must be rejected per FR-002 and Constitution II (contradicts, CRITICAL)
- [X] T074 Replace the grammY upload `AbortSignal` type assertions with a type-safe cancellation adapter and verify native job cancellation reaches both video and animation API requests per Constitution III (contradicts, CRITICAL)
- [X] T075 Bound and abort DNS hostname resolution within the Safe HTTP download deadline, and test stalled resolution and caller cancellation per FR-015 and the Safe HTTP bounds decision (partial, HIGH)
- [X] T076 Include safe category-specific descriptions for failed item positions in failed and partial Telegram outcomes, and test item-bearing outcomes for each taxonomy code, retry guidance, and redaction per SC-006 and FR-013 (partial, HIGH)
- [X] T077 Bring the SC-005 100-request fixture into line with the configured 49 MiB boundary and assert cleanup retry plus HTTP/process resource closure without residual files per SC-005 and T059 (partial, HIGH)
- [X] T078 Measure SC-002 acceptance from Telegram handler entry through terminal delivery or feedback using an injected monotonic clock and fake Telegram completion per SC-002 and T034 (partial, HIGH)
- [X] T079 Compare the startup yt-dlp version with an explicit approved deployment version and prevent polling on mismatch per the yt-dlp startup pin decision (partial, HIGH)
- [X] T080 Map temporary workspace creation failures to safe request feedback while keeping `CleanupFailed` secondary and logged-only per FR-013, FR-017, and the workspace lifecycle decision (partial, HIGH)
- [X] T081 Enforce `MAX_OPEN_DOWNLOADS` in runtime media-stream admission, or remove the ineffective setting through the configuration contract, per FR-015 and the resource limits decision (partial, MEDIUM)

## Phase 9: Convergence

- [X] T082 Strengthen the SC-005 100-request fixture with controlled HTTP/process resource doubles and a fake monotonic clock, and assert acquisition/closure, per-request delivery destinations, and terminal timing per SC-005 and T059 (partial)
- [X] T083 Assert downloader, processor, and delivery boundaries are never called for invalid or unsupported input per SC-003 and T053 (partial)
- [X] T084 Verify cancellation reaches both video and animation API wrapper calls through the grammY signal bridge per Constitution III and T074 (partial)
- [X] T085 Extend the SC-006 outcome copy matrix to assert retry advice for each retryable outcome and its absence for every non-retryable outcome per SC-006 and T056 (partial)

## Phase 10: Convergence

- [X] T086 Document the `abort-controller` production dependency rationale and compare the Node.js built-in alternative in the plan, or remove the dependency if unnecessary, per Constitution V (partial)
- [X] T087 Add malformed sole-URL messages to the SC-003 timed acceptance workload per SC-003 and T053 (partial)
- [X] T088 Exercise the production Undici request/dispatcher path with MockAgent and verify validated-address binding, abort, and response closure without live network per FR-004, FR-015, and plan: Safe HTTP testing (partial)
- [X] T089 Replace SC-005 synthetic resource counters with controlled HTTP response and child-process doubles whose close/termination calls are observed per SC-005 and T082 (partial)
- [X] T090 Reconcile the `MediaProvider` contract location with the plan's `src/providers/media-provider.ts` architecture touchpoint per T037 and plan: Source Code structure (partial)
- [X] T091 Add `YT_DLP_EXPECTED_VERSION` and its startup comparison behavior to the plan's configuration contract per plan: Configuration and Operations (partial)
