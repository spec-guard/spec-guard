# <Project> — AI Assistant Guidelines

## Source of Truth Hierarchy

1. **`/docs/`** — architectural source of truth (architecture, schemas, contracts, runbooks, ADRs).
2. Module-specific docs are subordinate to `/docs/` for architectural matters.

When implementing any feature: check `/docs/architecture/` first; follow `/docs/standards/`;
update `/docs/` when architectural decisions change.

## Documentation classification (the IP wall)

| Category | Location | Deliverable? |
|----------|----------|--------------|
| Project documentation (architecture, API, ADRs, runbooks) | `docs/` | YES |
| IP knowledge base (troubleshooting, action plans, audits, agent templates, credentials) — harness-agnostic | `${privateDir}/` | NO |
| Per-agent integration (skills, commands, hooks) — generated | `.claude/`, `.codex/`, `.github/`, `.gemini/` | NO |

> Golden rule: internal MAY reference `docs/`; `docs/` MUST NOT reference internal
> (`${privateDir}/` or any agent dir). The IP knowledge base lives in `${privateDir}/`, not in a single
> agent's folder, so multiple agents can be used on this repo at once.

## Specs & decisions

- Specs live in `${specDir}`; plans in `${plansDir}`; formal ADRs in `docs/reference/decisions/`.
- Templates: `docs/templates/{spec,plan,adr}-template.md`.

## Backup monorepo

If this workspace versions multiple deliverable git repos plus intellectual property in a private
root repo, that root is a **backup monorepo**: each module is its own deliverable repo (gitignoring
`.claude/`, `.env*`), and the root captures everything. A change crosses repo boundaries — commit
inside each affected module repo, then let the root capture the state.

<!-- spec-guard manages a governance block below this line -->
