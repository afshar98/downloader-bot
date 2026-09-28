<!--
Sync Impact Report
- Version change: template (unratified) -> 1.0.0
- Modified principles:
  - Placeholder Principle 1 -> I. Explicit Layer Boundaries
  - Placeholder Principle 2 -> II. Security and Resource Safety
  - Placeholder Principle 3 -> III. Strict Types and Validated Boundaries
  - Placeholder Principle 4 -> IV. Test-Driven, Deterministic Quality
  - Placeholder Principle 5 -> V. Simplicity and Maintainability
- Added sections:
  - Engineering Constraints
  - Development Workflow and Verification
- Removed sections: none
- Follow-up TODOs: none
-->
# Telegram Media Downloader Bot Constitution

## Core Principles

### I. Explicit Layer Boundaries
The system MUST maintain explicit boundaries between Telegram transport, application workflows,
platform providers, media downloading and processing, and infrastructure. Telegram handlers MUST
remain thin: they translate Telegram updates into application-level requests and translate results
back into Telegram responses. Business logic MUST NOT live in handlers, and core application logic
MUST NOT depend directly on Telegram APIs.

Platform-specific discovery and extraction MUST be isolated behind provider contracts. Provider
payloads and X/Twitter-specific behavior MUST NOT leak into core workflows. Supporting another
platform SHOULD primarily require a new provider implementation and registration, not changes to
unrelated core logic. Media discovery, downloading, and processing MUST remain separate concerns so
each can be tested, replaced, and secured independently. Modules MUST be small, focused, and have a
clear responsibility and interface. These boundaries keep transport and vendor changes local.

### II. Security and Resource Safety
All external input MUST be treated as untrusted, including Telegram messages, URLs, redirects,
filenames, provider responses, and media metadata. Inputs MUST be validated at the boundary where
they enter a trusted layer. Network access MUST defend against SSRF, unsafe redirect chains,
malicious URLs, and access to disallowed local or private resources. Failures MUST be represented
with structured, useful errors without exposing sensitive internals.

Secrets, including Telegram bot tokens, MUST NOT be committed, logged, or included in user-facing
errors. Temporary files and external resources MUST be cleaned up after success, failure,
cancellation, and timeout. Downloads and processing MUST have explicit size, time, concurrency, and
other appropriate resource bounds. Large media MUST use streaming or temporary-file techniques when
practical instead of being loaded entirely into memory. Timeout, retry, cancellation, and terminal
failure behavior MUST be explicit; retries MUST be bounded and limited to failures known to be safe
to retry.

External programs MUST be launched through structured process APIs with separately supplied
arguments. Shell command strings MUST NOT be built by concatenating untrusted input. Executable
paths, arguments, working directories, environment variables, exit status, timeouts, and process
cleanup MUST be controlled explicitly. These rules apply in particular to media tools such as
FFmpeg and exist to prevent command injection and resource leakage.

### III. Strict Types and Validated Boundaries
TypeScript strict mode is mandatory. `any` MUST NOT be used except for an exceptional case with a
documented justification. `unknown` values MUST be narrowed safely before use. Type assertions MUST
NOT be used merely to silence compiler errors, and TypeScript configuration MUST NOT be weakened to
make an implementation compile.

External data MUST be validated at system boundaries before it becomes trusted application data.
Domain models SHOULD be distinct from Telegram, provider, process, and other third-party payloads
where that separation prevents vendor details from entering the domain. Configuration MUST be
explicit, validated at startup, and fail clearly when required values are absent or invalid.
Environment variables MUST be read through a controlled configuration boundary rather than
throughout business logic. These constraints make invalid states visible early and keep external
contracts from silently shaping the core model.

### IV. Test-Driven, Deterministic Quality
Every behavioral change MUST follow red-green-refactor: understand the behavior; write or update a
test; confirm it fails for the expected reason; implement the minimum necessary code; make it pass;
refactor with tests green; then run all verification gates. Bug fixes MUST include a regression test
whenever practical. If a regression test is impractical, the change record MUST explain why.

Tests MUST be deterministic. Unit tests MUST NOT depend on live Telegram or social-media services,
network access, wall-clock time, uncontrolled randomness, or external binaries. A test may use such
a dependency only when explicitly categorized as an integration or end-to-end test with controlled
setup and teardown. External dependencies MUST sit behind boundaries that permit controlled test
doubles. Tests SHOULD verify observable behavior through stable boundaries and MUST NOT excessively
mock internal implementation details. This workflow proves both the requested behavior and the
test's ability to detect its absence.

