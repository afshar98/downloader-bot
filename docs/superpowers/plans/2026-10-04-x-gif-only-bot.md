# X GIF-Only Telegram Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing downloader with a small Telegram bot that turns animated media from one public X status into a verified GIF and sends only that GIF to the originating chat.

**Architecture:** Keep a typed application flow between Telegram, a strict X URL parser, a `yt-dlp` extractor, bounded media retrieval, FFmpeg conversion, GIF validation, and a GIF-only Telegram delivery adapter. Use local request workspaces, environment configuration, dependency-injected external boundaries, and no database or webhook server.

**Tech Stack:** Node.js 24, TypeScript, grammY long polling, local pinned `yt-dlp` and FFmpeg executables, Vitest, ESLint, npm.

**Spec:** `docs/superpowers/specs/2026-10-04-x-gif-only-bot-design.md`

## Global Constraints

- Accept only HTTPS status URLs on `x.com`, `www.x.com`, `twitter.com`, and `www.twitter.com`.
- Deliver verified GIFs through Telegram `sendAnimation`; never call or expose `sendVideo`.
- Reject non-GIF output even when its file name or metadata claims it is a GIF.
- Invoke local executables with argument arrays, fixed options, timeouts, bounded output, and no shell.
- Bound concurrent work, download size, conversion time, GIF dimensions, and GIF output size.
- Remove per-request temporary media on success, failure, timeout, and shutdown.
- Do not log bot tokens, full user messages, media URLs, or local temporary paths.
- Preserve Git history, repository instructions, and the ignored local `.env` during the reset.
- Do not add database, Redis, webhook, X credentials, user accounts, video delivery, or generic media support.

## Review Focus

- A lookalike X hostname, credentials, a non-default port, or a malformed numeric status path must be rejected before extraction; Task 2 tests each class.
- A message containing multiple candidate URLs must not silently choose one; Task 2 tests it.
- Extractor output or redirects that resolve to a private or disallowed destination must fail safely; Task 3 tests the destination policy.
- A non-GIF, corrupt, empty, truncated, or oversized conversion output must never reach Telegram; Task 4 tests the GIF validator and limits.
- Cancellation or cleanup failure must not strand a child process, workspace, or admission slot; Tasks 3 and 5 test cancellation, cleanup, and shutdown behavior.

---

### Task 1: Replace the existing project with the minimal application foundation

**Files:**
- Delete: existing `src/**`, `tests/**`, obsolete `specs/**`, and obsolete product docs under `docs/**` (retain this approved spec, this plan, and repository-level `AGENTS.md`).
- Modify: `package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.build.json`, `eslint.config.mjs`, `.env.example`, `README.md`
- Create: `src/config.ts`, `src/errors.ts`, `src/application.ts`
- Test: `tests/config.test.ts`, `tests/application.test.ts`

**Interfaces:**
- Produces: `Config` with `telegramToken`, `ytDlpPath`, `ytDlpExpectedVersion`, `ffmpegPath`, `ffmpegExpectedVersion`, `maxMediaBytes`, `maxGifBytes`, `maxConcurrentJobs`, and `jobTimeoutMs`; `loadConfig(env: NodeJS.ProcessEnv): Config`; `AppError` with stable safe codes; domain result/media types; `RequestInput = { canonicalUrl: string; chatId: string }`; and an injectable `createApplication(dependencies): { handleRequest(input: RequestInput, signal: AbortSignal): Promise<RequestResult> }` contract.
- `RequestResult` is one of `delivered`, `invalid-url`, `unsupported-url`, `inaccessible`, `no-animation`, `failed`, or `cancelled`.

- [ ] **Step 1: Write failing configuration and application contract tests**

Assert required token, executable paths, and expected executable versions; positive bounded numeric limits; clear missing-config failures; and that application construction accepts injected ports without starting network or child processes.

- [ ] **Step 2: Run the focused tests and confirm they fail for missing modules/contracts**

Run: `npm test -- --run tests/config.test.ts tests/application.test.ts`
Expected: FAIL because the new modules do not exist.

- [ ] **Step 3: Replace project scaffolding and implement minimal config/error/application contracts**

