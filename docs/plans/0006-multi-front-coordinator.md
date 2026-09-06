# Plan 0006 — Multi-front coordinator (`/spec:coordinate`)

**Spec:** `docs/specs/0006-multi-front-coordinator.md`
**ADR:** `docs/reference/decisions/0012-multi-front-coordination.md`

## Context

Spec 0006 covers the whole feature (skill/docs/overlays and CLI mechanics together), but the two
halves are independently verifiable and were designed to be built in parallel once the governing
ADR/spec/plan trio exists. This plan records the intended execution order so the three pieces of
work land in a checkable sequence rather than all-at-once.

## Steps

1. **Governance trio (this document's own prerequisite).** ADR 0012, spec 0006, this plan, and the
   `docs/specs/README.md` status row — written and internally consistent before any code or skill
   content lands. (Done as of this plan's creation; status stays PROPOSED until steps 2-4 land.)
2. **Skill/docs/overlays content** (independent of step 3, no file overlap):
   - `skill/references/multi-front-coordination.md` (new)
   - `templates/commands/coordinate.md` (new)
   - Bridge sentences in `skill/references/spec-driven-loop.md` and
     `skill/references/multi-module-consistency.md`
   - One line in `skill/SKILL.md`'s reference index
   - One line + one sentence in `templates/commands/spec.md` (umbrella, stays a pure signpost)
   - One paragraph in each of the five `templates/agents/*/overlay.md` files, naming that
     harness's own native parallel-dispatch mechanism (spike each harness's current docs before
     finalizing the paragraph — see ADR 0012 Consequences and spec 0006 acceptance criterion 9)
3. **CLI mechanics** (independent of step 2, no file overlap):
   - `src/cli/coordinate.js` (new: `plan`, `start`, `report`, `status`, `watch`, `answer`, `merge`,
     `resolve-merge`, `finish`, `list`)
   - `schemas/config.schema.json` (`coordination` block) and `src/core/config.js` (defaults)
   - `src/core/topology.js` (`isGitRepoDir` hardening)
   - `src/cli/index.js` (register the new subcommands)
   - A nested, self-contained `.gitignore` under `.spec-guard/coordination/`, written by
     `coordinate.js` itself on first use (not via `init`/`migrate` — `coordinate` must work in any
     git repo standalone, and `privateDir` turned out not to be a clean precedent to reuse here:
     it only gets a root-`.gitignore` patch through the one-time `migrate` path, never on a plain
     `init`)
4. **Verification.**
   - `npm test` — full suite, including the render regression covering all five overlays'
     `spec-coordinate` mention.
   - IP-wall lint over every new/edited file under `docs/` and `skill/`.
   - Manual smoke tests per spec 0006's acceptance criteria 2, 3, 5, 6, 7 (overlap rejection,
     semantic conflict flagged without file overlap, merge-then-broken-test reverts to a blocker,
     no-test-command fails closed, worktree never created inside `repoRoot`).
5. **Close out.** Flip this spec's status row in `docs/specs/README.md` (and spec 0006's own
   `**Status:**` line) from PROPOSED to IMPLEMENTED once steps 2-4 are all green — not before. ADR 0012
   uses the repo's separate ADR status vocabulary (`Proposed → Accepted`, matching all 11 existing
   ADRs — never `IMPLEMENTED`, that's a spec-only value): flip its `**Status:**` line to `Accepted`
   at the same time.

## Critical files

- `src/cli/coordinate.js`, `src/core/config.js`, `src/core/topology.js`, `src/cli/index.js`,
  `schemas/config.schema.json`
- `skill/references/multi-front-coordination.md`, `skill/references/spec-driven-loop.md`,
  `skill/references/multi-module-consistency.md`, `skill/SKILL.md`
- `templates/commands/coordinate.md`, `templates/commands/spec.md`
- `templates/agents/{claude-code,codex,gemini,github-copilot,opencode}/overlay.md`
- `test/render.test.js` (existing regression this change must keep green)

## Verification

- `npm test` (full suite) is the single required gate before flipping spec 0006 to IMPLEMENTED and
  ADR 0012 to Accepted.
- No manual step in this plan replaces automated verification where a test can cover it; the
  manual smoke tests above exist because the coordinator's semantic-conflict judgment and the
  merge/test-gate failure path are not yet covered by automated tests in this repo.
