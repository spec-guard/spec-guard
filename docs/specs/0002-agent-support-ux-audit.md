# Spec 0002 - Agent support UX audit

**Status:** IMPLEMENTED

## Context / Problem

spec-guard supports agents with different integration surfaces: some have lifecycle hooks and
slash commands, some only have project memory or prompt files, and Codex has a home-scoped skill
with natural-language invocation. The product risk is that users read "all agents" as "all agents
have equivalent behavior" and then expect hooks, status lines, or slash commands where the agent
does not provide them.

## In-Scope

- Make each supported agent's scope, activation, hooks, commands, and limits explicit.
- Add a formal capability matrix in code so docs and diagnostics can align to one source.
- Improve `doctor` so it reports incomplete per-agent installs, especially missing machine hooks
  for Claude Code and Codex.
- Add public documentation for choosing agents, `init` vs `setup`, verification, updates,
  migration, uninstall, and multi-repo cases.

## Out-of-Scope

- Changing the on-disk path matrix.
- Adding Codex slash commands.
- Adding lifecycle hooks to GitHub Copilot or opencode where spec-guard does not have a stable
  agent hook API.
- Changing existing manifest ownership semantics or clobber policy.

## Acceptance Criteria

1. The code has a formal capability row for Claude Code, Codex, GitHub Copilot, Gemini CLI, and
   opencode.
2. Tests assert the necessary differences: Codex is home-scoped/no slash commands, Copilot and
   opencode have no lifecycle hooks, and Gemini hooks are repo-scoped.
3. `specguard doctor` prints per-agent health for configured agents and distinguishes "hooks
   missing" from "no lifecycle hook expected".
4. Public docs include a support matrix, `init` vs `setup`, repo-scoped vs home-scoped, how to
   choose agents, what is installed, verification, safe upgrade, migration, troubleshooting for
   Codex `Stop`, and concrete install examples.
5. Public docs do not reference internal-only documentation directories.

## Traceability

Implements product decision [ADR 0010](../reference/decisions/0010-agent-capability-matrix.md)
and extends the v1 contract from [Spec 0001](0001-spec-guard-v1.md).