Use pinned direct dependencies for grammY and runtime schema validation only if the tests demonstrate a need; retain TypeScript, Vitest, and lint tooling. Keep limits finite, defaults conservative, and environment names documented in `.env.example` without real credentials. Remove obsolete multi-mode video behavior, fixtures, and docs, but leave `.env`, `.git`, `.worktrees`, and `AGENTS.md` untouched.

- [ ] **Step 4: Run focused checks**

Run: `npm test -- --run tests/config.test.ts tests/application.test.ts && npm run typecheck && npm run lint && npm run build`
Expected: all commands pass; the build emits only ignored `dist/` output.

- [ ] **Step 5: Inspect and commit the reset checkpoint**

Review deletions and replacements explicitly; ensure `.env`, `.git`, `.worktrees`, and `AGENTS.md` are absent from the staged change. Commit as `refactor(project): replace downloader with GIF-only foundation`.

### Task 2: Validate X status links and handle Telegram messages

**Files:**
- Create: `src/x-url.ts`, `src/telegram-bot.ts`
- Modify: `src/application.ts`, `src/errors.ts`
- Test: `tests/x-url.test.ts`, `tests/telegram-bot.test.ts`, `tests/application.test.ts`

**Interfaces:**
- Consumes: Task 1 `Config`, `AppError`, and `createApplication`.
- Produces: `parseXStatusUrl(candidate: string): { canonicalUrl: string; statusId: string }`; a bot factory that accepts injected Telegram API and application dependencies and registers long polling only from `src/index.ts`.

- [ ] **Step 1: Write failing URL parser tests**

Cover accepted four hosts, case-insensitive hostnames, query/fragment removal, and rejection of HTTP, mobile/short/lookalike domains, credentials, ports, malformed IDs, and non-status paths.

- [ ] **Step 2: Run URL tests and confirm they fail**

Run: `npm test -- --run tests/x-url.test.ts`
Expected: FAIL because the parser does not exist.

- [ ] **Step 3: Implement canonical X status parsing**

Parse with `URL`, compare normalized hostnames against the exact allowlist, require HTTPS/default port and a numeric status path, and return only the canonical status URL with query and fragment removed.

- [ ] **Step 4: Write failing Telegram and application flow tests**

Cover zero URL, multiple HTTP(S)-style candidates, malformed sole URL, unsupported URL, and one accepted URL. Assert invalid inputs do not call the extractor/application media port and receive a concise safe reply.

- [ ] **Step 5: Implement message extraction, replies, and bot factory**

Select exactly one candidate URL token; never choose one from multiple tokens. Keep Telegram construction injectable so tests do not poll or contact Telegram.

- [ ] **Step 6: Run Task 2 checks and commit**

Run: `npm test -- --run tests/x-url.test.ts tests/telegram-bot.test.ts tests/application.test.ts && npm run typecheck && npm run lint`
Expected: all pass. Commit as `feat(bot): accept validated X status links`.

### Task 3: Extract animated media with a bounded local provider

**Files:**
- Create: `src/process-runner.ts`, `src/x-media-provider.ts`, `src/media-downloader.ts`, `src/temporary-workspace.ts`
- Modify: `src/config.ts`, `src/application.ts`, `src/errors.ts`
- Test: `tests/process-runner.test.ts`, `tests/x-media-provider.test.ts`, `tests/media-downloader.test.ts`
- Fixtures: `tests/fixtures/x-animation.json`, `tests/fixtures/x-no-animation.json`, `tests/fixtures/x-invalid.json`

**Interfaces:**
- Consumes: Task 1 `Config`/`AppError`; Task 2 canonical X status URL.
- Produces: `ProcessRunner.run({ executable, args, cwd, signal, timeoutMs, maxStdoutBytes, maxStderrBytes }): Promise<{ exitCode: number; stdout: string; stderr: string }>`; `XMediaProvider.getAnimation(statusUrl, signal): Promise<SourceMedia>`; `MediaDownloader.download(source, destination, signal): Promise<{ path: string; sizeBytes: number }>`; `createTemporaryWorkspace(): Promise<RequestWorkspace>`, where `RequestWorkspace` exposes `rootPath`, `sourcePath`, `partialGifPath`, `gifPath`, and async idempotent `dispose()`.
- `SourceMedia` contains only a validated progressive source URL, expected container, and safe display metadata; it has no Telegram delivery kind.

