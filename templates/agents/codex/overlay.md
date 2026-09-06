---

## In Codex

This skill is injected automatically every session by the SessionStart hook in
`~/.codex/hooks.json`. There are no file-backed slash commands in this version — invoke the
loop steps in natural language ("orient on this surface", "write the spec", "verify against the
spec", "sync the docs"). The same governance applies.

To coordinate several specs/features as isolated parallel fronts, ask in natural language ("run
these as parallel fronts") — Codex dispatches subagents (explorer/worker roles) each isolated in
its own git worktree, up to several concurrent. The mechanics (ledger, sequential merge) are
`specguard coordinate <verb>`.
