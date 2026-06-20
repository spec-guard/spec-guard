# ADR 0007 — Binary `specguard` + a single `init` front door

**Status:** Accepted

## Context

Two ergonomics problems surfaced once the CLI was exercised against the prior art (GitHub
**Spec Kit** / `specify`, **OpenSpec** / `openspec`):

1. **Verb collision.** Machine wiring was `install --global`, but `--global` was the *only* valid
   mode of `install` (it errored without it). Meanwhile per-project install was `init`. So `init`
   and `install` both meant "install" at different scopes, and `--global` was mandatory-and-only on
   `install` yet optional-one-of-two on `uninstall` — asymmetric and confusing.
2. **Silent agent default + two-step onboarding.** `init` defaulted silently to `claude-code` and
   then *printed* "run install --global". Both reference tools instead use **one** front door
   (`specify init` / `openspec init`) with **interactive agent selection**, and never require a
   second machine-install command (their "global" surface is preferences only).
3. **Hyphenated binary.** The invoked binary was `spec-guard`. Both competitors ship a single
   unhyphenated token (`specify`, `openspec`), matching the broad norm for frequently-typed CLIs
   (`git`, `npm`, `kubectl`, `eslint`, `pnpm`).

spec-guard legitimately differs from both: it injects governance via **session lifecycle hooks**
(`SessionStart`/`Stop`), a real machine-level mutation the others don't perform. So a machine step
must exist — the fix is naming/ergonomics, not removing it.

## Decision

- **Binary → `specguard`** (single token, no hyphen). The npm package stays `@spec-guard/cli`
  (hyphen idiomatic in scoped package names) and the product brand stays "spec-guard" in prose.
  Internal identifiers are unchanged: the `.spec-guard/` control dir, the `<!-- spec-guard:start -->`
  rules-block markers, `specGuardManaged`, the `.spec-guard-active` flag, the `[SPEC-GUARD]` badge,
  and manifest keyspaces.
- **`install --global` → `setup`.** The command *is* the machine operation; no redundant flag.
  `uninstall --global` remains the machine teardown. `wireMachine()` is extracted so `init` can
  call it.
- **`init` is the single front door.** On a TTY it prompts for agents and offers to wire the
  machine; non-interactively it stays safe (defaults to `claude-code`, never mutates machine config
  unless `--with-global`). New flags: `--agent all|none|<list>`, `--with-global`, `--no-global`.

## Consequences

- Breaking CLI surface change (acceptable pre-1.0, no back-compat shims kept by design).
- One-command onboarding: `specguard init .` (interactive) or
  `specguard init . --agent … --with-global` (CI).
- Non-interactive runs never silently touch `~/.claude/settings.json` — machine wiring requires an
  explicit `--with-global` or the standalone `setup`.
- Docs, command templates, the Claude Code overlay, and user-facing messages now say `specguard`;
  historical ADRs/specs keep their original command names as point-in-time records.
