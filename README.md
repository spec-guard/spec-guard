<p align="center">
  <img src="https://raw.githubusercontent.com/spec-guard/spec-guard/main/docs/assets/logo.svg" alt="spec-guard" width="420">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@spec-guard/cli"><img src="https://img.shields.io/npm/v/@spec-guard/cli.svg" alt="npm"></a>
  <a href="https://github.com/spec-guard/spec-guard/actions/workflows/ci.yml"><img src="https://github.com/spec-guard/spec-guard/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg" alt="node"></a>
</p>

<p align="center"><strong>Context before code. Spec before edits. Verify against the spec, not the vibe.</strong></p>

Ever watched a coding agent "fix" one endpoint and quietly break three things it didn't know
existed? That's the moment spec-guard exists to prevent. It's a **governance layer** that sits in
front of your AI coding agent — Claude Code, Codex, GitHub Copilot, Gemini CLI, or opencode — and
makes it read the docs and write a spec *before* touching code, then check its own work against
that spec instead of vibes. Install it once and it's just... always on, every session, no command
to remember.

> **Naming, so it's not confusing:** the npm package is **`@spec-guard/cli`**, the command you type
> is **`specguard`** (one word, no hyphen), and the project/brand is **spec-guard**.

## spec-guard vs. Spec Kit / OpenSpec — what's actually different?

Short version: **Spec Kit and OpenSpec give you the paperwork. spec-guard makes sure it gets read.**

Both are good tools and worth knowing about — GitHub **Spec Kit** (`specify`) scaffolds a
Spec → Plan → Tasks → Implement chain of markdown artifacts across a long list of editors/agents;
**OpenSpec** (`openspec`) does a similar job with a lighter Proposals → Specs → Tasks → Archive
flow. Both are things *you run*, and both assume "many agents" means "roughly the same experience
everywhere."

spec-guard makes different bets:

| | Spec Kit / OpenSpec | spec-guard |
|---|---|---|
| **What you get** | Scaffolding: spec/plan/task files you and the agent fill in | The same discipline, but *enforced* — the agent is made to read the governing docs before it edits, every time |
| **How it activates** | You run it — easy to skip under a deadline | Session lifecycle hooks (where the agent supports them) inject the loop automatically; no command to remember |
| **Agent coverage** | Broad — templates for a long list of editors/agents | Deep on 5: Claude Code, Codex, GitHub Copilot, Gemini CLI, opencode (+ OpenWork) — each wired to its *real* integration surface (hooks, statusline, project memory), not a one-size template. A [capability matrix](docs/reference/decisions/0010-agent-capability-matrix.md) tells you honestly what each agent can and can't do, instead of pretending they're equivalent |
| **Multi-repo awareness** | Single repo | Understands a workspace that's actually N delivered repos plus a private backup monorepo, and reasons about contract ripple + commit order across repo boundaries |
| **Intellectual property (IP) vs. deliverable** | Not addressed | A real wall between what ships to the client (`docs/`) and your internal know-how (`.private/`) — agnostic to whichever agent wrote it, linted by `doctor` |
| **Re-running / updating** | — | Manifest-guarded: hand-edits to owned files are never clobbered — a `.spec-guard-update` sidecar is written instead. (Edits *inside* the managed block are the one exception: that region always re-syncs to the template, by design) |

So yes — **multi-module/multi-repo awareness is one real differentiator** (confirmed: see
[ADR 0009](docs/reference/decisions/0009-graph-topology-and-ip-firewall.md)), but it's not the only
one. The bigger one is that spec-guard doesn't wait for you to remember to run it — see
[ADR 0007](docs/reference/decisions/0007-binary-name-and-single-front-door.md) for the reasoning
against Spec Kit and OpenSpec specifically. It also comes with an opinion about keeping your
internal notes out of what you ship, which the scaffolding tools don't touch at all — see
[ADR 0006](docs/reference/decisions/0006-harness-agnostic-ip.md) for that one.

## What it gives you

