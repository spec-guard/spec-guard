# ADR 0012 — Multi-front coordination: parallel loop instances, sequential merge, single final SYNC

**Status:** Accepted

## Context

The spec-guard loop (`ORIENT→SPEC→PLAN→BUILD→VERIFY→SYNC`) runs one instance at a time, for one
spec, sequentially — by design, and that does not change here (see Decision). The
Coordinator/Implementor/Verifier stance (`spec-driven-loop.md` §"The Coordinator / Implementor /
Verifier stance") and the partitioning guidance in `multi-module-consistency.md`
§"Parallelizing safely" already prepare the ground in prose — dispatch real subagents per role,
partition at the spec level so agents don't collide, reconcile with a single Verifier pass — but
neither is executable: there is no worktree, no ledger, no async human-in-the-loop protocol, no
`src/cli/` command for any of it.

Users doing real multi-module work want more throughput than one loop instance at a time gives
them: several independent specs or ad-hoc requests, worked on concurrently, without the agents
stepping on each other's files or business rules, and without a mid-flight question on one item
stalling the rest. Today that requires either serializing everything (slow) or running parallel
agents by hand with no shared governance (risky — nothing partitions the work, catches file or
rule collisions, or reconciles the result before it lands).

spec-guard is multi-harness by design (single-source render to claude-code, codex, gemini,
github-copilot, opencode). As of September 2026, all five of those harnesses ship native parallel
subagent dispatch with worktree-based isolation, so this capability can be real execution across
the board rather than a Claude-Code-only feature with a manual fallback elsewhere.

## Decision

spec-guard adopts the concept of a **front**: one complete, unmodified run of the existing
`ORIENT→SPEC→PLAN→BUILD→VERIFY→SYNC` loop, for one spec, isolated in its own git worktree. The
loop itself is not changed and is never sliced — a front is always the whole loop, never a single
stage. A front's spec is either one that already exists in `${specDir}`, or an ad-hoc description
that the front's own SPEC step turns into a spec before continuing.

A new command, `/spec:coordinate` (backed by `specguard coordinate` in `src/cli/`), orchestrates N
fronts:

- **Dispatch.** Each requested work item resolves to one front, isolated in its own worktree
  (per-module worktrees when the repo is a multi-git-root backup monorepo). Before dispatch, the
  coordinator checks two things: file/spec overlap between fronts (mechanical, CLI-enforced), and
  semantic conflict — contradictory business rules, contracts, or acceptance criteria between
  fronts' specs, even when they share no file (a judgment call, made by the coordinating agent
  acting as technical lead, not something the CLI can verify deterministically).
- **Asynchronous human-in-the-loop.** A front that needs a human decision records a blocker and
  keeps running elsewhere — it never stalls the other fronts. Blockers from multiple fronts
  aggregate into a single review pass instead of interrupting per-blocker.
- **Sequential merge.** A front merges into the base branch only when its VERIFY step is green,
  one front at a time, behind the repo's test gate. A merge conflict or a broken test never
  retries or aborts automatically — it always becomes a human-in-the-loop blocker.
- **Single final reconciliation.** Only after every front has merged does exactly one final
  SYNC/Verifier pass run across the merged result — reconciling cross-front drift (file-level and
  semantic) before `/spec:commit`. This is the same "single Verifier pass reconciles the contract"
  principle `multi-module-consistency.md` already states, applied one altitude up: across whole
  fronts, not just tasks within one build.

Execution is real (not a documented manual fallback) in all five supported harnesses from the
first release, each dispatching fronts through its own native mechanism (Claude Code, Codex CLI,
Gemini CLI, GitHub Copilot CLI, OpenCode all ship native parallel subagent delegation with
worktree isolation as of September 2026). The state protocol itself — a file-based ledger plus
plain `git worktree` — stays harness-agnostic regardless, so the mechanism keeps working even
where native dispatch isn't available.

This ADR covers the architectural decision and its exposure through the skill, commands, and
per-harness overlays. The concrete CLI mechanism (ledger/state format, the file-overlap and
worktree algorithms, the merge/test-gate algorithm, `src/cli/coordinate.js`, and the
`coordination` config block) is specified in full in spec 0006, alongside the skill/doc changes —
one spec covers the whole feature rather than splitting it across two.

Rejected: depending on an external plugin (e.g. `superpowers`) for worktree/subagent mechanics —
it would break portability across harnesses and the client-repo install model; letting a front be
a partial stage of the loop — it would break the loop's existing single-spec, always-sequential
contract; a single shared integration branch for all fronts before touching base — it defers
conflict detection instead of catching it per-merge.

## Consequences

- A new reference file (`skill/references/multi-front-coordination.md`) and command
  (`templates/commands/coordinate.md`) join the existing rendering pipeline — the 6-step loop
  itself does not change.
- All five agent overlays need a paragraph naming that harness's native parallel-dispatch
  mechanism; `test/render.test.js` already enforces this for github-copilot's overlay, and the
  same practice extends to the other four for consistency.
- Multi-front work now has a governed default (partition → dispatch → async blockers → sequential
  merge → single reconciliation) instead of ad-hoc parallel agents with no shared state.
- The file-level and semantic conflict checks are best-effort, not guarantees: the file check is a
  heuristic (spec/description text isn't a reliable source of the exact file set until a front's
  own ORIENT/SPEC runs), and the semantic check is LLM judgment. Both failure modes are mitigated
  the same way — never resolved silently, always escalated to a human review pass before or during
  execution.
- No harness's native subagent/worktree mechanism has been exercised empirically in this
  environment; the overlay text for each is written from September 2026 public documentation and
  needs a manual spike per harness before being finalized, since this space moves fast.

## Traceability

- Implemented by: spec `docs/specs/0006-multi-front-coordinator.md`
- Extends: `skill/references/spec-driven-loop.md` §"The Coordinator / Implementor / Verifier
  stance"; `skill/references/multi-module-consistency.md` §"Parallelizing safely"
