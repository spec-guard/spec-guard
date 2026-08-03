# Spec 0004 - `config.json`'s agent list never drifts from reality

**Status:** IMPLEMENTED

## Context / Problem

`specguard init` builds `.spec-guard/config.json`'s `agents` array from scratch on every run
(`settings.agents = agentList`, written via `writeRepoConfig`'s shallow `Object.assign`, which
replaces the whole `agents` key rather than merging it). On a fresh install this is correct — the
first `--agent` list *is* the config. On an **already-initialized** repo, it silently discards any
agent not named in the current invocation.

This was hit for real: `specguard doctor` printed `hooks stale ... run: specguard init <repo>
--agent gemini --force` for a 5-agent repo (`serpro/code`); following that hint verbatim would have
dropped `claude-code`/`codex`/`github-copilot`/`opencode` from the config. The same shape of bug
fired via a bare `specguard init .` (no `--agent` at all, which defaults to `['claude-code']` on a
non-TTY) run against four already-multi-agent repos (`athmos`, `felipe`, `raspi`, `turbo-notity`),
narrowing each to `claude-code` only and — in `athmos` — clobbering a hand-edited managed-block
customization in the same pass. All five were caught and reverted via `git checkout` before commit;
none of the damage shipped.

Fixing the union surfaced two more instances of the same root cause (`config.json` drifting from
what's actually installed):

1. The union itself, applied unconditionally, meant a **bare, non-interactive** re-init (no
   `--agent`, no TTY) resolved its silent `['claude-code']` default and merged *that* in too —
   silently adding Claude Code support to `serpro/llmcatalog`, a repo deliberately configured for
   Codex only.
2. `uninstall --agent <x>` deletes that agent's files but was **never touching `config.json` at
   all** for a scoped uninstall (only a full, unscoped uninstall drops the whole `.spec-guard/`
   dir) — so removing an agent left it permanently listed in `agents` even though nothing backed
   it anymore, the mirror-image drift in the other direction.

## In-Scope

- `init` on an already-initialized repo unions the resolved agent list with the existing config's
  agents — but only when the resolution reflects real intent (explicit `--agent`, or a typed TTY
  prompt answer). A bare non-interactive re-init re-syncs the existing set unchanged instead of
  merging in the silent `['claude-code']` default.
- A fresh (`not already-initialized`) `init` is unaffected: the resolved list becomes the config,
  exactly as today.
- `uninstall --agent <x>` now also removes `<x>` from `config.json`'s `agents` array (previously
  file-only), including under `--dry-run` (previewed, not written).
- Agent *removal* stays exclusively `uninstall --agent <x>`'s job.

## Out-of-Scope

- Any other change to `uninstall`'s file-removal behavior.
- Any change to how a *fresh* `init` resolves its agent list (flag / TTY prompt / non-interactive
  default).
- Retroactively fixing repos already narrowed/grown by these bugs outside this session (the ones
  caught here were reverted or re-synced via git/re-init; any other affected repo is the
  maintainer's call).

## Acceptance Criteria

1. Re-running `specguard init <repo> --agent <X>` on a repo already configured for agents
   `{A, B}` where `X ∉ {A, B}` results in `config.agents === {A, B, X}`, not `{X}`.
2. Re-running plain, non-interactive `specguard init <repo>` (no `--agent`) on an already-configured
   repo leaves the existing agent set byte-for-byte untouched, even when `claude-code` was never
   among them.
3. A fresh `init` on a never-initialized repo is bit-for-bit unaffected: `config.agents` equals
   exactly the resolved list, nothing merged in.
4. `specguard uninstall <repo> --agent <X>` removes `X` from `config.agents` (and only `X`); a
   `--dry-run` previews that removal without writing it.
5. `npm test` stays green; regression tests cover criteria 1, 2, and 4.

## Traceability

- ADR 0011 (init never shrinks — nor silently grows — the configured agent set; uninstall is the
  one path that shrinks it, and now actually does).
