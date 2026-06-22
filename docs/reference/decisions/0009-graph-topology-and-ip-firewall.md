# ADR 0009 — Graph topology: per-module graphs merged at the root, with an IP firewall

**Status:** Accepted

## Context

ADR 0004 made graphify an optional enhancer; ADR 0008 set when the graph refreshes (before the
commit). Neither pinned down *how* the graph is shaped in a backup monorepo, and a brownfield pilot
filled the gap with a non-standard pipeline that proved unviable: a single hand-assembled
whole-repo graph (tens of MB, ~7M LLM tokens per build), rebuilt from scratch rather than merged,
that walked its own corpus and **indexed the IP knowledge base** (`${privateDir}/`, agent dirs, DB
backups) straight into a graph that could then never ship. It also fought the standard tooling
(one stock command clobbered the curated graph).

graphify's own model is the opposite, and is what spec-guard already implements in
`src/cli/commit.js`: a graph **per module**, federated at the root by `merge-graphs`.

## Decision

The canonical topology is **one graph per module, merged at the root** — never a single extract at
the backup-monorepo root.

- **Per module:** build `<module>/graphify-out/graph.json` with the module as the working directory.
- **Root:** `graphify merge-graphs <m1>/graphify-out/graph.json … --out graphify-out/graph.json`
  (node IDs prefixed `repo::`, external deps deduped by label). **Re-merge from updated modules;
  never hand-rebuild the root.**
- **Semantic extraction uses the host agent session** (subagents) — no external API key
  (`GEMINI_API_KEY` is an optional headless fast-path only).
- **IP firewall.** The graph carries deliverable content only. A per-module build (cwd = module)
  inherits the module's IP-excluding `.gitignore`, so it stays clean automatically; the root, whose
  `.gitignore` does **not** exclude IP, is built **only** by merging clean module graphs — the merge
  *is* the firewall. Never `graphify extract` at the backup root; never roll a custom corpus walker
  that bypasses graphify's `detect`. A root `.graphifyignore` (`${privateDir}/`, agent dirs, `.env*`)
  is scaffolded as defense-in-depth.

Rejected: a single whole-repo graph, hand-rebuilt root graphs, and any deep semantic re-extraction
inside the commit loop (structural is the per-commit cadence; semantic runs only when a module's
docs/specs changed — see ADR 0008).

## Consequences

- Refreshes stay incremental and cheap: only changed modules re-extract; the root is a fast merge.
- The shipped/queried graph never leaks IP, and queries stay scoped per module.
- Pilots that drifted to a custom pipeline migrate by deleting it and restoring `merge-graphs` over
  the per-module graphs they already have.
