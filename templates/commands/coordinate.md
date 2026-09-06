---
id: coordinate
description: Run several specs/ad-hoc requests as independent, parallel fronts — each the full spec-guard loop, isolated worktree, async human-in-the-loop, sequential merge, one final reconciliation.
---
Act as the multi-front Coordinator. Every front is a complete, unchanged run of the spec-guard
loop (ORIENT→SPEC→PLAN→BUILD→VERIFY→SYNC) — you never truncate it. Your job is orchestration: which
requests become fronts, how they're dispatched in isolation, how blockers surface without stalling
the rest, and how finished fronts get back to the base branch safely. See the
`multi-front-coordination` reference for the full model.

1. Resolve each requested item to a front: an existing spec in `${specDir}`, or an ad-hoc
   description whose own SPEC step will write one. A `spec:<verb>` mention in the request names
   which work goes into which front — it does not shorten that front's loop.
2. Run `specguard coordinate plan` to check file/spec overlap between fronts, **and** read every
   front's spec/description yourself for semantic contradiction (conflicting rules, contracts,
   acceptance criteria — not just overlapping files; see the technical-lead section of the
   reference above). Never skip straight to dispatch: **always get human review of the plan
   report** before starting fronts.
3. Dispatch each front isolated in its own git worktree, using this harness's native
   parallel-agent mechanism (see your agent overlay for the concrete "how" here) — then delegate
   everything else to `specguard coordinate <verb>` (`start`, `report`, `status`, `watch`,
   `answer`, `merge`, `resolve-merge`, `finish`).
4. A front that hits a human decision (including the sign-off a spec already requires before
   BUILD for architectural changes) records a blocker and keeps running elsewhere — never stall
   the whole run on one front. Aggregate open blockers into a single review pass instead of
   interrupting per-blocker.
5. Merge a front only when its VERIFY is green, one at a time, behind the test gate — never two
   merges concurrently; respect dependency order when fronts share modules.
6. Once every front has merged, run exactly one final SYNC/Verifier reconciliation pass (including
   the semantic-contradiction re-check) across the merged result — this is not any single front's
   SYNC. Only then run `specguard coordinate finish` and `/spec:commit`.
7. `coordinate finish` prints a closing audit (fronts requested vs. merged/failed/aborted,
   blockers raised vs. resolved, any still open). Surface that audit to the human verbatim as part
   of your final report — don't just say "done." You never have to hold the run's state in your
   own head: `specguard coordinate status --run <id>` (or `list`) reconstructs everything from the
   ledger at any point, including after a lost session, so nothing tracked here gets forgotten.

Report: fronts dispatched, current status of each, open blockers awaiting a human (including any
semantic conflicts flagged), which fronts have merged, and the closing audit from `finish`.