- [ ] **Step 1: Write failing process-runner tests**

Use a controlled child fixture to verify argument-array invocation without a shell, output caps, timeout, abort termination, and non-zero exit mapping.

- [ ] **Step 2: Implement the bounded process runner**

Enforce per-stream byte caps while reading, terminate the child on timeout/abort, and expose only sanitized application errors to callers.

- [ ] **Step 3: Write failing provider schema and destination tests**

Cover valid animated X metadata, no-animation metadata, malformed JSON, malformed format entries, and direct media URLs that resolve or redirect to loopback, private, link-local, or non-HTTPS destinations.

- [ ] **Step 4: Implement `XMediaProvider.getAnimation`**

Run the configured pinned `yt-dlp` with fixed no-plugin/no-config options and JSON output. Validate the response shape and select an eligible progressive MP4 representation. Validate every media destination and redirect against the safe public HTTPS destination policy before retrieval. Map inaccessible and no-animation cases to distinct `RequestResult` values.

- [ ] **Step 5: Write failing media download tests**

Cover allowed HTTPS redirects, rejected private-network redirects, non-success status, cancellation, declared/streamed size over limit, and truncated streams.

- [ ] **Step 6: Implement bounded media retrieval and workspace ownership**

Stream into a unique mode-0700 request workspace, enforce actual bytes while streaming, and expose cleanup through an idempotent `dispose()` owned by the request scope.

- [ ] **Step 7: Run Task 3 checks and commit**

Run: `npm test -- --run tests/process-runner.test.ts tests/x-media-provider.test.ts tests/media-downloader.test.ts && npm run typecheck && npm run lint`
Expected: all pass. Commit as `feat(x-provider): extract animated media safely`.

### Task 4: Convert source media into a verified bounded GIF

**Files:**
- Create: `src/gif-converter.ts`, `src/gif-validator.ts`
- Modify: `src/config.ts`, `src/application.ts`
- Test: `tests/gif-converter.test.ts`, `tests/gif-validator.test.ts`
- Fixtures: `tests/fixtures/media/source.mp4`, `tests/fixtures/media/valid.gif`, `tests/fixtures/media/not-gif.mp4`, `tests/fixtures/media/empty.gif`

**Interfaces:**
- Consumes: Task 3 `SourceMedia`, downloaded source path, `ProcessRunner`, and `RequestWorkspace`.
- Produces: `GifConverter.convert(sourcePath, partialPath, gifPath, signal): Promise<GifMedia>` and `GifValidator.validate(path, signal): Promise<{ width: number; height: number; frameCount: number }>`.
- `GifConverter` owns the convert → validate → atomic rename sequence. `GifMedia` is `{ path: string; sizeBytes: number; width: number; height: number; frameCount: number; container: 'gif' }`; only this verified type can be passed to Task 5 delivery.

- [ ] **Step 1: Write failing GIF validator tests**

Assert valid GIF87a/GIF89a decode, and reject MP4 bytes renamed `.gif`, empty, truncated, corrupt, single-frame/non-animated, over-dimension, and over-size files.

- [ ] **Step 2: Implement GIF structural and decode validation**

Check the GIF signature and use the configured trusted FFmpeg executable to decode/probe the complete output under fixed timeout/output limits. Enforce configured byte and pixel bounds and require at least two frames.

- [ ] **Step 3: Write failing converter tests**

Use an injected process runner to assert fixed deterministic GIF conversion arguments, validated GIF finalization, and cleanup/rejection on timeout, non-zero exit, missing output, or oversized output.

- [ ] **Step 4: Implement bounded FFmpeg conversion**

Convert into the temporary partial path inside the request workspace with FFmpeg's output size cap, fixed maximum dimensions and frame rate. Decode and validate the full partial output, then atomically rename it to the delivery path. Never rename or pass through source bytes as a GIF.

- [ ] **Step 5: Run Task 4 checks and commit**

Run: `npm test -- --run tests/gif-converter.test.ts tests/gif-validator.test.ts && npm run typecheck && npm run lint`
Expected: all pass. Commit as `feat(media): convert animated sources to verified GIFs`.

### Task 5: Deliver only GIFs and manage request lifecycle

