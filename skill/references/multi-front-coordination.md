# Multi-Front Coordination

How to run several independent spec-guard loops **in parallel**, on the same repo, without the
agents colliding — orchestrated by a coordinator (`/spec:coordinate`). This is a different altitude
from parallelizing tasks *inside* one build (see [multi-module-consistency.md](multi-module-consistency.md)
§"Parallelizing safely"): here, each parallel unit is a **whole spec**, not a file-level task.

## Contents
- A front is always the whole loop, never a slice
- Requesting several fronts at once
- Isolation
- Asynchronous human-in-the-loop
- The technical-lead role: semantic conflicts, not just file conflicts
- Sequential merge
- One final reconciliation pass
- How to verify

## A front is always the whole loop, never a slice

The loop itself does not change: `ORIENT → SPEC → PLAN → BUILD → VERIFY → SYNC` stays sequential,
and each run of it still resolves to exactly one spec — same as running spec-guard solo. A **front**
is one complete, independent, sequential run of that unchanged loop, isolated in its own worktree.
Coordinating multiple fronts never means running ORIENT for one front while another is mid-BUILD on
the *same* spec, and it never means a front that stops partway through the loop by design. The only
thing that is new is the layer above the loop: a coordinator capable of running several of these
complete, independent instances **at the same time**.

A front's source is either:
- an existing spec in `${specDir}` (status `PROPOSED` or `APPROVED`), or
- an ad-hoc description that has no spec yet — the front's own SPEC step writes one, same as it
  would running solo, just inside that front's worktree instead of before dispatch.

## Requesting several fronts at once

You can ask for several fronts in one message, including by naming the phase commands directly —
e.g. "run `/spec:orient` on the billing module and `/spec:write` for the export feature". Each
distinct verb+target mention is just how you *name and route* a front when asking the coordinator
to start it; it does not mean that front stops at that phase. Once dispatched, every front still
runs the full loop end to end. Treat `spec:<verb>` mentions in a coordination request as addressing,
not as a truncated pipeline.

## Isolation

Each front runs in its own git worktree (own branch, own working copy) so parallel edits can't step
on each other physically. See [multi-module-consistency.md](multi-module-consistency.md)
§"Parallelizing safely" for the underlying worktree-isolation guidance — this reuses it, rather than
restating it, at the front level instead of the task level.

## Asynchronous human-in-the-loop

A front that needs a human decision (an ambiguity, a sign-off on an architectural spec before BUILD,
a merge conflict) signals a blocker and **keeps other fronts running** — it never halts the whole
coordination run. Open blockers across all fronts are aggregated into a single review pass instead
of interrupting per-blocker; answering one resumes just that front. This is the mechanism that keeps
the work fluid: you review and decide in batches, not one prompt at a time.

## The technical-lead role: semantic conflicts, not just file conflicts

File-level isolation (worktrees) and file-overlap checks catch *syntactic* collisions — two fronts
touching the same path. They do not catch two specs that define **contradictory** business rules,
API/schema contracts, acceptance criteria, or terminology while never touching the same file. Acting
as technical/project lead, the coordinator reads every front's spec/description side by side, before
dispatch and again during the final reconciliation pass below, specifically looking for
contradiction — not just overlap.

- Cosmetic divergence (naming, formatting) can be harmonized by the coordinator on its own
  authority, with the decision recorded for traceability.
- A substantive contradiction (a rule, contract, or architectural decision that can't be true in two
  ways at once) is never resolved unilaterally — it becomes a blocker, the same standard the loop
  already applies to architectural sign-off in SPEC (see [spec-driven-loop.md](spec-driven-loop.md)).

This check is a judgment call, not something a file-diff can guarantee — treat it as a mandatory
step in the flow, not an optional nicety.

## Sequential merge

A front merges into the base branch only once its own VERIFY is green, one front at a time, behind
the repo's test gate — never two merges concurrently. If fronts share modules, merge in dependency
order (see multi-module-consistency.md §"Dependency order"). A merge conflict or a test failure is
never auto-retried or auto-aborted; it becomes a blocker for a human to resolve.

Resolving that blocker as "abort" isn't always a clean, one-step operation: a front touching
several modules can already have landed some of them successfully before a later module blocked it.
Aborting reverts every module it can still safely revert, but refuses to finalize the front as
aborted if any module can't be (something else already merged there since — an automatic revert
would destroy that other work). When that happens, surface the exact module(s) still needing manual
attention to the human as part of your report — don't just say "aborted" and move on; the front only
becomes truly aborted once every module is actually reverted, or the human explicitly confirms it's
handled.

Retrying a partially-merged front (choosing to fix the blocker forward instead of aborting) has the
same "don't lose what already happened" guarantee, mirrored: a module that already merged and
hasn't changed since is not re-merged — but if it gained new commits while the front sat blocked on
a sibling module (its worktree isn't removed until the whole front succeeds, so nothing stops that),
those new commits still need to land, and retrying picks them up rather than silently skipping the
module because it "already merged once."

## One final reconciliation pass

Once **every** front in the run has merged, run exactly one SYNC/Verifier reconciliation pass over
the merged result — reusing the existing principle that "a single Verifier pass reconciles the
contract across modules before commit" (multi-module-consistency.md), applied here across fronts
instead of across tasks. This pass repeats the semantic-conflict check above (catching drift that
emerged during BUILD, not just what was visible before dispatch) and is not a substitute for any
individual front's own SYNC — it reconciles what changed *between* fronts. Only after this pass
should `/spec:commit` run.

## How to verify

- [ ] Does every front run the complete ORIENT→SYNC loop, never a truncated slice?
- [ ] Is every front isolated in its own worktree before any work starts?
- [ ] When a front blocks on a human decision, do the other fronts keep running?
- [ ] Were open blockers across fronts reviewed together, rather than one interruption per blocker?
- [ ] Was every front's spec/description cross-checked for semantic contradiction — not just file
      overlap — before dispatch?
- [ ] Did every substantive (non-cosmetic) semantic contradiction become a blocker instead of being
      resolved unilaterally?
- [ ] Did merges happen one at a time, behind the test gate, in dependency order?
- [ ] Did exactly one SYNC/Verifier reconciliation pass run after all fronts merged, before commit?
