# ADR 0006 — Harness-agnostic IP knowledge base

**Status:** Accepted

## Context

The original IP/deliverable wall equated "intellectual property" with the `.claude/` folder.
But `.claude/` is **Claude Code's integration directory**, not a concept of ownership. A repo can
use Claude Code, Codex, GitHub Copilot, and Gemini at once — each with its own dir (`.claude/`,
`.codex/`/`AGENTS.md`, `.github/`, `.gemini/`). Putting the team's IP knowledge base (troubleshooting,
action plans, audits, internal rationale, credentials) inside one agent's folder presumes a single
agent and is invisible to the others' mental model.

## Decision

Recognize **three** categories, not two:

1. **Deliverable** → `docs/` (shipped, harness-agnostic).
2. **IP knowledge base** → a **configurable, harness-agnostic** `privateDir` (default **`.private/`**),
   not shipped. Holds troubleshooting, action plans, audits, internal rationale, internal
   standards, agent templates, and credentials.
3. **Per-agent integration** → each agent's own dir (`.claude/`, `.codex/`, `.github/`, `.gemini/`),
   generated and gitignored in deliverables.

The golden rule generalizes: **internal MAY reference `docs/`; `docs/` MUST NOT reference internal**,
where "internal" = `privateDir` **and** any agent dir. The wall lint forbids `docs/` hyperlinks into
`privateDir` or an agent dir (at any `../` depth); prose mentions are not violations.

## Consequences

- `privateDir` is a config key (default `.private`), resolved alongside `specDir`/`plansDir` and
  substituted into templates (`${privateDir}`).
- `init --scaffold` creates `${privateDir}/` (docs buckets + credentials), not `.claude/docs/`.
- `doctor`'s wall lint and the `sync-check` hook are agnostic to the agent in use.
- Migrating an existing repo means moving its IP knowledge base out of `.claude/docs` +
  `.claude/credentials` into `${privateDir}/`, while keeping `.claude/` for Claude Code integration only.
