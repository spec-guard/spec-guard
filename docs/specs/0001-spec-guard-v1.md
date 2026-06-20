# Spec 0001 — spec-guard v1

**Status:** APPROVED

## Context / Problem

spec-guard began as a hand-wired personal Claude Code skill (a `SKILL.md` + references +
loose hook scripts + an XDG config). It encodes governance that the market leaders (GitHub
Spec Kit, OpenSpec) lack — the IP/deliverable wall, multi-module/multi-git intelligence,
cross-language anti-regression — but its *mechanics* are amateur: no installer, no
versioning, no self-update, no multi-agent rendering, and hard couplings to a specific
folder convention. v1 turns it into a professional, installable, multi-agent OSS product
without losing the governance.

## In-Scope

- A Node/npm CLI `@spec-guard/cli` with `init`, `update`, `self`, `status`, `doctor`,
  `toggle`, `install --global`, `uninstall` (per-repo + `--global`/`--purge`), `commit`,
  and `migrate`.
- Single-source skill + command set, **rendered per agent** for Claude Code, Codex,
  GitHub Copilot, and Gemini CLI (skill, slash commands, lifecycle hooks, and a managed
  rules-file block per agent).
- Decoupling from the `superpowers` folder convention via a configurable `${specDir}` /
  `${plansDir}` (default `docs/specs` / `docs/plans`).
- Two-axis self-update (`self upgrade` for the binary, `update` for scaffolded files) with
  a manifest hash-guard that never clobbers user-edited files.
- Differentiators: multi-git topology detection, IP/deliverable wall linting, an optional
  graphify enhancer (graceful fallback), and greenfield project scaffolding.
- Turbo Notify as the pilot consumer.

## Out-of-Scope (v1)

- Agents beyond the four named (others are added later as path-matrix rows).
- A separate `constitution.md` (the existing `CLAUDE.md` + ADRs + references are the
  constitution; we augment, not fork).
- A hosted service / marketplace.
- Rewriting the governance content itself (it ports as-is, only decoupled + Englished).

## Design (summary)

Single source in `skill/` + `templates/` → `src/core/render.js` substitutes
`${specDir}/${plansDir}/${agentName}` and emits per-agent files via the `src/core/agents.js`
path matrix. Config resolves repo-local `.spec-guard/config.json` over XDG global. Ownership
is two-tier (global manifest for machine-level files; repo manifest for per-repo files),
with partial-file (`blockOwned`) entries for rules-file blocks. Topology detection classifies
the repo (single / multi-git-root / deliverable-subrepo / already-initialized) and is aware
of the nested-git-backup pattern. Full design: the approved plan and the ADRs below.

## Acceptance Criteria

1. `npx @spec-guard/cli init <dir> --agent claude-code,codex,github-copilot,gemini` produces
   the per-agent skill/commands/rules-block at the matrix paths, and `spec-guard --version`
   runs.
2. `npm pack --dry-run` never includes `.claude/` (no IP leak in the tarball).
3. The rendered skill contains no hardcoded `superpowers` path and no `superpowers:` strings;
   the configured `${specDir}` appears instead.
4. `install --global` over a settings file that already has co-tenant hooks leaves them
   byte-identical and produces exactly one spec-guard entry per lifecycle event (no
   double-injection).
5. `doctor` reports repo topology and flags only real `.claude/` hyperlinks under `docs/`
   (prose mentions are not violations).
6. `update` never overwrites a user-edited owned file (writes a `.spec-guard-update` sidecar)
   and never touches `docs/specs` / `docs/plans`.

## Traceability

Produces ADRs [0001](../reference/decisions/0001-node-npm-runtime.md),
[0002](../reference/decisions/0002-spec-dir-convention.md),
[0003](../reference/decisions/0003-single-source-multi-agent-rendering.md),
[0004](../reference/decisions/0004-graphify-optional-enhancer.md),
[0005](../reference/decisions/0005-two-tier-ownership-manifest.md).

## Migrations / Rollout

Phased: bootstrap → extract/decouple → CLI/render → differentiators → E2E verification →
Turbo Notify pilot + `v0.1.0`. Pilot migration moves `docs/superpowers/{specs,plans}` →
`docs/{specs,plans}` via `git mv` (history-preserving) with a full cross-reference sweep.
