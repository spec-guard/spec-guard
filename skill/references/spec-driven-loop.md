# Spec-Driven Development Loop

How to run spec-driven development (SDD) so AI agents produce production code consistently in a large codebase. The spec is the prompt; the quality of the output tracks the quality of the spec.

## Contents
- Why spec-first
- Anatomy of a good spec
- Acceptance criteria (outcome-shaped)
- Traceability (spec ↔ ADR ↔ code)
- Working in validated increments
- The Coordinator / Implementor / Verifier stance
- Where specs live
- How to verify

## Why spec-first

LLMs are strong implementers and weak mind-readers. A precise spec removes the ambiguity that causes drift, rework, and regressions. Human-refined specs measurably reduce error rates in generated code. In a multi-module system the spec is also the contract that lets work be partitioned without integration breakage.

Spec-first is **not** waterfall. Specs are small, per-feature, living, and validated in increments — not a 200-page upfront document.

## Anatomy of a good spec

A spec must answer *what*, *why*, and *done-when* — and explicitly fence the edges. Minimum sections:

1. **Context / Problem** — what's wrong or missing, why now. Link the triggering doc/ticket.
2. **In-Scope** — what this change will do. Concrete.
3. **Out-of-Scope** — what it deliberately will **not** do. This is the most-skipped and most-valuable section; it prevents gold-plating and scope creep.
4. **Design** — the approach: components touched, data flow, key decisions, alternatives rejected.
5. **Acceptance Criteria** — testable outcomes (see below).
6. **Traceability** — which ADR(s)/architecture doc(s) this implements, or which new ADR it produces. Back-link both directions.
7. **Migrations / Rollout** — schema changes, backfill, flags, ordering, reversibility.
8. **Status** — `PROPOSED | APPROVED | IMPLEMENTED | SUPERSEDED` (link replacement if superseded).

## Acceptance criteria (outcome-shaped)

Write criteria as observable outcomes a verifier can check, not implementation steps.

- Good: "A tenant with no storage configured receives `412 media_storage_required` and the message counter is **not** debited."
- Good: "Re-pairing an existing phone reuses the existing row (UPDATE), never INSERT; the `(tenant_id, phone_number)` invariant holds."
- Avoid: "Add a check in the handler." (that's a task, not an outcome)

Prefer Given/When/Then when it sharpens the outcome. Every criterion should map to a test where feasible.

## Traceability (spec ↔ ADR ↔ code)

- A spec **implements** existing ADR(s) or **produces** a new ADR for a decision. State which, by filename.
- An ADR records the *decision and rationale*; a spec records *how to build it*; a plan records *the task sequence*. Don't collapse them, don't duplicate the detail across them — link.
- When a spec changes a prior decision, add a supersession blockquote to the older artifact pointing forward, and reference the older one from the new.

## Working in validated increments

- Decompose the spec into the smallest steps that each compile, pass tests, and are independently reviewable.
- Validate at every checkpoint — human review or automated gate — to catch drift early instead of at the end.
- Prefer a verifiable intermediate artifact for risky batch work (a plan file, a migration dry-run, a generated diff) that can be checked *before* applying.

## The Coordinator / Implementor / Verifier stance

The standard topology for agentic engineering — adopt it even when working solo, by switching hats:

- **Coordinator** — turns the spec into a dependency-ordered task graph; owns scope and sequencing.
- **Implementor** — executes one bounded task from its sub-spec; stays in the grain of the code.
- **Verifier** — a *separate* perspective that checks output against the spec and tries to refute it. The single most underused, highest-leverage pattern: never let the author be the only judge.

For large or parallelizable work, dispatch real subagents per role (implementors on non-overlapping tasks, an independent verifier). Partition at the spec level so agents don't collide.

## Where specs live

Follow the repo's configured convention:

- Deliverable specs / plans: `${specDir}` / `${plansDir}` (dated `YYYY-MM-DD-feature.md`, or sequential `NNNN-title.md`).
- Formal decisions: `docs/reference/decisions/` (ADRs).
- Internal execution heuristics / action plans: the IP docs tree (not deliverable — see [ip-vs-deliverable.md](ip-vs-deliverable.md)).

Use the repo's spec / plan / ADR templates to scaffold. If they don't exist, create them from this structure first.

## How to verify

Use this checklist at the SPEC step — before any code is written:

- [ ] Does the spec have all required sections? (Context/Background, In-Scope, Out-of-Scope, Design/Approach, Acceptance Criteria, Traceability, Migrations/Rollout, Status)
- [ ] Are acceptance criteria outcome-shaped and independently testable — not implementation steps or internal details?
- [ ] Does the spec name the ADR(s) it implements, or record that it produces a new ADR? Is that ADR referenced by filename?
- [ ] For architectural or irreversible changes: has human sign-off been obtained *before* any code was written?
- [ ] Is the spec stored in the correct location per the repo's convention (`${specDir}`, `${plansDir}`, or `docs/reference/decisions/`)? Not inside `${privateDir}/`.
- [ ] If a prior spec or ADR is superseded, does the older artifact carry a forward-pointing blockquote, and does the new spec reference the older one?
