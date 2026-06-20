# spec-guard

> Spec-driven development **governance** for AI coding agents.
> **Context before code. Spec before edits. Verify against the spec, not the vibe.**

`spec-guard` is a front-of-pipeline governance layer for professional AI-assisted
engineering in large, multi-module, multi-repo codebases. Where tools like GitHub
Spec Kit and OpenSpec give you the *mechanics* of spec-driven development (scaffolding,
slash commands), spec-guard adds the *governance* they lack:

- **IP-vs-deliverable wall** — a hard rule keeping shippable docs (`docs/`) separate from
  internal intellectual property (`.claude/`), with linting to enforce it.
- **Multi-module / multi-git-repo intelligence** — understands monorepos that are actually
  N deliverable git repos plus a backup monorepo, and reasons about contract ripple across
  repo boundaries.
- **Cross-language anti-regression invariants** — exhaustiveness over silent fallback,
  one-definition-many-imports, documented invariants, "disagreement is a finding".

It installs as an always-on skill + slash commands + lifecycle hooks for **Claude Code,
Codex, GitHub Copilot, and Gemini CLI**, from a single source rendered per agent.

## Status

Early development (pre-`v0.1.0`). Private while the design stabilizes; intended to open
up. See [`docs/specs/`](docs/specs/) for the living spec and
[`docs/reference/decisions/`](docs/reference/decisions/) for the ADRs.

## Install (planned)

```bash
npm install -g @spec-guard/cli
spec-guard install --global          # wire your machine's agents
spec-guard init .                    # install into a project
```

## The loop

```
1. ORIENT  — read the repo's governing docs/ADRs before touching code
2. SPEC    — locate or write the spec (scope, acceptance, traceability)
3. PLAN    — decompose into small verifiable increments
4. BUILD   — implement one increment; match surrounding code
5. VERIFY  — check output against the spec + invariants; run tests
6. SYNC    — update docs/contracts/cross-references
```

## License

Proprietary — see [LICENSE](LICENSE). (Intended to relicense under an OSI-approved
license on public release.)
