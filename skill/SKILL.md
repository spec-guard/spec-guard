---
name: spec-guard
description: Use at the START of any feature, refactor, bugfix, schema/API/event change, or architectural work in a multi-module codebase — before writing code. Enforces spec-driven development (read docs first, spec before code, verify against spec), anti-regression invariants, multi-module consistency, IP-vs-deliverable doc separation, and token economy. Triggers on "implement", "add", "build", "refactor", "fix", "change the API/schema/event/contract", or any non-trivial code change in a repo that has a CLAUDE.md / docs/ tree.
---

# Spec Guard

Front-of-pipeline governance for professional AI-assisted engineering in large, multi-module codebases. This skill makes you behave like the **Coordinator + Verifier** in a spec-driven workflow: understand the contract before touching code, work in validated increments, and check the result against the spec — never against your own memory.

## The Prime Directive

> **Context before code. Spec before edits. Verify against the spec, not the vibe.**

The repo's own documentation is the source of truth — not your training data, not assumptions. Your job is to load the relevant slice of that truth, act within it, and leave the docs consistent.

## When this applies

Apply for any non-trivial change: a new feature, a refactor touching >1 file, a schema/API/contract/event change, or a bugfix in load-bearing code. Skip the heavy loop only for truly trivial edits (a typo, a comment, a one-line format fix) — but even then obey the invariants (§Anti-regression).

## The loop (follow in order)

Copy this checklist into your working notes for any non-trivial task:

```
Spec-Guard Progress:
- [ ] 1. ORIENT  — read repo CLAUDE.md + the doc(s)/ADR(s) governing this surface
- [ ] 2. SPEC    — locate or write the spec (scope, acceptance, ADR traceability)
- [ ] 3. PLAN    — decompose into small verifiable increments
- [ ] 4. BUILD   — implement one increment; match surrounding code
- [ ] 5. VERIFY  — check output against the spec + invariants; run tests
- [ ] 6. SYNC    — update docs/contracts/cross-references; record decisions
```

### 1. ORIENT — load the governing truth
- Read the repo's root `CLAUDE.md` and any module `CLAUDE.md` for the area you touch. These index the load-bearing invariants and the canonical docs.
- Open the architecture doc / ADR / spec that governs the surface. If a CLAUDE.md links an ADR index, the matching ADR is **mandatory reading before editing that surface**.
- Do **not** re-derive behavior from code alone when a doc exists. If code and doc disagree, that is a finding — surface it, don't silently pick one.
- If the repo carries a knowledge graph (`graphify-out/`), use it to orient before grepping — see [references/graphify-integration.md](references/graphify-integration.md).

### 2. SPEC — make the contract explicit
- For a feature/refactor of any size, there must be a spec before code. Locate an existing one (in `${specDir}`, a plan, or an ADR) or write one using the repo's spec template.
- A spec is not done until it states: **In-Scope**, **Out-of-Scope**, **Acceptance Criteria** (testable, outcome-shaped), and **traceability** (which ADR/doc it implements or produces). See [references/spec-driven-loop.md](references/spec-driven-loop.md).
- Get human sign-off on the spec for anything architectural or irreversible *before* writing code. Asking is cheaper than rework.

### 3. PLAN — decompose into increments
- Break the spec into the smallest sequence of independently verifiable steps. Each step should compile, pass tests, and be reviewable.
- Identify cross-module ripple up front (see [references/multi-module-consistency.md](references/multi-module-consistency.md)). A contract change is never single-module. In a multi-repo workspace, also read [references/multi-git-topology.md](references/multi-git-topology.md).

### 4. BUILD — implement within the grain
- Write code that reads like the code already there — match its structure, error handling, DI, naming, observability, and test idioms. Consistency beats personal preference. The conventions to conform to: [code-organization.md](references/code-organization.md), [error-model.md](references/error-model.md), [schema-and-data.md](references/schema-and-data.md), [coding-conventions.md](references/coding-conventions.md), [observability.md](references/observability.md).
- Apply existing patterns before inventing abstractions. Reuse shared contracts; never fork an enum/DTO that already exists in a shared module.
- Stay inside scope. No gold-plating, no drive-by refactors outside the spec (see [references/token-economy.md](references/token-economy.md)).

