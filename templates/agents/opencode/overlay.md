---

## In opencode (and OpenWork)

Use `/spec` for the umbrella (the loop map + where the task stands); the phases are custom
commands under `.opencode/commands/` (`spec-orient`, `spec-write`, `spec-verify`, `spec-sync`,
`spec-commit`, `spec-status`). This governance also lives as always-on project memory in
`AGENTS.md` (opencode reads it every session). OpenWork, being powered by opencode, picks this up
automatically. Treat every non-trivial change as gated by the loop above.

Use `/spec-coordinate` to run several specs/features as isolated parallel fronts: opencode
delegates each front to a resumable, inspectable child session via `@agent`, isolated in its own
git worktree. The mechanics (ledger, sequential merge) are `specguard coordinate <verb>`.
