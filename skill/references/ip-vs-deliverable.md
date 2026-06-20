# IP vs Deliverable Documentation

In a project that ships its repos to a client, documentation splits into two audiences with a hard wall between them. Putting a doc in the wrong place either leaks know-how or strands the client without an answer. Get the classification right *before* writing.

## Contents
- The two buckets
- The decision test
- The golden rule (cross-reference direction)
- Hybrid docs
- Credentials

## The two buckets

| Bucket | Location | Audience | Deliverable? |
|--------|----------|----------|--------------|
| **Deliverable** | `docs/` (and the customer docs site) | client, new developer | YES |
| **Intellectual Property** | `.claude/` (`.claude/docs/`, `credentials/`, `commands/`, templates) | you + your AI agents | NO |

Deliverable docs explain the *product, architecture, API, and business rules* — they onboard someone with zero internal context and are contractual artifacts. IP docs encode *how to execute the work*: troubleshooting (symptom→cause→solution), action plans, internal audits/reviews, agent templates, productivity heuristics, and the rationale behind decisions.

## The decision test

> Does this teach **what the system is / how to use it** (→ `docs/`) or **how we get the work done** (→ `.claude/docs/`)?

- Architecture, API contract, schema, ADR (the decision), runbook a client could need → `docs/`.
- Troubleshooting playbook, internal audit, agent checklist, "here's the trick we used" → `.claude/docs/`.
- A formal *decision* goes in `docs/reference/decisions/` (ADR); the *messy reasoning / rejected options / internal trade-off notes* behind it can live in `.claude/docs/` and be linked from the ADR as "internal rationale".

## The golden rule (cross-reference direction)

> **`.claude/` MAY reference `docs/`. `docs/` MUST NOT reference `.claude/`.**

Deliverable docs must stand alone — a client following a `docs/` runbook can never be sent to a `.claude/` path they don't have. If a deliverable doc needs internal content, inline the needed steps instead of linking IP. Internal docs freely cross-reference deliverable docs (and should, to stay anchored to the source of truth).

Common leak to avoid: a `docs/` runbook or architecture doc whose "real fix" is a pointer to `.claude/docs/troubleshootings/...`. Inline it or drop it.

> Note for linters: a *hyperlink* whose target starts with `.claude/` (e.g. `[x](.claude/…)` or `[x](../.claude/…)` at any depth) is a violation. A *prose* mention of the string `.claude/` while explaining this very rule is fine.

## Hybrid docs

When a topic has both a public concept and an internal execution recipe, **split it**:
- the concept/decision/contract → `docs/`
- the execution heuristics / gotchas / checklists → `.claude/docs/`
- link from IP → deliverable (never the reverse).

## Credentials

Secrets live only in the workspace `.claude/credentials/` (and per-module env under it). Never in `docs/`, README, or source. Modules may symlink to the central files. On rotation, update the central file.