### 5. VERIFY — adversarial check against the spec
- Walk each Acceptance Criterion and confirm the code meets it. Run the repo's test/lint/type gate.
- For substantial or risky changes, take a **separate verifier stance** (or dispatch a verifier subagent): try to prove the change is wrong, incomplete, or regressive. Default to "not done" until evidence says otherwise.
- Re-check every invariant in [references/anti-regression.md](references/anti-regression.md), the schema/data rules ([schema-and-data.md](references/schema-and-data.md)) when data shape changed, and confirm the change is instrumented ([observability.md](references/observability.md)) — instrumentation is part of done.

### 6. SYNC — leave the system consistent
- Update the docs the change affects: architecture doc, ADR (new or status), API contract, event catalog, glossary. The repo's CLAUDE.md "when to update docs" rule is binding.
- Keep deliverable vs IP docs separate and cross-referenced correctly (see [references/ip-vs-deliverable.md](references/ip-vs-deliverable.md)).
- If a knowledge graph is present, refresh it **before** committing so it rides the same commit — structural every commit, semantic only when that module's docs changed (see [references/graphify-integration.md](references/graphify-integration.md)).
- A change that ships code but not docs is **incomplete**, and silently rots every future agent's context.

## Reference material (load on demand)

- **The SDD loop, specs, acceptance criteria, traceability** → [references/spec-driven-loop.md](references/spec-driven-loop.md)
- **Anti-regression invariants (Python + TS + data)** → [references/anti-regression.md](references/anti-regression.md)
- **Code organization — layering, feature slices, barrels, imports** → [references/code-organization.md](references/code-organization.md)
- **Error & exception model** → [references/error-model.md](references/error-model.md)
- **DB schema & data contracts** → [references/schema-and-data.md](references/schema-and-data.md)
- **Coding conventions — naming, typing, DI, logging** → [references/coding-conventions.md](references/coding-conventions.md)
- **Observability — logging, metrics, tracing, instrumentation** → [references/observability.md](references/observability.md)
- **Multi-module consistency & contract ripple** → [references/multi-module-consistency.md](references/multi-module-consistency.md)
- **Multi-git-repo & backup-monorepo topology** → [references/multi-git-topology.md](references/multi-git-topology.md)
- **IP vs deliverable docs + the golden rule** → [references/ip-vs-deliverable.md](references/ip-vs-deliverable.md)
- **Token economy & context engineering** → [references/token-economy.md](references/token-economy.md)
- **Optional graphify enhancer** → [references/graphify-integration.md](references/graphify-integration.md)

## Red flags — stop and return to the loop

| Thought | Reality |
|---------|---------|
| "I'll just code it, it's obvious" | Non-trivial = needs a spec. ORIENT first. |
| "The doc is probably outdated, I'll trust the code" | Disagreement is a finding to surface, not a license to guess. |
| "I'll update the docs after" | "After" rarely happens. SYNC is part of done. |
| "This only touches one module" | Contract changes ripple. Check the dependency graph. |
| "I'll add this nice extra while I'm here" | Out of scope = out of this PR. |
| "Tests pass, so it's done" | Tests ≠ spec. Verify each acceptance criterion. |
| "I'll reuse my memory of this codebase" | Memory rots between sessions. Re-read the governing doc. |

## Composes with (orchestrate, don't reinvent)

spec-guard is the front-of-pipeline gate. It supplies the *governance* (read-docs-first, scope discipline, multi-module ripple, IP/deliverable wall, anti-regression); pair it with whatever *mechanics* your toolchain provides for each phase:

| Phase | Pair with a capability for… |
|-------|------------------------------|
| ORIENT/SPEC | brainstorming the intent, then writing a plan |
| BUILD | test-driven implementation; parallel subagents + isolated worktrees for independent tasks |
| VERIFY | verification-before-completion (evidence before claims), UI QA, code review |
| SYNC/commit | the repo's quality + commit workflow; a CLAUDE.md maintainer pass if one needs updating |

If your environment provides skills or commands for these, use them; if not, perform the discipline inline. spec-guard never requires a specific companion skill.
