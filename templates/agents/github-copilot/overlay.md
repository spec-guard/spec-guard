---

## In GitHub Copilot

Use `#spec.prompt.md` for the umbrella (the loop map + where the task stands); the phases are
prompt files under `.github/prompts/` (`spec-orient`, `spec-write`, `spec-verify`, `spec-sync`,
`spec-commit`, `spec-status`). This governance also lives as always-on background guidance in
`.github/copilot-instructions.md`. Treat every non-trivial change as gated by the loop above.

Use `#spec-coordinate.prompt.md` to run several specs/features as isolated parallel fronts:
dispatch each front with `/fleet` (Copilot CLI's own parallel-subagent orchestrator) so they run
concurrently and isolated, and track them with `/tasks`. The mechanics (worktree, ledger,
sequential merge) are `specguard coordinate <verb>`.
