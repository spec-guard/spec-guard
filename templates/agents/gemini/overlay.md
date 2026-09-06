---

## In Gemini CLI

Installed as the `spec-guard` extension. Run `/spec` for the umbrella (the loop map + where the
task stands); the phases are custom commands (`/spec:orient`, `/spec:write`, `/spec:verify`,
`/spec:sync`, then `/spec:commit` to close SYNC — refresh the knowledge graph if present, then
commit — and `/spec:status` anytime). The skill is activated each session via the extension's hooks.
Project conventions are also recorded in `GEMINI.md`.

`/spec:coordinate` runs several specs/features as isolated parallel fronts, using Gemini CLI's
own subagents (hub-and-spoke dispatch) and the `--worktree`/`-w` flag to isolate each front in its
own worktree. The mechanics (ledger, sequential merge) are `specguard coordinate <verb>`.
