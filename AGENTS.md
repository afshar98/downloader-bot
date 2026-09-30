## Incremental Autonomous Git Commit Policy

The agent is authorized and expected to create Git commits autonomously throughout implementation.

Do not wait until the entire feature is complete before creating commits.

Commits must represent meaningful, independently understandable implementation checkpoints.

The goal is to maintain a clean, useful Git history while allowing the agent to work autonomously without requiring user confirmation for every commit.

### Core Rule

Continuously identify logical commit boundaries while implementing work.

When a coherent unit of work is complete and sufficiently verified, commit it before proceeding to the next independent unit of work.

A multi-stage feature should normally produce multiple meaningful commits.

Do NOT collapse an entire multi-stage feature into one large commit merely because all changes belong to the same feature.

At the same time, do NOT create a commit for every individual file, test, or mechanical implementation step.

The desired model is:

`many implementation tasks → several coherent engineering checkpoints → several meaningful commits`

Not:

`one task → one commit`

And not:

`entire multi-stage feature → one giant commit`

---

### Determining Logical Commit Boundaries

Use all available project context to determine commit boundaries, including:

- Spec Kit specification
- Spec Kit implementation plan
- Spec Kit task dependencies
- architecture and module boundaries
- dependency relationships
- implementation order
- actual code changes
- tests associated with those changes

A logical commit should represent one coherent engineering capability or change.

Typical commit boundaries include:

- project/tooling setup
- configuration infrastructure
- domain models or contracts
- provider interfaces
- provider implementations
- input validation
- schema validation
- infrastructure adapters
- security boundaries
- SSRF protection
- process execution boundaries
- download pipelines
- representation selection
- admission/concurrency control
- delivery behavior
- lifecycle/shutdown behavior
- observability/error handling
- a distinct bug fix
- documentation directly associated with a completed capability

These are examples, not mandatory commit categories.

The agent must determine boundaries from the actual implementation.

---

### Relationship to Spec Kit Tasks

A Spec Kit task is NOT automatically a Git commit.

Do not mechanically create one commit per task.

Multiple tightly related Spec Kit tasks should be grouped into one logical commit when they collectively implement one capability.

For example, tasks such as:

- create provider interface
- define provider result schema
- implement provider
- add provider tests

may collectively form:

`feat(x-provider): add X media extraction provider`

A subsequent group implementing the HTTP download boundary may form:

`feat(download): add safe media download pipeline`

A subsequent group implementing Telegram delivery may form:

`feat(telegram): deliver downloaded media`

Use the task dependency graph and architecture to determine when one logical unit ends and another begins.

Completion of the entire feature before creating any commits is NOT the default behavior.

If several independently understandable implementation checkpoints exist, commit them incrementally as they are completed.

---

### Implementation and Tests Belong Together

Tests that directly verify newly introduced behavior belong in the same commit as that behavior.

Prefer:

`feat(x-provider): validate X status URLs`

containing:

- URL validation implementation
- unit tests
- integration tests directly verifying that validation

Do NOT normally create:

`feat(x-provider): validate X status URLs`

followed by:

`test(x-provider): add URL validation tests`

when those tests are part of implementing the same capability.

A separate `test` commit is appropriate only when the change genuinely adds or improves tests without introducing or fixing production behavior.

---

### Commit Timing

During implementation, after completing a logical unit of work:

1. Run the tests relevant to that unit.
2. Run lint when applicable.
3. Run type checking when applicable.
4. Run the production build when the change materially affects build behavior or when required by project policy.
5. Inspect `git status`.
6. Inspect tracked and untracked changes.
7. Inspect the relevant working-tree diff.
8. Determine exactly which files belong to the logical unit.
9. Stage only those files.
10. Inspect `git diff --cached --stat`.
11. Inspect `git diff --cached`.
12. Run `git diff --cached --check`.
13. Confirm that the staged snapshot contains the complete logical unit.
14. Confirm that unrelated changes are not staged.
15. Create the commit.
16. Inspect the resulting repository state.
17. Continue implementation from the new checkpoint.

Do not wait until final feature verification to create all implementation commits.

---

### Commit Gates

A logical unit may be committed autonomously when:

