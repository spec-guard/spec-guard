# ADR 0005 — Two-tier ownership + manifest guard

**Status:** Accepted

## Context

spec-guard writes both machine-level files (global skill, hooks wired into `settings.json` /
`~/.codex/hooks.json`, the shared statusline) and per-repo files (per-repo rendered skill,
slash commands, a rules-file block). `install --global` and `init` would otherwise contend
for the same targets, and `update` must never clobber a file the user hand-edited.

## Decision

**Two-tier ownership:**

- **Global manifest** (`~/.config/spec-guard/manifest.json`) owns machine-level files and the
  hook entries in `settings.json` / `~/.codex/hooks.json`; written only by `install --global`.
- **Repo manifest** (`<repo>/.spec-guard/manifest.json`) owns per-repo rendered files, slash
  commands, and the rules-file block; written by `init`.

`init` does not patch global hook configs; if global hooks are absent it instructs the user to
run `install --global` first.

**Manifest guard:** each owned file carries a content hash. On `update`, a hash match → overwrite;
a divergence (user-edited) → write a `<file>.spec-guard-update` sidecar and warn, never clobber.
Partial-file ownership (`blockOwned`) covers the rules-file block: only the delimited
`<!-- spec-guard:start … end -->` region is hashed and replaced in place. The hook configs are
patched by a 4-case surgical JSON merge that matches owned entries by a `spec-guard-managed`
marker (with a path fallback for legacy entries), so co-tenant hooks are never touched and
re-pointing never double-injects.

## Consequences

- `install --global` and `init` have non-overlapping ownership.
- User edits to owned files are preserved (sidecar + warning).
- User content (`docs/specs`, `docs/plans`, `CLAUDE.md` body, ADRs) is never owned.
