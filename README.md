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

> **Naming:** the npm package is **`@spec-guard/cli`**, the command you run is **`specguard`**
> (one word, no hyphen), and the project/brand is **spec-guard**.

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
- **Commit, governed.** `specguard commit` produces a Conventional Commit (no AI attribution),
  single repo or `--all` across the backup monorepo in dependency order.
- **Reversible by design.** Every file it writes is tracked in a manifest; `update` never clobbers
  your edits, and `uninstall` removes exactly what it added (and nothing of yours).
- **Optional graphify enhancer.** When a `graphify-out/` knowledge graph exists, ORIENT/VERIFY use
  it; otherwise it falls back to grep/read. Never required.

## Do I need the advanced parts?

**Most users have one repo: just `specguard init .` and use the loop — you're done.** The
governance (read-docs-first, spec-before-edits, verify-against-spec) works out of the box.

The heavier features are **opt-in** and aimed at teams shipping deliverable repos to a client:

- the **IP/deliverable wall** (`.private/`) matters when you keep internal notes you must *not* ship;
- the **backup-monorepo / multi-git** intelligence (`--scope all`, `commit --all`) matters when one
  workspace holds N separate git repos delivered separately.

If neither applies to you, you can ignore `.private/`, `--scope`, and `--all` entirely.

## Requirements

- **Node.js ≥ 20**
- One or more supported agents (Claude Code, Codex, GitHub Copilot, Gemini CLI, opencode)

## Install

```bash
npm install -g @spec-guard/cli      # or run ad-hoc with: npx @spec-guard/cli <command>
specguard init .                    # one command: pick agents, set up the project, offer to wire the machine
```

`init` is the single front door — on a TTY it prompts for which agents to set up and offers to wire
this machine's session hooks; pass flags to skip the prompts in CI:

```bash
specguard init . --agent claude-code,codex --with-global --scaffold   # non-interactive, also wire the machine
specguard init . --agent all --no-global                              # every agent, don't touch machine config
specguard setup                                                       # (re)wire just the machine hooks + statusline
```

## Quickstart

1. **Install + initialize** (above): `specguard init .`. On a TTY it asks which agents to set up and
   offers to wire this machine's hooks right there — so that's usually all you run. (In CI, add
   `--with-global`, or run `specguard setup` separately.)
2. **Open your agent and just work.** spec-guard is active every session — no command needed. In
   Claude Code you'll see a `[SPEC-GUARD]` badge, and the loop is injected automatically, so the
   agent reads your governing docs/ADRs *before* writing code and verifies against the spec after.
3. **Drive the phases explicitly when you want** (Claude Code / Gemini slash commands; other agents
   use natural language — "orient on X", "write the spec", "commit this"):

   | Command | When |
   |---------|------|
   | `/spec` | Show the loop and where the current task stands |
   | `/spec:orient` | Load the docs/ADRs governing the surface you're about to touch |
   | `/spec:write` | Locate or write the spec (scope, acceptance, traceability) |
   | `/spec:verify` | Check the result against the spec + run the test/lint gate |
   | `/spec:sync` | Update the docs/contracts the change affects |
   | `/spec:commit` | Refresh the knowledge graph (if present), then commit (Conventional, no AI attribution) |

4. **Turn it off / on** anytime: `specguard off` / `specguard on` (persists across sessions).
5. **Something not working?** `specguard doctor` checks install health, repo topology, and the
   IP/deliverable wall, and tells you what to fix.

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
| `init [path] [--agent all\|none\|…] [--with-global\|--no-global] [--scaffold] [--spec-dir …] [--plans-dir …] [--private-dir …] [--scope all]` | Install into a repo (per-agent skill, commands, hooks, rules-block); prompts on a TTY |
| `update [path]` | Re-render owned files idempotently (manifest-guarded; never clobbers your edits) |
| `setup` | Wire this machine's Claude Code / Codex session hooks + statusline |
| `uninstall [path] [--global] [--purge] [--dry-run]` | Remove spec-guard from a repo, or from this machine |
| `doctor [path]` | Diagnose install health, repo topology, and the IP/deliverable wall |
| `commit [--all] [--scope …] [--graphify] -m …` | Commit a message **you** author (validated as Conventional, AI attribution stripped), single repo or across the backup monorepo; `--graphify` refreshes the knowledge graph first |
| `migrate [--apply]` | Transitional: upgrade an old-model repo to the current layout |
| `self check\|upgrade\|rollback` | Update the CLI itself |
| `status` · `toggle on\|off` (aliases `on`/`off`) | Show state · governance switch |

### Common flags

| Flag | Applies to | Meaning |
|------|------------|---------|
| `--agent <list>` | `init`, `uninstall` | Comma-separated agents, or `all` / `none` (default on a TTY: prompt; else `claude-code`) |
| `--with-global` / `--no-global` | `init` | Wire (or skip) this machine's hooks without prompting |
| `--scaffold` | `init` | Also create the `docs/` + `.private/` doc tree (write-if-absent) |
| `--spec-dir` / `--plans-dir` | `init` | Override the spec/plan locations (default `docs/specs`, `docs/plans`) |
| `--private-dir` | `init`, `migrate` | Override the IP knowledge-base location (default `.private`) |
| `--scope all` | `init` | Treat the tree as a backup monorepo (record module list for ripple/commit order) |
| `--scope <a,b>` | `commit` | Commit only the named modules (otherwise `--all` = every impacted one) |
| `--graphify` | `commit` | Refresh the `graphify-out/` knowledge graph (structural) **before** committing |
| `--add` | `commit` | Stage all changes first (`git add -A`), then commit |
| `--global` | `uninstall` | Operate on the machine, not a repo |
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
specguard uninstall .              # remove skill, commands, rules-block, .spec-guard/
specguard uninstall . --dry-run    # preview exactly what would be removed
specguard uninstall . --agent gemini   # remove only one agent's integration
```

**From your workstation (the global install):**

```bash
specguard uninstall --global             # unwire Claude Code / Codex hooks + statusline,
                                         #   remove the global skill + hook bundle
specguard uninstall --global --dry-run   # preview
specguard uninstall --global --purge     # also forget the on/off preference + XDG config
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

You normally don't edit this by hand — `init` writes it from your flags. If you do change a value,
re-run `specguard update` to re-render the owned files against it.

## Migrating an existing repo

```bash
specguard migrate            # dry-run: shows the plan
specguard migrate --apply    # move .claude IP -> .private, docs/superpowers -> docs/{specs,plans}, sweep refs
```

## Contributing

Issues and PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the dev loop (`npm test` runs
the suite) and [docs/RELEASING.md](docs/RELEASING.md) for the release process (release-please).

## Status

Early (`v0.x`). Built and dogfooded on itself. See [`docs/specs/`](docs/specs/) for the living
spec and [`docs/reference/decisions/`](docs/reference/decisions/) for the ADRs.

## License

[MIT](LICENSE).