1. The logical unit is complete.
2. Changes are limited to the intended scope of that unit.
3. Relevant tests pass.
4. Lint passes when applicable.
5. Type checking passes when applicable.
6. Production build passes when required.
7. No known Critical, High, or Medium defect remains in that logical unit.
8. The working-tree diff has been inspected.
9. The staged diff has been inspected.
10. `git diff --cached --check` passes.
11. No secrets, credentials, generated junk, temporary files, dependency directories, logs, or unrelated files are staged.
12. The staged snapshot is independently understandable and represents a coherent engineering change.

The complete project verification suite does not necessarily need to run before every small logical checkpoint if targeted verification plus lint/typecheck provides sufficient confidence.

However, the complete verification suite MUST run at feature completion.

---

### Staging Policy

Never blindly stage the entire working tree when its contents have not been classified.

Avoid blindly using:

`git add .`

or:

`git add -A`

when unrelated or unclassified changes may exist.

Before staging, determine the intended commit scope.

Prefer explicit staging of files or directories belonging to the logical unit.

Before committing, inspect:

`git status --short`

`git diff --cached --stat`

`git diff --cached`

`git diff --cached --check`

Also inspect the remaining unstaged changes to ensure that:

- nothing belonging to the current logical unit was accidentally omitted
- unrelated future work remains unstaged
- temporary or unsafe files remain excluded

---

### Repository Safety

Never commit:

- real `.env` files
- API tokens
- passwords
- credentials
- cookies
- session data
- private keys
- downloaded media
- temporary application workspaces
- dependency directories such as `node_modules`
- generated build output unless intentionally version-controlled
- coverage output unless intentionally version-controlled
- debug logs
- editor metadata
- operating-system metadata
- unrelated personal files
- unrelated changes from another task

Example environment files containing placeholders, such as `.env.example`, may be committed when intentionally part of the project.

If a potentially sensitive file is discovered, do not print its secret contents.

---

### Commit Message Generation

The agent must generate commit messages autonomously from the actual staged diff.

Do not ask the user to provide or choose routine commit messages.

Commit messages must follow Conventional Commits:

`<type>(<optional-scope>): <description>`

Choose the type according to the primary purpose of the staged change.

Use:

- `feat` — new user-facing or system capability
- `fix` — bug fix
- `refactor` — behavior-preserving restructuring
- `test` — test-only change
- `docs` — documentation-only change
- `chore` — tooling, configuration, dependency, or maintenance work when no more specific type applies
- `perf` — performance improvement
- `build` — build-system or build-dependency changes when appropriate
- `ci` — CI/CD-specific changes

Use a scope when a clear subsystem, provider, feature, or architectural area exists.

Examples:

`chore(project): configure TypeScript tooling`

`feat(config): add validated runtime configuration`

`feat(x-provider): validate X status URLs`

`feat(x-provider): add yt-dlp media extraction`

`feat(media): select compatible representations`

`feat(download): add SSRF-safe media streaming`

`feat(download): add admission and deadline controls`

`feat(telegram): deliver downloaded media`

`feat(bot): handle media download requests`

`feat(lifecycle): add graceful shutdown`

`fix(download): preserve timeout errors across abort boundaries`

Do not invent a scope when no meaningful scope exists.

---

### Commit Message Quality

Commit subjects must be:

- concise
- imperative
- specific
- derived from the actual staged change
- understandable without reading the entire diff

Never use vague commit messages such as:

- `update`
- `changes`
- `fix stuff`
- `work`
- `wip`
- `misc`
- `misc changes`
- `updates`
- `cleanup`

Do not use workflow-oriented messages such as:

- `fix review findings`
- `address review`
- `apply feedback`
- `fix tests`
- `fix lint`

Describe the actual engineering change instead.

For example, prefer:

`fix(download): preserve timeout errors across abort boundaries`

instead of:

`fix: address review feedback`

---

### Commit Bodies

A commit body is optional.

Add one when it provides useful context that is not obvious from the subject, such as:

- important architectural reasoning
- security behavior
- compatibility constraints
- lifecycle semantics
- non-obvious tradeoffs
- intentional limitations

Do not add a body merely to make the commit look more detailed.

Do not mention:

- AI
- Codex
- prompts
- agents
- generated code
- review conversations