- **The loop, enforced.** `ORIENT → SPEC → PLAN → BUILD → VERIFY → SYNC`, injected into every
  session so non-trivial work starts from the governing docs, not from memory.
- **The IP/deliverable wall.** Three categories, not two: deliverable docs (`docs/`), a
  **harness-agnostic** IP knowledge base (`.private/`, configurable), and per-agent integration
  (`.claude/`, `.codex/`, `.github/`, `.gemini/`, `.opencode/`). `doctor` lints it; `docs/` may
  never link into internal content.
- **Conventions, encoded.** On-demand reference docs the agent loads at BUILD/VERIFY — code
  organization (layering, feature slices, barrels, imports), error model, DB schema & data, coding
  conventions (naming, typing, DI, SOLID/DRY/KISS/YAGNI), and observability (structured logging,
  metrics, tracing, mandatory instrumentation) — so "match the surrounding code" has a concrete,
  source-proven standard behind it, not guesswork. `--scaffold` seeds matching fill-in starter docs.
- **Multi-git topology intelligence.** Understands a "monorepo" that is actually N deliverable git
  repos plus a private backup monorepo, and reasons about contract ripple and commit order across
  repo boundaries — something single-repo tools can't.
- **One source, every agent.** A single skill + command set rendered per agent via a path matrix.
  Adding an agent is a row, not a fork.
- **Commit, governed.** `specguard commit` produces a Conventional Commit (no AI attribution),
  single repo or `--all` across the backup monorepo in configured module order.
- **Reversible by design.** Repo-owned and machine-owned files are tracked in their respective
  manifests; auto-updates never clobber your edits outside the managed block, and
  `uninstall`/`uninstall --global` remove the matching scope without touching your content.
- **Optional graphify enhancer.** When a `graphify-out/` knowledge graph exists, ORIENT/VERIFY use
  it; otherwise it falls back to grep/read. Never required.

## Do I need the advanced parts?

**Probably not, and that's fine.** Most users have one repo: run `specguard init .`, let the loop
do its thing, and you're done. The core governance (read-docs-first, spec-before-edits,
verify-against-spec) works out of the box, no configuration required.

The heavier features are **opt-in**, aimed at teams shipping deliverable repos to a client:

- the **IP/deliverable wall** (`.private/`) matters when you keep internal notes you must *not* ship;
- the **backup-monorepo / multi-git** intelligence (`--scope all`, `commit --all`) matters when one
  workspace holds N separate git repos delivered separately.

If neither applies to you, ignore `.private/`, `--scope`, and `--all` entirely — they won't get in
your way.

## Requirements

- **Node.js ≥ 20**
- One or more supported agents (Claude Code, Codex, GitHub Copilot, Gemini CLI, opencode)

## Install

```bash
npm install -g @spec-guard/cli      # or skip the global install entirely (next line)
npx @spec-guard/cli init .          # always works immediately — no PATH/shell refresh needed
```

> **`specguard: command not found` right after the global install?** That's your shell's command
> cache, not a spec-guard problem — a new global binary isn't visible to the *running* shell until
> it rehashes. Fix it without reopening the terminal: run **`hash -r`** (bash) or **`rehash`** (zsh).
> Or just use `npx @spec-guard/cli …` for the first run, which never depends on `PATH`.

`init` is the single front door — on a TTY it prompts for which agents to set up and offers to wire
this machine's session hooks; pass flags to skip the prompts in CI:

```bash
specguard init . --agent claude-code,codex --with-global --scaffold   # non-interactive, also wire the machine
specguard init . --agent all --no-global                              # every agent, don't touch machine config
specguard setup                                                       # (re)wire machine hooks + Claude statusline
```

## Quickstart

1. **Install + initialize** (above): `specguard init .`. On a TTY it asks which agents to set up and
   offers to wire this machine's hooks right there — so that's usually all you run. (In CI, add
   `--with-global`, or run `specguard setup` separately.)