### V. Simplicity and Maintainability
Implementations MUST favor straightforward, readable code over cleverness. Abstractions MUST solve
a concrete architectural boundary or demonstrated duplication or variation; they MUST NOT be added
for hypothetical future requirements. The design MUST avoid premature generalization, unnecessary
wrapper layers, and complex inheritance hierarchies. Composition SHOULD be preferred where it keeps
responsibilities and dependencies explicit.

Dependencies MUST be minimal, actively maintained, and justified by concrete value that exceeds
their security, operational, and maintenance cost. Existing project conventions MUST be reused
before introducing new patterns. Changes MUST optimize for code that another engineer or AI agent
can understand, test, and safely modify. Git changes MUST remain small and focused, and feature work
MUST NOT include unrelated modifications. These constraints reduce accidental complexity without
blocking abstractions demanded by the explicit layer boundaries in Principle I.

## Engineering Constraints

- The bot, application, provider, media-processing, and infrastructure layers MUST communicate
  through explicit interfaces and MUST NOT bypass their declared boundaries.
- Providers MUST own platform-specific URL recognition and media discovery or extraction. Core
  workflows MUST consume provider-neutral application models.
- Downloading MUST be separate from discovery or extraction, and processing MUST be separate from
  both. Implementations MAY combine deployment units, but MUST preserve these code boundaries.
- Errors MUST retain actionable diagnostic context for operators while mapping to safe,
  non-sensitive messages for users. Expected failure categories MUST be distinguishable without
  parsing arbitrary message strings.
- Configuration and secrets MUST have documented names and validation rules. Secret values MUST be
  redacted from logs, diagnostics, test snapshots, and exceptions.
- Temporary storage MUST use controlled locations and collision-safe names. Ownership and cleanup
  responsibilities MUST be explicit and exercised on every exit path.
- Resource limits, network policy, redirect policy, timeouts, retry rules, and external-process
  behavior MUST be selected and documented in the relevant feature specification or technical plan.
  This constitution requires those decisions but does not prescribe premature values or tools.
- A new production dependency MUST include a rationale and consideration of a simpler standard
  library or existing-project alternative.

## Development Workflow and Verification

Work MUST begin from an understood requirement or specification and remain limited to its stated
scope. Plans and reviews MUST identify affected boundaries, untrusted inputs, failure paths,
resource ownership, and test strategy. Implementation MUST follow the test-driven workflow in
Principle IV. Commits and reviewable diffs SHOULD each represent one coherent change.

No task, feature, bug fix, or refactor is complete until every applicable repository verification
gate passes. At minimum, lint, TypeScript typecheck, automated tests, and build MUST pass using the
repository's actual package scripts and commands. If a required command does not exist, the missing
project capability MUST be reported explicitly; verification MUST NOT be invented or implied.

Tests MUST NOT be deleted, skipped, weakened, or rewritten merely to make verification pass. A test
may change when it is demonstrably incorrect, provided the reason is documented. Lint, TypeScript,
security, or other quality rules MUST NOT be disabled merely to bypass a failure. An agent MUST NOT
claim completion while any applicable gate fails.

Before declaring completion, the implementer MUST review the final diff and confirm that:

- the requested behavior is implemented and covered by relevant tests;
- expected failure paths, cancellation, and cleanup are handled;
- security implications and bounded resource usage were considered;
- secrets are neither exposed nor introduced;
- no unrelated changes are present;
- documentation and specifications are updated when required; and
- every applicable verification gate passes.

## Governance

This constitution is the project's highest engineering authority. Feature specifications, plans,
implementation decisions, reviews, and agent instructions MUST comply with it. If another project
document or established convention conflicts with this constitution, the conflict MUST be surfaced
and resolved explicitly before affected work proceeds; it MUST NOT be resolved silently.

Amendments MUST be proposed as a focused documentation change that states the rationale, affected
principles, compatibility impact, and any migration or follow-up work. Adoption requires explicit
project-owner approval. The constitution uses semantic versioning: MAJOR for removal or incompatible
redefinition of governance; MINOR for a new principle or materially expanded obligation; PATCH for
clarifications and non-semantic refinements. The ratification date remains the original adoption
date, and the last-amended date changes whenever governance content changes.

Every specification and plan MUST include a constitution compliance check. Every code review and
completion review MUST verify the applicable principles and gates. Any exception MUST be explicit,
time-bounded where practical, justified in writing, and approved by the project owner; exceptions
MUST NOT weaken the prohibitions on exposing secrets, unsafe input handling, command injection, or
false completion claims. Reviewers MUST reject unexplained complexity or boundary violations.

**Version**: 1.0.0 | **Ratified**: 2026-09-28 | **Last Amended**: 2026-09-28
