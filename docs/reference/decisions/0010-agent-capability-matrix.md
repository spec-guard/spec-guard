# ADR 0010 - Agent capability matrix

**Status:** Accepted

## Context

ADR 0003 established single-source rendering, but the wording was easy to read as functional
equivalence across agents. That is not true. The governance loop is shared, but each agent exposes
different integration primitives: lifecycle hooks, slash commands, prompt files, project memory,
extensions, status lines, and home-scoped versus repo-scoped skill locations.

The product goal is to make the user's mental model simple without hiding real constraints.

## Decision

Maintain a formal capability matrix in `src/core/agents.js` alongside the path matrix. Every agent
row states:

- support level: `complete`, `partial`, or `instructional`;
- skill scope: `repo` or `home`;
- activation model;
- invocation model;
- lifecycle hook availability;
- statusline availability;
- the user-facing limitation that explains why it differs.

Standardize the concepts across every agent:

- the governance loop: ORIENT -> SPEC -> PLAN -> BUILD -> VERIFY -> SYNC;
- the managed rules block in the agent's project-memory file;
- generated skill/reference content where the agent has a skill surface;
- command semantics where the agent has commands or prompt files;
- manifest-owned writes and non-clobber behavior;
- `doctor` as the canonical verification command.

Keep these differences by technical necessity:

- **Claude Code:** complete support: repo skill, slash commands, home session hooks, and statusline.
- **Codex:** partial support: home-scoped skill and home hooks, natural-language invocation, no
  file-backed slash commands or statusline.
- **GitHub Copilot:** instructional support: repo instructions, repo skill files, and prompt files;
  no lifecycle hook is wired by spec-guard.
- **Gemini CLI:** complete support through a repo extension with commands and extension hooks.
- **opencode/OpenWork:** instructional support through `AGENTS.md` and repo custom commands; no
  lifecycle hook is wired by spec-guard.

## Consequences

- `init --agent all` means "install every supported integration surface", not "make every agent
  behavior equivalent".
- `setup` remains the explicit machine hook operation for Claude Code and Codex.
- `doctor` should report per-agent health using capability-aware wording.
- User docs should explain capabilities before listing paths so users think in supported behavior,
  not in internal agent directories.