2. **Open your agent and just work.** spec-guard is active every session — no command needed:
   - **Claude Code**: SessionStart hook activates the skill; `[SPEC-GUARD]` badge in the statusline; `specguard off` to pause.
   - **Codex**: SessionStart hook activates the skill; no badge; same governance applies.
   - **GitHub Copilot**: No lifecycle hook — governance rides `.github/copilot-instructions.md` (always-on project memory).
   - **Gemini CLI**: The `spec-guard` extension activates automatically via its session hooks.
   - **opencode (+ OpenWork)**: No lifecycle hook — governance rides `AGENTS.md` (always-on project memory).

   In all cases the loop is injected automatically, so the agent reads your governing docs/ADRs *before* writing code and verifies against the spec after.
3. **Drive the phases explicitly when you want.** Commands vary by agent:

   | Command (Claude Code / Gemini CLI) | When |
   |------------------------------------|------|
   | `/spec` | Show the loop, the phase commands, and where the current task stands |
   | `/spec:orient` | Load the docs/ADRs governing the surface you're about to touch |
   | `/spec:write` | Locate or write the spec (scope, acceptance, traceability) |
   | `/spec:verify` | Check the result against the spec + run the test/lint gate |
   | `/spec:sync` | Update the docs/contracts the change affects |
   | `/spec:commit` | Refresh the knowledge graph (if present), then commit (Conventional, no AI attribution) |
   | `/spec:status` | Print the loop checklist and mark the current step (anytime) |
   | `/spec:coordinate` | Run several specs/ad-hoc requests as independent, parallel fronts — isolated worktree per front, async human-in-the-loop, sequential merge, one final reconciliation |

   **By agent:**

   | Agent | How to invoke |
   |-------|--------------|
   | Claude Code | `/spec`, `/spec:orient`, `/spec:write`, `/spec:verify`, `/spec:sync`, `/spec:commit`, `/spec:status`, `/spec:coordinate` |
   | Codex | Natural language: "orient on this surface", "write the spec", "verify against the spec", "sync the docs", "coordinate these as parallel fronts" |
   | GitHub Copilot | `#spec.prompt.md` (umbrella) + prompt files: `#spec-orient.prompt.md`, `#spec-write.prompt.md`, `#spec-verify.prompt.md`, `#spec-sync.prompt.md`, `#spec-commit.prompt.md`, `#spec-status.prompt.md`, `#spec-coordinate.prompt.md` |
   | Gemini CLI | Same slash commands as Claude Code |
   | opencode (+ OpenWork) | `/spec` (umbrella) + `/spec-orient`, `/spec-write`, `/spec-verify`, `/spec-sync`, `/spec-commit`, `/spec-status`, `/spec-coordinate` custom commands |

4. **Turn it off / on** anytime: `specguard off` / `specguard on` (persists across sessions).
5. **Something not working?** `specguard doctor` checks install health, repo topology, and the
   IP/deliverable wall, and tells you what to fix.

## Shell completion

Tab-completion for commands, flags, agents, and sub-commands — works on macOS, Linux and Windows:

```bash
# bash  (macOS/Linux) — add to ~/.bashrc
eval "$(specguard completion bash)"

# zsh   (macOS default shell — this is what iTerm2 runs too) — add to ~/.zshrc
eval "$(specguard completion zsh)"

# fish  — write once
specguard completion fish > ~/.config/fish/completions/specguard.fish
```

```powershell
# PowerShell (Windows) — add to $PROFILE
specguard completion powershell | Out-String | Invoke-Expression
```

With no argument, `specguard completion` auto-detects your shell from `$SHELL` (PowerShell on
Windows). The script is generated from the live command surface, so it never goes stale — re-run it
after an upgrade.

## The loop

Each phase has a governance command — **except PLAN and BUILD, which have none: those are where you
do the actual work** (compose with your planning and TDD tools). Note SPEC's command is `/spec:write`
(you *write* the spec):

