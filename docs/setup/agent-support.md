# Agent support guide

spec-guard gives every supported agent the same governance loop:

`ORIENT -> SPEC -> PLAN -> BUILD -> VERIFY -> SYNC`

The integration is not identical across agents. Some agents support session hooks and slash
commands; others only expose project memory, prompt files, or custom commands. Treat `--agent all`
as "install every supported surface", not as "all agents become equivalent".

## Support matrix

| Agent | Support level | Skill scope | `init` installs | `setup` installs | Activation | Hooks | Commands | Main limitation |
|---|---|---|---|---|---|---|---|---|
| Claude Code | Complete | Repo skill + home fallback | `.claude/skills/spec-guard/`, `.claude/commands/`, `CLAUDE.md` block | `~/.claude/skills/spec-guard/`, `~/.claude/hooks/spec-guard/`, `~/.claude/settings.json`, statusline | `SessionStart` hook | `SessionStart`, `Stop`, statusline | `/spec`, `/spec:orient`, `/spec:write`, `/spec:verify`, `/spec:sync`, `/spec:commit`, `/spec:status` | Machine hooks require `setup` or `init --with-global` |
| Codex | Partial | Home skill | `AGENTS.md` block | `~/.codex/skills/spec-guard/`, `~/.codex/hooks/spec-guard/`, `~/.codex/hooks.json` | `SessionStart` hook | `SessionStart`, `Stop` | Natural language only | No file-backed slash commands or statusline |
| GitHub Copilot | Instructional | Repo skill | `.github/skills/spec-guard/`, `.github/prompts/spec-*.prompt.md`, `.github/copilot-instructions.md` block | Nothing | Project instructions | None wired | Prompt files such as `#spec-orient.prompt.md` | No spec-guard lifecycle hook |
| Gemini CLI | Complete | Repo extension | `.gemini/extensions/spec-guard/` including skill, commands, hooks, `gemini-extension.json`, `GEMINI.md` block | Nothing | Gemini extension hooks | Repo-scoped extension hooks | `/spec`, `/spec:orient`, `/spec:write`, `/spec:verify`, `/spec:sync`, `/spec:commit`, `/spec:status` | Extension is repo-scoped, not workstation-wide |
| opencode / OpenWork | Instructional | Repo skill | `.opencode/skill/spec-guard/`, `.opencode/command/spec-*.md`, `AGENTS.md` block | Nothing | Project memory | None wired | `/spec` (umbrella), `/spec-orient`, `/spec-write`, `/spec-verify`, `/spec-sync`, `/spec-commit`, `/spec-status` | No spec-guard lifecycle hook |

## Choosing agents

Use **Claude Code** when you want the most automated experience: session injection, slash commands,
`Stop` sync reminder, and a statusline badge.

Use **Codex** when you want session injection in Codex and are comfortable invoking phases in
natural language. Codex support is active and useful, but not command-equivalent to Claude Code.

Use **GitHub Copilot** when you want project instructions and prompt files that the user can call
inside Copilot workflows. Do not expect hooks.

Use **Gemini CLI** when you want a repo-local extension with slash commands and hooks.

Use **opencode/OpenWork** when project memory and custom commands are enough. Do not expect hooks.

Use **`--agent all`** only when the repo should carry every integration surface. It is good for
multi-agent teams, but it also writes more generated files.

## `init` vs `setup`

`specguard init` is the repo front door. It writes repo config, manifest-owned generated files,
rules blocks, command files, and optional scaffold docs. On a TTY it can offer to run machine setup.
In non-interactive mode it never silently wires machine hooks unless you pass `--with-global`.

`specguard setup` is the workstation hook operation. It wires Claude Code and Codex home hooks and
installs their home fallback skills. It is safe to rerun; unchanged files report "nothing changed".

Use both when an agent depends on home hooks:

```bash
specguard init . --agent claude-code,codex --with-global
```

or:

```bash
specguard init . --agent claude-code,codex --no-global
specguard setup
```

## Repo-scoped vs home-scoped

