# ADR 0003 — Single-source, per-agent rendering

**Status:** Accepted

## Context

spec-guard targets Claude Code, Codex, GitHub Copilot, and Gemini CLI. Each agent has its own
conventions: skill dir, slash-command location + format (markdown vs TOML), lifecycle-hook
config, and a rules/context file. Maintaining hand-copied per-agent files would drift.

## Decision

Keep ONE logical source (`skill/`, `templates/commands/`) and **render per agent** via a
path matrix (`src/core/agents.js`). `render.js` substitutes `${specDir}`, `${plansDir}`,
`${agentName}` and emits the agent's command format (markdown for Claude/Copilot, TOML for
Gemini). Agent-specific prose lives in `templates/agents/<agent>/overlay.md`, never as
conditionals inside the source. Adding an agent = adding a matrix row + an overlay.

Per-agent targets:

| Agent | Skill dir | Commands | Hooks | Rules file |
|---|---|---|---|---|
| claude-code | `.claude/skills/spec-guard/` | `.claude/commands/spec/*.md` | `settings.json` | `CLAUDE.md` |
| codex | `~/.codex/skills/spec-guard/` | skills+hooks (v0.1.0) | `~/.codex/hooks.json` | `AGENTS.md` |
| github-copilot | `.github/skills/spec-guard/` | `.github/prompts/spec-*.prompt.md` | Copilot JSON hooks | `.github/copilot-instructions.md` |
| gemini | `.gemini/extensions/spec-guard/skills/…` | `…/commands/spec/*.toml` | extension `hooks/hooks.json` | `GEMINI.md` |

## Consequences

- New agents are cheap (a row + overlay), no core changes.
- Gemini is packaged as an extension (`gemini-extension.json`).
- The render contract is deterministic and unit-testable.
