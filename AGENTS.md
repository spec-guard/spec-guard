# AGENTS.md — working on spec-guard

This file orients AI agents (and humans) working **on** the spec-guard codebase itself.
It is handcrafted and is the *source* of the agent rules-file convention spec-guard ships;
`spec-guard init` therefore SKIPS injecting a managed block here when it detects this repo
(`package.json.name === "@spec-guard/cli"`).

## What this is

A Node CLI (`@spec-guard/cli`) that installs a spec-driven-development **governance** skill
into AI coding agents (Claude Code, Codex, GitHub Copilot, Gemini CLI), from a single source
rendered per agent.

## Architecture (where things live)

- `bin/spec-guard.js` — thin entrypoint → `src/cli/index.js` dispatcher.
- `src/cli/*` — commands: `init`, `update`, `self`, `status`, `doctor`, `toggle`, `install`.
- `src/core/*` — `config` (XDG + repo-local), `agents` (per-agent path matrix),
  `render` (single-source → per-agent), `topology` (repo-kind detection),
  `lint` (IP/deliverable wall), `manifest` (owned-file guard), `graphify` (optional enhancer).
- `src/hooks/*` — the runtime hooks installed into agents (`activate.js`, `sync-check.sh`,
  `statusline.sh`).
- `skill/` — the single-source skill payload (`SKILL.md` + `references/`), parameterized
  with `${specDir}` / `${plansDir}`.
- `templates/` — per-agent overlays, the format-neutral command set, and project scaffolding.

## Rules

- Spec before code; Conventional Commits; `npm test` green. See [CONTRIBUTING.md](CONTRIBUTING.md).
- Single-source templates, rendered per agent — never hand-maintain per-agent copies.
- Generated/owned files carry a manifest hash; never clobber user-edited files.