Repo-scoped files live under the project and are recorded in `.spec-guard/manifest.json`.
Examples: `.claude/skills/spec-guard/`, `.github/prompts/`, `.gemini/extensions/spec-guard/`,
`.opencode/command/`, and rules blocks in `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, or
`.github/copilot-instructions.md`.

Home-scoped files live under the user's agent directory and are recorded in the global manifest.
Examples: `~/.claude/settings.json`, `~/.codex/hooks.json`, and `~/.codex/skills/spec-guard/`.
Codex repo-specific paths come from the repo's `AGENTS.md` block; `init --agent codex` does not
rewrite the single home-scoped Codex skill.

The practical consequence: a repo can be initialized while the current machine still lacks the
Claude Code or Codex session hooks. Run `specguard doctor` to see that state explicitly.

## What spec-guard installs

| Command | Scope | Writes |
|---|---|---|
| `specguard init . --agent claude-code` | Repo | `.spec-guard/`, `.claude/skills/spec-guard/`, `.claude/commands/`, `CLAUDE.md` block |
| `specguard init . --agent codex` | Repo | `.spec-guard/`, `AGENTS.md` block |
| `specguard init . --agent github-copilot` | Repo | `.github/skills/spec-guard/`, `.github/prompts/`, `.github/copilot-instructions.md` block |
| `specguard init . --agent gemini` | Repo | `.gemini/extensions/spec-guard/`, `GEMINI.md` block |
| `specguard init . --agent opencode` | Repo | `.opencode/skill/spec-guard/`, `.opencode/command/`, `AGENTS.md` block |
| `specguard setup` | Home | Claude Code and Codex home skills, hook bundles, hook config merge, Claude statusline |

Generated whole files are manifest-owned. If an owned file was locally edited, spec-guard writes a
`.spec-guard-update` sidecar instead of clobbering it. Rules files are partial-file owned: only the
managed block between the spec-guard markers is replaced.

## Verify it is working

Run:

```bash
specguard status
specguard doctor .
```

Look for:

- the repo path and recorded agents;
- `global install: present` when Claude Code or Codex hooks should be active;
- `agent health:` lines showing `ok` for expected files and hooks;
- `no lifecycle hook expected` for Copilot and opencode;
- a clean IP wall: `docs/` must not link into the private directory or agent directories.

Then open the agent:

- Claude Code should load spec-guard on session start and show the statusline badge.
- Codex should load spec-guard on session start; invoke phases with natural language.
- Copilot should see project instructions and prompt files.
- Gemini CLI should expose the extension commands.
- opencode/OpenWork should see `AGENTS.md` and custom commands.

## Safe update

Check:

```bash
specguard self check
```

Preview:

```bash
specguard self upgrade --dry-run
```

Apply:

```bash
specguard self upgrade
```

If machine hooks were already wired, a real upgrade refreshes them. Repo-scoped skill files refresh
on the next session start when their manifest entries are still owned. User-edited owned files are
protected and require manual review.

Rollback:

```bash
specguard self rollback --dry-run
specguard self rollback
```

## Migration

`migrate` is for old conventions:

- `docs/superpowers/specs` -> `docs/specs`;
- `docs/superpowers/plans` -> `docs/plans`;
- `.claude/docs` and `.claude/credentials` -> the configured private directory;
- text references are swept;
- deliverable `.gitignore` files that already exclude `.claude/` gain the private directory.

Preview first:

```bash
specguard migrate .
```

Apply only after reviewing the plan:

```bash
specguard migrate . --apply
specguard init .
specguard doctor .
```

## Troubleshooting

### Codex `Stop` hook prints non-JSON text

Codex expects hook stdout to be JSON-safe. Current setup wires the Codex `Stop` hook with:

```bash
SPEC_GUARD_HOOK_FORMAT=codex-silent bash ".../.codex/hooks/spec-guard/sync-check.sh"
```

The script also auto-detects the `.codex/hooks/spec-guard/` install path and emits `{}` on stdout.
If an already-running Codex session still shows old text output, run `specguard setup` and start a
new Codex session so the updated `~/.codex/hooks.json` command is loaded.

### `doctor` says hooks are missing

For Claude Code or Codex, run:

```bash
specguard setup
```

or re-run init with:

```bash
specguard init . --agent claude-code,codex --with-global
```

For Copilot or opencode, missing hooks are not an error because no lifecycle hook is expected.

### `doctor` says a hook bundle is stale

For Claude Code or Codex, a stale bundle means one of the installed runtime scripts differs from
the current Spec Guard bundle. Run:

```bash
specguard setup --force
```

For Gemini, repair the repo-scoped extension instead:

```bash
specguard init . --agent gemini --force
```

Use `--force` only for the managed Spec Guard hook bundle; it does not remove third-party hook
entries, but it does accept the current Spec Guard version over local edits to those managed files.

### `init --agent all` installed files but an agent did not auto-activate

Check the support matrix. Copilot and opencode rely on project memory or prompt/custom command
files. They do not have spec-guard lifecycle hooks. Claude Code and Codex need machine hooks;
Gemini uses repo extension hooks.

## Examples

Only Claude Code:

```bash
specguard init . --agent claude-code --with-global
specguard doctor .
```

Only Codex:

```bash
specguard init . --agent codex --with-global
specguard doctor .
```

Claude Code + Codex:

```bash
specguard init . --agent claude-code,codex --with-global
```

All agents:

```bash
specguard init . --agent all --with-global
```

Existing repo, no scaffold:

```bash
specguard init . --agent claude-code,codex --no-global
specguard setup
specguard doctor .
```

New repo with scaffold:

```bash
specguard init . --agent claude-code --with-global --scaffold
```

Backup monorepo / nested git repos:

```bash
specguard init . --agent claude-code,codex --with-global --scope all
specguard doctor .
```
