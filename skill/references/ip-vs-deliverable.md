# IP vs Deliverable Documentation

In a project that ships its repos to a client, content splits by **audience**, not by tool.
Putting something in the wrong place either leaks know-how or strands the client without an
answer. Get the classification right *before* writing.

## Three categories (don't conflate them)

| # | Category | Where | Shipped? | Tool-specific? |
|---|----------|-------|----------|----------------|
| 1 | **Deliverable** — product, architecture, API, schemas, ADRs, runbooks | `docs/` (+ the customer docs site) | YES | no |
| 2 | **IP knowledge base** — troubleshooting, action plans, audits, internal rationale, internal standards, agent templates, **credentials** | `${privateDir}/` (default `.private/`) | NO | **no — harness-agnostic** |
| 3 | **Per-agent integration** — skills, commands, hooks, the rules-file block | `.claude/`, `.codex/`/`AGENTS.md`, `.github/`, `.gemini/` | NO | yes, by nature |

The common mistake is collapsing **2 into 3** — dumping the team's IP knowledge base into one
agent's folder (e.g. `.claude/docs/`). That presumes a single agent. The IP knowledge base is
**read by humans and by every AI agent**; it must live in a neutral `${privateDir}/`, so a repo using
Claude Code *and* Copilot *and* Codex at once has one shared home for it. Each agent's own
integration dir (category 3) is generated and gitignored in deliverables, but it is *not* the
IP knowledge base.

## The decision test

> Does this teach **what the system is / how to use it** (→ `docs/`), **how we get the work done**
> (→ `${privateDir}/`), or **how one AI tool plugs in** (→ that agent's dir, usually auto-generated)?

- Architecture, API contract, schema, ADR (the decision), runbook a client could need → `docs/`.
- Troubleshooting playbook, internal audit, agent checklist, credentials, "here's the trick" → `${privateDir}/`.
- A formal *decision* goes in `docs/reference/decisions/` (ADR); the *messy reasoning / rejected
  options* behind it can live in `${privateDir}/docs/` and be linked from the ADR as "internal rationale".

## The golden rule (cross-reference direction)

> **Internal MAY reference `docs/`. `docs/` MUST NOT reference internal.**

"Internal" = the IP knowledge base (`${privateDir}/`) **and** any per-agent dir (`.claude/`, `.codex/`,
`.gemini/`, `.github/`). A client following a `docs/` runbook can never be sent to a path they
don't have. If a deliverable doc needs internal content, inline the needed steps. Internal docs
freely cross-reference deliverable docs (and should, to stay anchored to the source of truth).

> Note for linters: a *hyperlink* whose target points into `${privateDir}/` or an agent dir (at any
> `../` depth) is a violation. A *prose* mention of those paths while explaining this rule is fine.

## Hybrid docs

When a topic has both a public concept and an internal execution recipe, **split it**: the
concept/decision/contract → `docs/`; the execution heuristics / gotchas / checklists → `${privateDir}/`;
link from internal → deliverable (never the reverse).

## Credentials

Secrets live only in `${privateDir}/credentials/` (and per-module env under it). Never in `docs/`,
README, source, or a per-agent integration dir. Modules may symlink to the central files. On
rotation, update the central file.

## How to verify

- [ ] Does any file under `docs/` contain a hyperlink (not just a prose mention) pointing into `${privateDir}/`, `.claude/`, `.codex/`, `.gemini/`, or any agent dir at any `../` depth?
- [ ] Are credentials absent from `docs/`, `README`, and source files? (`grep -r "password\|secret\|api_key\|token" docs/ README`)
- [ ] If a topic was split (concept → `docs/`, recipe → `${privateDir}/`), does the internal doc link forward to the deliverable, and not the reverse?
- [ ] Does no deliverable doc reference an internal path — even in prose that a reader could follow to reach internal content?
