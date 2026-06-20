# Anti-Regression Invariants

Cross-language guardrails that keep a large codebase from rotting under fast AI-assisted change. These are the patterns that, when skipped, let a removed status / dropped column / forked enum slip through and cause a production regression. Always re-check before declaring VERIFY done.

## Contents
- The universal rules
- Python
- TypeScript / Next.js
- Data & contracts
- How to verify

## The universal rules

1. **Exhaustiveness over silent fallback.** When you switch on a closed set (enum, union, status), handle every case explicitly and make the impossible case a compile/run error — never a silent default that swallows a new variant.
2. **One definition, many imports.** A status/enum/DTO/event lives in exactly one shared module. Never re-declare it locally. Adding a variant means editing the canonical source and letting every consumer break loudly.
3. **Invariants are documented at the code site.** Load-bearing rules get a short `@invariant` / docstring note explaining *why*, so the next agent doesn't "simplify" them away.
4. **Disagreement is a finding.** If code contradicts a doc/ADR, stop and surface it. Do not silently reconcile by guessing.
5. **Read the governing ADR before editing its surface.** The repo CLAUDE.md indexes which ADR owns which invariant.

## Python

- Use `typing.assert_never()` in the `else`/default of an exhaustive match on a sealed union or enum. A new variant then fails type-check instead of silently falling through.
- Raise **typed** domain exceptions; catch the typed exception **before** any generic fail-open `except`. A bare `except` above a typed handler hides the case you care about.
- Keep enums/events/DTOs in the shared contracts module (e.g. a `shared-public` package); never duplicate a status enum or event type in a consumer.
- Repos write the storage representation (e.g. the raw UUID `.value`), never the public-facing serialization (e.g. `str(vo)` that returns a prefixed id). Mixing the two corrupts persisted data.
- Never log raw PII or secrets — use the masking helper the codebase already provides.

## TypeScript / Next.js

- `switch` on a status/union ends with a `default` that does `const _exhaustive: never = value` — a new status fails the build.
- Map backend status → UI representation in one exhaustive config object; don't scatter `if (status === ...)` across components. Every backend status must have a distinct visual state (this is exactly how a missing-status badge bug slips in).
- Derive complex view state in a single `derive*State()` function, not inline in JSX, so the logic is testable and the exhaustiveness is enforced in one place.
- Respect the component size budget — when a component outgrows it, extract rather than pile on conditionals.
- Keep types generated/imported from the contract source; don't hand-redeclare API shapes that drift from the backend.

## Data & contracts

- **Every `*_id` column needs an explicit FK** with a defined `ON DELETE` behavior (document inline exceptions). A bare id column is a future orphan.
- A schema change is a migration **plus** a docs update (database-schema doc) **plus** any affected contract/event version bump. All three or none.
- Maintain uniqueness/binding invariants at the DB level (unique indexes), not just in app code.
- When an API/event/schema contract changes, bump and document the version, and update **every** consumer in dependency order (see [multi-module-consistency.md](multi-module-consistency.md)).

## How to verify

- Run the repo's full gate: type-check + lint + tests (Python: `ruff` / `mypy` / `pytest`; TS: the project's `lint` / `typecheck` / `vitest`). Never hand-wave "tests probably pass."
- Apply a verification-before-completion discipline before claiming done — evidence (actual command output) before assertions.
- For UI changes, run a frontend QA pass (e.g. a Playwright smoke of the changed screens).
- Grep for the thing you changed across **all** modules to catch stragglers (duplicated enums, hardcoded ports, dropped-table references).