```
   Phase     Command        What you do
1. ORIENT    /spec:orient   read the repo's governing docs/ADRs before touching code
2. SPEC      /spec:write    locate or write the spec (scope, acceptance, traceability)
3. PLAN      —              decompose into small verifiable increments
4. BUILD     —              implement one increment; match the surrounding code
5. VERIFY    /spec:verify   check output against the spec + anti-regression invariants; run tests
6. SYNC      /spec:sync     update docs/contracts/cross-references
       then  /spec:commit   refresh the knowledge graph (if present), then commit
```

`/spec` prints this map and marks where you stand; `/spec:commit` then refreshes the knowledge graph
(if present) and commits (Conventional, no AI attribution); `/spec:status` marks the current step
anytime.

### The loop in practice

A real task: **add a `currency` field to `POST /orders`.** It looks like one endpoint, but it's a
contract change that ripples through the DB schema, the shared DTO, the `OrderCreated` event, and
the docs — exactly the kind of work where a coding agent, left alone, edits the handler and calls it
done. Here's the same change run through the loop:

| Phase | Command | What spec-guard makes you do |
|-------|---------|------------------------------|
| **ORIENT** | `/spec:orient` | Read the repo + module `CLAUDE.md` and the ADR that governs the orders API **before** touching code. If the doc and the code disagree, that's a finding to surface — not a coin-flip to silently resolve. |
| **SPEC** | `/spec:write` | Write the contract down: **In-Scope** (`currency` on the request + the event), **Out-of-Scope** (no FX conversion, no backfill), **Acceptance Criteria** (`an unknown currency code is rejected 422`; `OrderCreated carries currency`), **Traceability** (which ADR it implements). Architectural or irreversible? Get sign-off before coding. |
| **PLAN** | — | Map the ripple and decompose: migration → the **shared** `Currency` enum (reuse it, never fork a local copy) → request DTO → endpoint validation → `OrderCreated` payload (version-bumped) → consumers. Each increment compiles and is reviewable on its own. |
| **BUILD** | — | Implement one increment, matching the surrounding code's error model, DI, and logging — house style over personal style. Stay in scope: no drive-by refactors. |
| **VERIFY** | `/spec:verify` | Walk each acceptance criterion **with evidence**, run the test/lint/type gate (paste the real output — never "tests probably pass"), then take a verifier stance and try to prove it wrong. Re-check the invariants: the `Currency` switch is exhaustive, every `*_id` has an FK, the event version is bumped. |
| **SYNC** | `/spec:sync` | Update the API contract doc, the event catalog, and the ADR status — a schema change is *migration + docs + version bump, all three or none*. Keep `docs/` free of any link into `.private/`. Then run `/spec:commit` to refresh the graph and commit as a Conventional Commit, no AI attribution. |

A change that ships the code but not the docs is **incomplete** — SYNC is part of "done", and
skipping it silently rots the next agent's context.

## Supported agents

For the full support matrix, install paths, verification steps, and troubleshooting, see
[`docs/setup/agent-support.md`](docs/setup/agent-support.md).

| Agent | Skill | Commands | Rules file |
|-------|-------|----------|------------|
| Claude Code | `.claude/skills/` | `.claude/commands/spec/` + `spec.md` (umbrella) | `CLAUDE.md` |
| Codex | `~/.codex/skills/` | — (natural language) | `AGENTS.md` |
| GitHub Copilot | `.github/skills/` | `.github/prompts/spec-*.prompt.md` | `.github/copilot-instructions.md` |
| Gemini CLI | `.gemini/extensions/` | `…/commands/spec/*.toml` + `spec.toml` | `GEMINI.md` |
| opencode (+ OpenWork) | `.opencode/skills/` | `.opencode/commands/spec-*.md` + `spec.md` (umbrella) | `AGENTS.md` |

**Activation and invocation:**

