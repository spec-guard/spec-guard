# Spec 0006 — Multi-front coordinator (`/spec:coordinate`)

**Status:** IMPLEMENTED

## Context / Problem

spec-guard's loop (`ORIENT→SPEC→PLAN→BUILD→VERIFY→SYNC`) runs one instance at a time, for one
spec. Users with real multi-module work want to run several independent specs or ad-hoc requests
concurrently in the same repo without agents colliding on files or contradicting each other's
rules, and without one item's mid-flight question stalling the others. Nothing today partitions
work, isolates it, tracks async blockers, or reconciles parallel results before they land — see
ADR 0012 for the full rationale and rejected alternatives.

## In-Scope

- **`src/cli/coordinate.js`** — new CLI subsystem: `plan`, `start`, `report`, `status`, `watch`,
  `answer`, `merge`, `resolve-merge`, `finish`, `list`. Deterministic, ledger-owning; never decides
  what a front is or dispatches subagents.
- **Ledger** at `.spec-guard/coordination/<run-id>/{run.json, lanes/*.json, hitl/*.json,
  log.ndjson}`, one JSON file of ownership per writer (the run, or one front at a time), atomic
  writes (tmp-file + rename), no lockfile — ownership transfers by state transition instead.
- **File-overlap check (mechanical, "Portão A/B")**: `coordinate plan` rejects creating any front
  when declared paths/specs collide between fronts; `coordinate status --refresh` re-checks after
  each front's own ORIENT/SPEC narrows its real file set; the pre-merge diff is compared against
  what was declared, and any drift outside an incidental allowlist is a blocker, not a silent pass.
- **Worktree per front** (per module, for a multi-git-root backup monorepo), created via plain
  `git worktree add` under `<repoRoot>/../.spec-guard-worktrees/<run-id>/<lane-id>[--<module>]`
  (sibling of the repo root, never inside it) with branch `<coordination.branchPrefix>/<run-id>/
  <lane-id>`.
- **Asynchronous HITL protocol**: a front records a blocker (`coordinate report --status
  blocked --question "..."`) and keeps running elsewhere; `coordinate watch`/`status` aggregate
  every open blocker across fronts into one review pass; `coordinate answer` resumes the specific
  front, readable from the ledger by a fresh agent with no attachment to the prior session.
- **Sequential merge with test gate** (`coordinate merge`): one front at a time, `git merge
  --no-ff` then the resolved test command; a conflict or a failing test reverts the merge
  (`git reset --hard`) and becomes a blocker — never an automatic retry, never a silent abort.
- **Semantic conflict check ("technical lead" role)**: the coordinating agent — not the CLI — reads
  every front's spec/description side by side before dispatch, and again in the single final
  reconciliation pass after all fronts have merged, looking for contradictory business rules,
  contracts, or acceptance criteria even where no file overlaps. Cosmetic divergence may be
  harmonized and logged; substantive contradiction is always a human blocker, mirroring the
  sign-off the loop already requires for architectural change at the SPEC step.
- **`/spec:coordinate`** (`templates/commands/coordinate.md`) — the LLM-facing entry point:
  resolves requested work items (existing specs, ad-hoc descriptions, or multiple `spec:<verb>`
  mentions in one message — each mention is just how a work item is named, every resulting front
  still runs the full loop) into fronts, runs the file and semantic checks, dispatches via the
  current harness's native mechanism, and delegates the rest to `specguard coordinate <verb>`.
- **New skill content**: `skill/references/multi-front-coordination.md` (new reference, one
  altitude above `multi-module-consistency.md` — whole parallel loop instances, not tasks within
  one build); bridge sentences in `spec-driven-loop.md` and `multi-module-consistency.md`; one line
  in `SKILL.md`'s reference index; one line + one sentence in the `/spec` umbrella (still a pure
  signpost, still does not start changing code).
- **Per-harness overlays** (`templates/agents/{claude-code,codex,gemini,github-copilot,
  opencode}/overlay.md`): one paragraph each, naming that harness's own native parallel-dispatch
  mechanism (Task/worktree, explorer/worker roles, `--worktree`/`-w`, `/fleet`+`/tasks`, `@agent`
  respectively) — all real execution, no "manual mechanism" fallback for any of the five.
- **Config**: `schemas/config.schema.json` gains an optional `coordination: {worktreeRoot,
  testCommand, branchPrefix}` object; `src/core/config.js` resolves its defaults.
