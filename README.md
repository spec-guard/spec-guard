# spec-guard

> **Context before code. Spec before edits. Verify against the spec, not the vibe.**

`spec-guard` is a front-of-pipeline **governance** layer for spec-driven development with AI
coding agents — in large, multi-module, multi-repo codebases. It installs as an always-on skill
plus slash commands and lifecycle hooks for **Claude Code, Codex, GitHub Copilot, Gemini CLI, and
opencode** (incl. OpenWork), all rendered from a single source.

Where GitHub **Spec Kit** and **OpenSpec** give you the *mechanics* of spec-driven development
(scaffolding, slash commands), spec-guard adds the *governance* they lack — and brings the
mechanics along too.

## What it gives you

- **The loop, enforced.** `ORIENT → SPEC → PLAN → BUILD → VERIFY → SYNC`, injected into every
  session so non-trivial work starts from the governing docs, not from memory.
- **The IP/deliverable wall.** Three categories, not two: deliverable docs (`docs/`), a
  **harness-agnostic** IP knowledge base (`.private/`, configurable), and per-agent integration
  (`.claude/`, `.codex/`, `.github/`, `.gemini/`, `.opencode/`). `doctor` lints it; `docs/` may
  never link into internal content.
- **Multi-git topology intelligence.** Understands a "monorepo" that is actually N deliverable git
  repos plus a private backup monorepo, and reasons about contract ripple and commit order across
  repo boundaries — something single-repo tools can't.
- **One source, every agent.** A single skill + command set rendered per agent via a path matrix.
  Adding an agent is a row, not a fork.
- **Commit, governed.** `spec-guard commit` produces a Conventional Commit (no AI attribution),
  single repo or `--all` across the backup monorepo in dependency order.
- **Optional graphify enhancer.** When a `graphify-out/` knowledge graph exists, ORIENT/VERIFY use
  it; otherwise it falls back to grep/read. Never required.

## Install

```bash
npm install -g @spec-guard/cli      # or: npx @spec-guard/cli <command>
spec-guard install --global         # wire your machine's Claude Code / Codex hooks
spec-guard init .                    # install into a project
```

## The loop

```
1. ORIENT  — read the repo's governing docs/ADRs before touching code
2. SPEC    — locate or write the spec (scope, acceptance, traceability)
3. PLAN    — decompose into small verifiable increments
4. BUILD   — implement one increment; match the surrounding code
5. VERIFY  — check output against the spec + anti-regression invariants; run tests
6. SYNC    — update docs/contracts/cross-references; commit
```

Run `/spec` for the umbrella — it prints the loop and shows where the task stands. The phases
map to it: `/spec:orient`, `/spec:write`, `/spec:verify`, `/spec:sync`, `/spec:status`,
`/spec:commit`.

## Supported agents

| Agent | Skill | Commands | Rules file |
|-------|-------|----------|------------|
| Claude Code | `.claude/skills/` | `.claude/commands/spec/` | `CLAUDE.md` |
| Codex | `~/.codex/skills/` | — (natural language) | `AGENTS.md` |
| GitHub Copilot | `.github/skills/` | `.github/prompts/` | `.github/copilot-instructions.md` |
| Gemini CLI | `.gemini/extensions/` | `…/commands/spec/*.toml` | `GEMINI.md` |
| opencode (+ OpenWork) | `.opencode/skill/` | `.opencode/command/spec-*.md` | `AGENTS.md` |

## Commands

| Command | Purpose |
|---------|---------|
| `init [--agent …] [--scaffold] [--scope …]` | Install into a repo (per-agent skill, commands, hooks, rules-block) |
| `update` | Re-render owned files idempotently (manifest-guarded; never clobbers your edits) |
| `install --global` | Wire a machine's Claude Code / Codex hooks |
| `doctor` | Diagnose install health, repo topology, and the IP/deliverable wall |
| `commit [--all] [--scope …] -m …` | Conventional Commit, single repo or across the backup monorepo |
| `migrate [--apply]` | Transitional: upgrade an old-model repo to the current layout |
| `self check|upgrade|rollback` | Update the CLI itself |
| `status` · `toggle on|off` | Show state · governance switch |

## Configuration

`.spec-guard/config.json` (written by `init`):

```json
{
  "specDir": "docs/specs",
  "plansDir": "docs/plans",
  "privateDir": ".private",
  "commitLanguage": "en",
  "agents": ["claude-code", "codex"]
}
```

## Migrating an existing repo

```bash
spec-guard migrate            # dry-run: shows the plan
spec-guard migrate --apply    # move .claude IP -> .private, docs/superpowers -> docs/{specs,plans}, sweep refs
```

## Status

Early (`v0.x`). Built and dogfooded on itself. See [`docs/specs/`](docs/specs/) for the living
spec and [`docs/reference/decisions/`](docs/reference/decisions/) for the ADRs.

## License

[MIT](LICENSE).
