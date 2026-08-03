# ADR 0011 — `init` never shrinks the configured agent set

**Status:** Accepted

## Context

`init` builds `.spec-guard/config.json` from scratch on every invocation:
`settings = { specDir, plansDir, privateDir, agents: agentList }`, then `writeRepoConfig` shallow-
merges that object over the existing file (`Object.assign({}, existing, settings)`). Because
`agents` is always a key of `settings`, that shallow merge always replaces the whole array — it
never unions with what was there.

For a first-time `init` this is exactly right. For an **already-initialized** repo it is a trap:
`--agent <one-agent>` (explicit, e.g. following `doctor`'s own stale-hook repair hint) or a bare
`init` with no flag at all (which resolves to `['claude-code']` on a non-TTY) both silently drop
every other previously-configured agent. This fired for real against five repos in one session —
`doctor`'s own suggested repair command for a single stale Gemini hook would have deleted four
other agents' configuration from a repo that had them all working.

## Decision

When `.spec-guard/config.json` already exists, `init` **unions** the resolved agent list with the
existing config's `agents` array instead of replacing it — but only when the resolved list reflects
real intent: an explicit `--agent` flag, or an answer typed at the interactive TTY prompt. A bare,
non-interactive re-init (no `--agent`, no TTY to ask — the common CI/script/"just re-sync me" case)
resolves to the silent `['claude-code']` default with no user behind it, so on an already-initialized
repo that default is discarded in favor of **just re-rendering the existing agent set unchanged**
— it must not silently grow the config either. (This second half was found the same way as the
first: fixing the union case and re-running `init .`, no flag, non-interactively across real repos
silently added `claude-code` to one that was deliberately Codex-only.)

A fresh (never-initialized) repo is unaffected either way — the resolved list becomes the config,
exactly as before.

Removing an agent's integration remains exclusively `uninstall`'s job
(`specguard uninstall . --agent <x>`), which deletes that agent's owned files **and** now also
drops it from `config.json`'s `agents` array (previously it only removed the files, leaving the
config claiming an agent that was no longer there — fixed alongside this ADR, same root cause:
`config.json` and reality drifting apart). `init` growing-only (or holding steady) and `uninstall`
shrinking-only means the two commands stay non-overlapping and the config never lies in either
direction.

## Consequences

- `doctor`'s existing stale-hook repair hints (e.g. `specguard init <repo> --agent gemini --force`)
  become safe to follow literally on a multi-agent repo — they now refresh the named agent without
  touching the others. No hint text needed to change.
- A bare `specguard init .` re-run (no `--agent`, on a non-TTY) can no longer silently narrow a
  multi-agent repo to `claude-code` only, **nor** silently grow a single-agent repo to include it.
- Intentionally dropping an agent from a repo has exactly one path (`uninstall --agent <x>`), and
  that path now actually updates `config.json`, not just the filesystem.
