---

## In Claude Code

Run `/spec` for the umbrella — it prints the loop, the phase commands, and where the current
task stands. The phases map to: `/spec:orient`, `/spec:write`, `/spec:verify`, `/spec:sync`,
then `/spec:commit` (the terminal step of SYNC — refresh the knowledge graph if present, then
commit), and `/spec:status` anytime. This skill is also injected automatically every session by the
SessionStart hook, and a `[SPEC-GUARD]` badge shows in the statusline while active. Turn it off
with `specguard off`.

`/spec:coordinate` runs several specs/features as isolated parallel fronts: it dispatches each
front as its own subagent session isolated in a dedicated git worktree; a front that hits a human
decision notifies the coordinating session instead of blocking it, so the other fronts keep
running. The mechanics (worktree, ledger, sequential merge) are `specguard coordinate <verb>`.