**Files:**
- Create: `src/telegram-delivery.ts`, `src/index.ts`, `src/admission-control.ts`, `src/shutdown.ts`, `src/tool-checks.ts`
- Modify: `src/application.ts`, `src/telegram-bot.ts`, `src/config.ts`, `README.md`, `.env.example`
- Test: `tests/telegram-delivery.test.ts`, `tests/lifecycle.test.ts`, `tests/application.integration.test.ts`

**Interfaces:**
- Consumes: Task 2 bot factory; Task 3 `XMediaProvider`, `MediaDownloader`, and `RequestWorkspace`; Task 4 converter and `GifMedia`.
- Produces: `GifDelivery.sendAnimation(chatId: string, media: GifMedia, signal: AbortSignal): Promise<void>`; tool checks that compare each configured executable's reported version token to its expected value; startup/shutdown entry points that validate configured tools before polling and stop polling, abort active work, await cleanup, then exit.

- [ ] **Step 1: Write failing delivery tests**

Assert a valid `GifMedia` calls Telegram `sendAnimation` with the GIF path, and invalid artifact typing/validation prevents all Telegram media calls. The fake API must expose no `sendVideo` method.

- [ ] **Step 2: Implement GIF-only Telegram adapter and safe outcome replies**

Construct `InputFile` from the verified GIF path and invoke only `sendAnimation`. Map stable application outcomes to short user messages without exposing provider errors, URLs, paths, or tool output.

- [ ] **Step 3: Write failing application integration and admission tests**

Cover one successful message through validated URL → extraction → download → GIF conversion/validation → animation upload; no-animation, conversion failure, Telegram failure, concurrent cap, cancellation, and cleanup after every terminal result.

- [ ] **Step 4: Implement bounded request orchestration and graceful shutdown**

Acquire admission before workspace creation, enforce one request deadline, release admission and dispose workspace in `finally`, abort active child/network work on shutdown, and do not start new polling work during shutdown.

- [ ] **Step 5: Implement startup checks and deployment documentation**

Load `.env` only for local development, compare `yt-dlp` and FFmpeg version tokens to configured expected values before polling, document Node/npm and tool prerequisites, setup, environment variables, resource limits, and verification commands. Do not include a real bot token.

- [ ] **Step 6: Run Task 5 focused checks and commit**

Run: `npm test -- --run tests/telegram-delivery.test.ts tests/lifecycle.test.ts tests/application.integration.test.ts && npm run typecheck && npm run lint && npm run build`
Expected: all pass. Commit as `feat(telegram): deliver verified GIF animations`.

### Task 6: Remove obsolete assets and complete feature verification

**Files:**
- Modify: `README.md`, `.env.example`, `package.json`
- Remove any obsolete files identified during reset that are no longer referenced.
- Test: complete `tests/**` suite and optional local FFmpeg integration suite.

**Interfaces:**
- Consumes: complete GIF-only application and all existing task contracts.
- Produces: documented reproducible setup and a clean, buildable repository with no video-delivery code path.

- [ ] **Step 1: Search source and docs for obsolete video delivery and old project claims**

Run: `rg -n "sendVideo|sendDocument|video downloader|silent MP4|sendVideo\(" src tests README.md docs package.json`
Expected: `sendVideo` appears only in tests/assertions that prove it is absent or never invoked; obsolete feature text and dead files are removed.

- [ ] **Step 2: Run the complete verification suite**

Run: `npm test && npm run lint && npm run typecheck && npm run build`
Expected: all commands pass.

- [ ] **Step 3: Run the real-FFmpeg integration lane when the configured approved executable is available**

Run: `npm run test:ffmpeg`
Expected: fixture converts to a valid animated GIF and the delivery test observes only the GIF artifact. If the local approved executable is unavailable, report this lane as not run; it must not be silently skipped by CI.

- [ ] **Step 4: Review the final diff and create any needed focused remediation commits**

Inspect every remaining tracked/untracked file and ensure `.env`, `.git`, `.worktrees`, `node_modules`, downloaded media, and generated output are not staged. Re-run affected checks after remediation. Do not squash implementation commits.

- [ ] **Step 5: Confirm final repository state**

Run: `git status --short && git log --oneline -8`
Expected: no intended implementation changes remain uncommitted, the commit sequence is coherent, and there is no push or rewritten history.