unless the repository explicitly requires such attribution.

---

### Review Remediation

If review discovers a defect in behavior that has already been committed, fix it in a new logical commit.

For example:

`fix(download): preserve timeout errors across abort boundaries`

or:

`fix(media): reject incompatible animation representations`

Do not create generic remediation commits such as:

`fix: review findings`

If multiple review findings affect the same underlying logical boundary and are naturally one fix, they may share one commit.

If they are independent fixes, create independent commits.

Do not amend previous commits merely to hide remediation history.

---

### Uncommitted Review Remediation

If a review finding concerns work that has NOT yet been committed, incorporate the remediation into the logical commit currently being prepared when appropriate.

Do not create artificial intermediate commits solely to preserve the existence of a review finding.

The resulting commit should represent the correct completed logical change.

---

### Feature Completion

Incremental commits do not replace feature-level verification.

When all Spec Kit tasks for the feature are complete:

1. Run the complete test suite.
2. Run lint.
3. Run type checking.
4. Run the production build when applicable.
5. Run any required security or integration verification.
6. Perform the required final review.
7. Remediate blocking findings.
8. Commit remediation as logical fix commits when necessary.
9. Re-run affected verification.
10. Confirm that no intended implementation changes remain uncommitted.
11. Confirm that the working tree is in the expected state.

Do NOT squash the incremental implementation commits at feature completion unless the user explicitly requests it.

Do NOT create an additional meaningless "feature complete" commit when there are no actual remaining changes.

---

### Commit Quality Goals

Prefer commits that are:

- cohesive
- independently understandable
- buildable when practical
- testable
- reviewable
- easy to revert
- useful for `git bisect`
- useful for future maintainers
- aligned with architectural boundaries

Avoid both extremes:

#### Too granular

Do not produce histories such as:

`feat: add interface`

`test: add test`

`fix: make test pass`

`refactor: rename variable`

`chore: lint`

when these changes collectively represent one logical capability.

#### Too broad

Do not produce one giant feature commit containing many independently understandable architectural units merely because they belong to the same feature.

For a substantial multi-stage feature, several logical commits are preferred.

---

### Dependency-Safe Commit Ordering

Commit ordering should follow implementation dependencies when practical.

Foundational changes should generally appear before changes that depend on them.

For example:

1. project/tooling foundation
2. domain contracts
3. provider boundaries
4. provider implementation
5. infrastructure/security boundaries
6. application orchestration
7. delivery integration
8. lifecycle behavior
9. feature-level integration

This ordering is guidance, not a mandatory template.

The actual architecture and task dependency graph determine the correct order.

Each commit should avoid intentionally depending on changes that exist only in later commits when practical.

---

### Post-Commit Verification

After every autonomous commit, inspect:

`git status --short`

`git log -1 --oneline --decorate`

Confirm that:

- the intended changes were committed
- unrelated changes remain untouched
- remaining work is still present when expected
- the repository is ready for the next logical implementation unit

Do not push merely because a commit was created.

---

### Existing User Changes

Never absorb unrelated pre-existing user changes into an autonomous commit.

If the working tree contains changes that were not created as part of the current task:

- identify them
- leave them unstaged
- continue when the intended task can be safely isolated

If safe isolation is impossible, stop before committing and ask the user for guidance.

Do not discard or overwrite user changes.

---

### History Safety

Creating new commits according to this policy is pre-authorized.

Without explicit user approval, never:

- amend an existing commit
- squash existing commits
- rebase
- perform destructive reset
- rewrite existing history
- force-push
- delete branches
- modify existing commits
- discard user changes

A non-destructive command used only for inspection is allowed.

Pushing commits is NOT authorized unless the user separately grants permission to push.

---

### Autonomous Behavior Summary

During implementation, the expected behavior is:

1. inspect the next logical work unit
2. implement it
3. test it
4. verify it sufficiently
5. inspect the diff
6. stage only that unit
7. inspect the staged diff
8. create an appropriate Conventional Commit
9. continue with the next logical unit

The agent should perform this cycle autonomously without requesting confirmation for each normal commit.

The agent should request user approval only when an operation would violate the History Safety rules or when the intended commit scope cannot be determined safely.