- **`src/core/topology.js` hardening**: `isGitRepoDir` checks that `.git` is a directory (not a
  worktree's `.git` file) before classifying something as a real module — defense in depth behind
  the "worktree is always a sibling of the repo root" convention.
- A self-contained, nested `.gitignore` under `.spec-guard/coordination/` (ephemeral run state),
  written write-if-absent by `coordinate.js` itself the first time a run is created — never the
  user's root `.gitignore`, and no dependency on `init`/`migrate` having run first, since
  `coordinate` must work in any git repo on its own.
- `docs/specs/README.md` gains the status row for this spec.

## Out-of-Scope

- Any change to the loop itself. `ORIENT→SPEC→PLAN→BUILD→VERIFY→SYNC` stays exactly as it is
  today: sequential, whole, scoped to one spec. A front is always one full run of it, never a
  slice — this is a hard constraint, not a default that can be revisited per front.
- Any field added to `schemas/spec.schema.json`. Whether a spec is being worked as a front is
  coordinator/ledger state, not a property of the spec document — the same spec can be worked
  standalone or as a front without changing identity.
- Any change to `src/cli/commit.js`. It runs unmodified inside each front's worktree; the only
  coupling to it is on module *order*, not config in general — `coordinate merge` does read fresh
  config on every invocation (e.g. `coordination.testCommand` for the test gate), but never
  re-reads `.modules`: that list is resolved once by `coordinate start` (via `orderedModules`,
  `config.resolveRepoSettings(root).modules`) when it creates each front's worktrees, and `merge`
  only ever iterates the worktree list `start` already fixed. That shared, one-time read of
  `.modules` at `start` keeps `coordinate` and `commit.js` in agreement on ordering once the repo
  has been through `specguard init` and that list is populated. In the narrow case of a
  backup-monorepo that has never been initialized, `coordinate` (designed to work standalone)
  falls back to topology auto-detection for module order while `commit.js` does not — a known,
  low-impact divergence (it can only affect module-order reporting, never data: each front's merge
  still lands as a real commit inside that module's own git history regardless of this list).
  Getting `commit.js` and this fallback to agree in that edge case, if it's ever worth doing, is
  separate future work, not part of this spec. `coordinate finish` prints a reminder to run
  `specguard commit --all` at the backup-monorepo root; it does not run it automatically.
- Real-time locking of the ledger beyond ownership-by-state-transition. Sufficient for one
  coordinator with a handful of concurrent fronts; not proven safe for two coordinators racing on
  the same run.
- Automatic detection/cleanup of orphaned worktrees after a crash mid-front. `coordinate finish
  --force` is the only escape hatch in this release.
- Any PR-creation flow. `coordinate merge` only ever touches local branches, matching
  `src/cli/commit.js`'s existing scope.

## Design

See ADR 0012 for the full rationale. Summary of the moving parts and how they compose:

- **Two-layer separation**, mirroring how `commit.js` already works ("doesn't invent the message,
  validates and executes"): the CLI (`specguard coordinate <verb>`) owns state — ledger, worktrees,
  file-overlap checks, merge, test gate — and never decides what a front is or dispatches an
  agent. `/spec:coordinate` (the LLM-facing skill/command) owns partitioning and dispatch, and
  calls the CLI for everything mechanical.
- **End-to-end flow**: a request naming several work items → `coordinate plan` (file-overlap check
  + the coordinator's own semantic read-through; always surfaced for human review before
  proceeding) → `coordinate start` (worktree + branch per front) → each front runs its full loop
  independently, reporting state via `coordinate report`, blocking without stalling siblings when
  it needs a human → `coordinate watch`/`status` aggregate open blockers → `coordinate answer`
  resumes a specific front → `coordinate merge` lands each VERIFY-passed front sequentially behind
  the test gate → once every front has merged, one final SYNC/Verifier reconciliation (file-level
  and semantic) → `/spec:commit`.
- **Ledger ownership**: `run.json` (coordinator-owned) and one `lanes/<id>.json` per front, owned
  by that front's active writer and handed to the coordinator the instant it reports `verified` —
  no writer overlap in practice, so no lock is needed. `log.ndjson` is append-only, safe under
  concurrent writers.
- **Worktree placement** is always a sibling of the repo root, never inside it, specifically to
  avoid `topology.js#isGitRepoDir` misclassifying a worktree as a real deliverable module in a
  backup-monorepo topology (the hardening in In-Scope is the second line of defense).
- **Failure handling is uniform**: a file-overlap collision, a semantic conflict, a merge conflict,
  a failing test post-merge, or a missing resolvable test command all resolve the same way — stop,
  don't guess, surface to a human. None of these silently proceed or auto-retry.
- **A terminal lane (merged/failed/aborted) is immutable.** `coordinate report` refuses to touch
  one, and `status --refresh` skips it outright — a lane that already shipped can never be
  reopened by a stale scope update landing after the fact.
- **Abort reverts what already landed, or refuses to finalize instead of misreporting.** A
  multi-worktree front can have merged some modules successfully before blocking on a later one;
  `resolve-merge --action abort` reverts every module it can still safely revert (nothing else has
  landed there since). If any module can't be safely reverted (something else already landed on
  top — an automatic `reset --hard` there would destroy that other work), the lane is **not**
  marked `aborted`: it stays `blocked`, mutable, with the unrevertable module(s) listed, until a
  human either resolves them manually or passes `--force` to finalize the lane as aborted anyway.
  A lane never becomes the immutable terminal `aborted` state while it's still misrepresenting
  what actually landed. Two other paths can still leave a genuinely-merged, never-reverted module
  behind a terminal or force-finished lane without going through `resolve-merge` at all — `report`
  pushing a `blocked` lane straight to `failed`, or `finish --force` closing a run while a lane is
  still `blocked` — so `coordinate finish`'s closing audit (not `resolve-merge`) is the single
  place that scans every lane for this, regardless of how it happened, and refuses to print its
  "nothing left unaccounted for" line when it finds one.
- **Harness dispatch** is the one piece that varies per harness by design: the CLI creates the
  worktree with plain `git worktree add` regardless of harness, and each overlay tells the agent
  how to actually put a subagent to work in it using that harness's own native primitive.

## Acceptance Criteria

1. A front is always one full, unmodified run of `ORIENT→SPEC→PLAN→BUILD→VERIFY→SYNC` for one
   spec — never a single stage. Given a request that mentions `spec:orient X` and `spec:write Y`
   in the same message, the coordinator creates two fronts, and each runs the complete loop, not
   just the stage named in the mention that identified it.
2. `coordinate plan` given two fronts whose declared paths/specs overlap refuses to create either
   and reports the exact collision; given two fronts with no overlap, it creates the run.
3. Given two fronts whose specs share no file but state contradictory business rules (e.g. two
   different SLA values for the same event), the coordinator's pre-dispatch semantic read-through
   flags the contradiction as a blocker requiring human resolution, even though the file-overlap
   check passes clean.
4. A front that reports `blocked` does not stop other running fronts from continuing; `coordinate
   status`/`watch` list every open blocker across fronts in one aggregated view.
5. `coordinate merge` on a front whose merge produces a failing test run reverts the merge
   (working tree returns to its pre-merge state) and marks the front `blocked` — it never retries
   automatically and never proceeds with a broken merge.
6. `coordinate merge` with no resolvable `testCommand` (no config value, no `package.json` test
   script) refuses to merge rather than merging without a gate.
7. Worktrees created by `coordinate start` are never created inside `repoRoot`; `topology.detect`
   run against a repo with an active coordination worktree still classifies real deliverable
   modules correctly.
8. After all fronts in a run have merged, exactly one SYNC/Verifier reconciliation pass runs before
   `/spec:commit` is invoked — never one per front, never skipped.
9. `npm test` stays green, including the existing `test/render.test.js` regression that requires
   the github-copilot overlay to mention the `spec-coordinate` command; the coordinator is
   discoverable in all five agent overlays — by the `spec-coordinate`/`/spec:coordinate` name
   where the harness renders file-backed slash commands (claude-code, gemini, github-copilot,
   opencode), by a natural-language description of `specguard coordinate <verb>` for codex, which
   has no slash commands for any spec-guard phase, this one included.
10. No file under `docs/` (including this spec and ADR 0012) links to `${privateDir}` or an
    agent-specific directory (IP-wall lint stays green).

## Traceability

- Implements: ADR 0012 (`docs/reference/decisions/0012-multi-front-coordination.md`)
- Extends: `skill/references/spec-driven-loop.md` §"The Coordinator / Implementor / Verifier
  stance"; `skill/references/multi-module-consistency.md` §"Parallelizing safely"

## Migrations / Rollout

- Purely additive: new CLI subcommands, new skill/reference/command files, new optional config
  block, one hardening change to `topology.js#isGitRepoDir` (tightens a check, does not change
  behavior for any existing non-worktree repo layout). No existing command's behavior changes.
- `.spec-guard/coordination/` gets its own nested `.gitignore`, written by `coordinate.js` itself
  on first use — no versioned artifact changes shape.
- No spec/config schema breaking change: `coordination` is optional with resolved defaults; nothing
  is added to `schemas/spec.schema.json`.
- Rollback is deleting the new files and the `coordination` config block; nothing else in the repo
  depends on this capability existing.
