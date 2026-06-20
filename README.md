# spec-guard

[![npm](https://img.shields.io/npm/v/@spec-guard/cli.svg)](https://www.npmjs.com/package/@spec-guard/cli)
[![CI](https://github.com/spec-guard/spec-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/spec-guard/spec-guard/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](package.json)

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
- **Reversible by design.** Every file it writes is tracked in a manifest; `update` never clobbers
  your edits, and `uninstall` removes exactly what it added (and nothing of yours).
- **Optional graphify enhancer.** When a `graphify-out/` knowledge graph exists, ORIENT/VERIFY use
  it; otherwise it falls back to grep/read. Never required.

## Requirements

- **Node.js ≥ 20**
- One or more supported agents (Claude Code, Codex, GitHub Copilot, Gemini CLI, opencode)

## Install

```bash
npm install -g @spec-guard/cli      # or run ad-hoc with: npx @spec-guard/cli <command>
spec-guard install --global         # wire this machine's Claude Code / Codex session hooks
spec-guard init .                   # install into the current project
```

Greenfield project? Add `--scaffold` to also lay down the `docs/` + `.private/` doc tree:

```bash
spec-guard init . --agent claude-code,codex --scaffold
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
| Claude Code | `.claude/skills/` | `.claude/commands/spec/` + `spec.md` (umbrella) | `CLAUDE.md` |
| Codex | `~/.codex/skills/` | — (natural language) | `AGENTS.md` |
| GitHub Copilot | `.github/skills/` | `.github/prompts/spec-*.prompt.md` | `.github/copilot-instructions.md` |
| Gemini CLI | `.gemini/extensions/` | `…/commands/spec/*.toml` + `spec.toml` | `GEMINI.md` |
| opencode (+ OpenWork) | `.opencode/skill/` | `.opencode/command/spec-*.md` | `AGENTS.md` |

## Commands

| Command | Purpose |
|---------|---------|
| `init [path] [--agent …] [--scaffold] [--spec-dir …] [--plans-dir …] [--scope all]` | Install into a repo (per-agent skill, commands, hooks, rules-block) |
| `update [path]` | Re-render owned files idempotently (manifest-guarded; never clobbers your edits) |
| `install --global` | Wire a machine's Claude Code / Codex session hooks + statusline |
| `uninstall [path] [--global] [--purge] [--dry-run]` | Remove spec-guard from a repo, or from this machine |
| `doctor [path]` | Diagnose install health, repo topology, and the IP/deliverable wall |
| `commit [--all] [--scope …] -m …` | Conventional Commit, single repo or across the backup monorepo |
| `migrate [--apply]` | Transitional: upgrade an old-model repo to the current layout |
| `self check\|upgrade\|rollback` | Update the CLI itself |
| `status` · `toggle on\|off` (aliases `on`/`off`) | Show state · governance switch |

### Common flags

| Flag | Applies to | Meaning |
|------|------------|---------|
| `--agent <list>` | `init`, `uninstall` | Comma-separated agents (default: `claude-code`) |
| `--scaffold` | `init` | Also create the `docs/` + `.private/` doc tree (write-if-absent) |
| `--spec-dir` / `--plans-dir` | `init` | Override the spec/plan locations (default `docs/specs`, `docs/plans`) |
| `--scope all` | `init` | Treat the tree as a backup monorepo (record module list for ripple/commit order) |
| `--global` | `install`, `uninstall` | Operate on the machine, not a repo |
| `--purge` | `uninstall --global` | Also forget preferences (XDG config + the on/off flag) |
| `--dry-run` | `uninstall` | Print the plan and change nothing |
| `--force` | `init`, `update` | Overwrite even user-edited owned files (skips the sidecar guard) |
| `--apply` | `migrate` | Apply the migration (otherwise dry-run) |

## Uninstall

spec-guard tracks every file it writes, so removal is exact — it deletes only what it added and
leaves your `docs/`, specs, plans, and `.private/` untouched. Rules files (`CLAUDE.md`,
`AGENTS.md`, …) are never deleted; only the managed block between the
`<!-- spec-guard:start -->` / `<!-- spec-guard:end -->` markers is stripped, preserving your
surrounding content.

**From a project:**

```bash
spec-guard uninstall .              # remove skill, commands, rules-block, .spec-guard/
spec-guard uninstall . --dry-run    # preview exactly what would be removed
spec-guard uninstall . --agent gemini   # remove only one agent's integration
```

**From your workstation (the global install):**

```bash
spec-guard uninstall --global             # unwire Claude Code / Codex hooks + statusline,
                                          #   remove the global skill + hook bundle
spec-guard uninstall --global --dry-run   # preview
spec-guard uninstall --global --purge     # also forget the on/off preference + XDG config
```

Co-tenant hooks (e.g. other tools wired into the same `settings.json`) are matched by identity and
**never touched**. Order doesn't matter, but for a full removal run both the per-project and the
`--global` uninstall.

> **Note:** the global statusline is a combined script that may also drive other tools' badges;
> `uninstall --global` removes spec-guard's entry, which clears that combined statusline. Re-add
> your own statusline afterwards if you had one.

## Safety model

- **Manifest-guarded writes.** Each installed file is recorded with a content hash in
  `.spec-guard/manifest.json` (per repo) or `~/.config/spec-guard/manifest.json` (global). On
  `update`/`self upgrade`, an unchanged file is refreshed, but a file you edited is left in place
  and the new version is written next to it as `<file>.spec-guard-update`.
- **Block-scoped rules.** In rules files spec-guard owns only the delimited block; your prose is
  never read into the hash or overwritten.
- **Reversible.** `uninstall` mirrors install through the same path matrix, so it removes exactly
  the set of files install created.

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

## Contributing

Issues and PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the dev loop (`npm test` runs
the suite) and [docs/RELEASING.md](docs/RELEASING.md) for the release process (release-please).

## Status

Early (`v0.x`). Built and dogfooded on itself. See [`docs/specs/`](docs/specs/) for the living
spec and [`docs/reference/decisions/`](docs/reference/decisions/) for the ADRs.

## License

[MIT](LICENSE).
