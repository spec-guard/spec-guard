# Spec 0004 - `init` on an already-initialized repo never shrinks the agent list

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

## In-Scope

- `init` on an already-initialized repo (`.spec-guard/config.json` exists) merges the resolved
  agent list with the repo's existing configured agents (union), regardless of whether `--agent`
  was passed explicitly or defaulted.
- A fresh (`not already-initialized`) `init` is unaffected: the resolved list becomes the config,
  exactly as today.
- Agent *removal* stays exclusively `uninstall --agent <x>`'s job (unchanged, already documented).

## Out-of-Scope

- Any change to `uninstall`'s behavior.
- Any change to how a *fresh* `init` resolves its agent list (flag / TTY prompt / non-interactive
  default).
- Retroactively fixing repos already narrowed by this bug outside this session (the five caught
  here were reverted via git; any other affected repo is the maintainer's call).

## Acceptance Criteria

1. Re-running `specguard init <repo> --agent <X>` on a repo already configured for agents
   `{A, B}` where `X ∉ {A, B}` results in `config.agents === {A, B, X}`, not `{X}`.
2. Re-running plain `specguard init <repo>` (no `--agent`) on an already-multi-agent repo leaves
   the existing agent set untouched (union with the non-interactive default `['claude-code']`,
   which is already a member, is a no-op).
3. A fresh `init` on a never-initialized repo is bit-for-bit unaffected: `config.agents` equals
   exactly the resolved list, nothing merged in.
4. `npm test` stays green; a new regression test covers criterion 1.

## Traceability

- ADR 0011 (init never shrinks the configured agent set on re-init).