| Agent | Activates via | Invoke phases |
|-------|--------------|--------------|
| Claude Code | SessionStart hook → `~/.claude/settings.json` | `/spec`, `/spec:orient`, `/spec:write`, `/spec:verify`, `/spec:sync`, `/spec:commit`, `/spec:status`, `/spec:coordinate` |
| Codex | SessionStart hook → `~/.codex/hooks.json` | Natural language: "orient on this surface", "write the spec", "verify against the spec", "sync the docs", "coordinate these as parallel fronts" |
| GitHub Copilot | Always-on via `.github/copilot-instructions.md` (no hook) | `#spec.prompt.md` (umbrella) + prompt files: `#spec-orient.prompt.md`, `#spec-write.prompt.md`, `#spec-verify.prompt.md`, `#spec-sync.prompt.md`, `#spec-commit.prompt.md`, `#spec-status.prompt.md`, `#spec-coordinate.prompt.md` |
| Gemini CLI | Extension hooks → `.gemini/extensions/spec-guard/hooks/hooks.json` | Same slash commands as Claude Code |
| opencode (+ OpenWork) | Always-on via `AGENTS.md`; OpenWork shares the same config automatically | `/spec` (umbrella) + `/spec-orient`, `/spec-write`, `/spec-verify`, `/spec-sync`, `/spec-commit`, `/spec-status`, `/spec-coordinate` custom commands |

## Commands

| Command | Purpose |
|---------|---------|
| `init [path] [--agent all\|none\|…] [--with-global\|--no-global] [--scaffold] [--spec-dir …] [--plans-dir …] [--private-dir …] [--scope all]` | Install into a repo (per-agent skill, commands, hooks, managed block); prompts on a TTY |
| `setup` | Wire this machine's Claude Code / Codex session hooks + Claude statusline |
| `uninstall [path] [--global] [--purge] [--dry-run]` | Remove spec-guard from a repo, or from this machine |
| `doctor [path]` | Diagnose install health, repo topology, the IP/deliverable wall, and unfilled convention-doc placeholders |
| `commit [--all] [--scope …] [--graphify] -m …` | Commit a message **you** author (validated as Conventional, AI attribution stripped), single repo or across the backup monorepo; `--graphify` refreshes the knowledge graph first |
| `migrate [--apply]` | Transitional: upgrade an old-model repo to the current layout |
| `self check\|upgrade\|rollback [--dry-run] [--tag …] [--force]` | Update the CLI itself. `upgrade` is idempotent (skips when already on the latest; `--force` reinstalls); a real upgrade also refreshes this machine's hooks (only if already wired); per-repo skill files auto-update on the next session start |
| `completion <bash\|zsh\|fish\|powershell>` | Print a shell-completion script (auto-detects the shell if omitted) |
| `status` · `toggle on\|off` (aliases `on`/`off`) | Show state · governance switch |

Run `specguard <command> --help` for per-command usage, subcommands, and flags.

### Common flags

| Flag | Applies to | Meaning |
|------|------------|---------|
| `--agent <list>` | `init`, `uninstall` | Comma-separated agents, or `all` / `none` (default on a TTY: prompt; else `claude-code`). On an already-initialized repo, `init --agent` **adds/refreshes** the named agent(s) — it never drops one you didn't name. To remove an agent, use `uninstall --agent <x>` instead (see [Uninstall](#uninstall)) |
| `--with-global` / `--no-global` | `init` | Wire (or skip) this machine's hooks without prompting |
| `--scaffold` | `init` | Also create the `docs/` + `.private/` doc tree **and seed fill-in starter docs** (architecture, error-handling, schema, observability, coding-guidelines) — all write-if-absent. Each convention doc is single-source: on a brownfield repo, replace any that duplicates an existing doc with a one-line pointer (`doctor` flags unfilled ones) |
| `--spec-dir` / `--plans-dir` | `init` | Override repo rules and repo-scoped generated files (default `docs/specs`, `docs/plans`); Codex's home skill remains global and should defer to `AGENTS.md` for repo-specific paths |
| `--private-dir` | `init`, `migrate` | Override the IP knowledge-base location (default `.private`) |
| `--scope all` | `init` | Treat the tree as a backup monorepo (record module list for ripple/commit order) |
| `--scope <a,b>` | `commit` | Commit only the named modules (otherwise `--all` = every impacted one) |
| `--graphify` | `commit` | Refresh the `graphify-out/` knowledge graph (structural) **before** committing |
| `--add` | `commit` | Stage all changes first (`git add -A`), then commit. Only meaningful for a single repo — `--all`/`--scope` always stage every impacted repo regardless of this flag |
| `--global` | `uninstall` | Operate on the machine, not a repo |
| `--purge` | `uninstall --global` | Also forget preferences (XDG config + the on/off flag) |
| `--dry-run` | `uninstall` | Print the plan and change nothing |
| `--force` | `init`, `setup` | Overwrite even user-edited owned files (skips the sidecar guard) |
| `--apply` | `migrate` | Apply the migration (otherwise dry-run) |

