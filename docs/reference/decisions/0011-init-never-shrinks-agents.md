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
existing config's `agents` array instead of replacing it. A fresh (never-initialized) repo is
unaffected — the resolved list becomes the config, as before.

Removing an agent's integration remains exclusively `uninstall`'s job
(`specguard uninstall . --agent <x>`), which already deletes that agent's owned files and manifest
entries surgically. `init` growing-only means the two commands stay non-overlapping: `init` adds/
refreshes, `uninstall` removes. There is no `init` flag to shrink the set — that asymmetry is
intentional, not an oversight.

## Consequences

- `doctor`'s existing stale-hook repair hints (e.g. `specguard init <repo> --agent gemini --force`)
  become safe to follow literally on a multi-agent repo — they now refresh the named agent without
  touching the others. No hint text needed to change.
- A bare `specguard init .` re-run (no `--agent`, the common "just make sure I'm current" case) can
  no longer silently narrow a multi-agent repo to `claude-code` only.
- Intentionally dropping an agent from a repo now has exactly one path (`uninstall --agent <x>`),
  removing the ambiguity of two commands that could both shrink the set.
