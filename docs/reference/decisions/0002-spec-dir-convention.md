# ADR 0002 — Spec directory convention (decouple from `superpowers`)

**Status:** Accepted

## Context

The original skill hardcoded `docs/superpowers/specs/` (a `superpowers`-skill-specific
folder) in two places, coupling spec-guard to one environment's layout. An OSS tool must not
assume a private skill's directory names.

## Decision

Specs/plans live at a **configurable** location, default **`docs/specs` + `docs/plans`**
(deliverable, agnostic). The skill templates reference `${specDir}` / `${plansDir}`,
substituted at render time from `.spec-guard/config.json`. The rendered output ships **no**
`superpowers` path and **no** `superpowers:` skill strings; the "Composes with" section uses
generic capability names ("a brainstorming skill", "a TDD skill").

## Consequences

- spec-guard works in any repo regardless of which companion skills exist.
- Pilot migration renames `docs/superpowers/{specs,plans}` → `docs/{specs,plans}` (history
  preserved via `git mv`) with a full cross-reference sweep.
- The spec location is per-repo config, not a global assumption.