## Uninstall

spec-guard tracks every repo-scoped file it writes, so removal is exact — it deletes only what it added and
leaves your `docs/`, specs, plans, and `.private/` untouched. Rules files (`CLAUDE.md`,
`AGENTS.md`, …) are stripped, not deleted, when they hold content beyond the managed block — only
the region between the `<!-- spec-guard:start -->` / `<!-- spec-guard:end -->` markers is removed,
preserving your surrounding content. If spec-guard's block was the file's *only* content (e.g. a
plain `init .` with no pre-existing rules file), the now-empty file is removed too.

**This is also how you shrink the agent list.** `init` only ever adds or refreshes agents (see the
`--agent` row above) — the one command that removes an agent, both its files *and* its entry in
`.spec-guard/config.json`, is a scoped `uninstall --agent <x>`:

**From a project:**

```bash
specguard uninstall .              # remove skill, commands, managed block, .spec-guard/
specguard uninstall . --dry-run    # preview exactly what would be removed
specguard uninstall . --agent gemini   # remove one agent's files AND drop it from config.json
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

Nothing here should ever eat your edits. That's not a promise, it's how it's built:

- **Manifest-guarded writes.** Each installed file is recorded with a content hash in
  `.spec-guard/manifest.json` (per repo) or `~/.config/spec-guard/manifest.json` (global). On
  `init` (without `--force`), an unchanged file is left as-is; a file you edited is left in place
  and the new version is written next to it as `<file>.spec-guard-update`. On `init --force`,
  edited files are overwritten directly (no sidecar). `self upgrade` refreshes only machine-level
  hooks; per-repo skill files are updated by session-start auto-update, which skips user-edited
  files silently with a count in the session note but does not write a sidecar.
- **Block-scoped rules.** In rules files spec-guard owns only the managed block; your prose is
  never read into the hash or overwritten.
- **Reversible.** `uninstall` mirrors repo init through the same path matrix, while
  `uninstall --global` removes machine-owned Claude Code/Codex hooks and home skills.

## Configuration

`.spec-guard/config.json` (written by `init`):

```json
{
  "specDir": "docs/specs",
  "plansDir": "docs/plans",
  "privateDir": ".private",
  "agents": ["claude-code", "codex"]
}
```

You normally don't edit this by hand — `init` writes it from your flags. A few settings (like
`commitLanguage`, default `"en"`, used by `specguard commit`) aren't written by `init` and only take
effect if you add them yourself. If you do change a value, re-run `specguard init` to re-render the
owned files against it.

## Migrating an existing repo

```bash
specguard migrate            # dry-run: shows the plan
specguard migrate --apply    # move .claude IP -> .private, docs/superpowers -> docs/{specs,plans}, sweep refs
```

## Contributing

Issues and PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for the dev loop (`npm test` runs
the suite) and [docs/RELEASING.md](docs/RELEASING.md) for the release process (release-please).

## Status

Early (`v0.x`), and yes, we eat our own dog food: this repo runs its own governance loop, and this
README was written under it (see [`docs/specs/0003`](docs/specs/0003-readme-refresh-and-branding.md)).
Browse [`docs/specs/`](docs/specs/) for the living spec and
[`docs/reference/decisions/`](docs/reference/decisions/) for the full ADR trail.

## License

[MIT](LICENSE).
