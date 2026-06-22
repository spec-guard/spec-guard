# Optional Graphify Enhancer

Some repos carry a knowledge graph under `graphify-out/` (built by the `graphify` CLI). When
present, it answers "where does X live" and "is this spec connected to that module" far more
cheaply and accurately than a blind grep. spec-guard uses it to sharpen ORIENT and VERIFY, and
keeps it fresh on commit — but it is **strictly optional**: every step has a grep/read fallback,
and nothing requires it.

## Detect before use

Treat graphify as available only when `graphify-out/graph.json` exists at the repo root.
Otherwise fall back to grep/read and proceed normally — never error, never block on it.

## The LLM is your session — no external key

graphify's semantic pass runs in **the host agent session** via subagents; it does **not** read
`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`. If a run prompts you for one, that is a misread — ignore
it. The structural/AST layer is deterministic and free (tree-sitter, no LLM). `GEMINI_API_KEY` is
only an optional headless fast-path. So: the deep/semantic layer is something the **agent** does
for free with the current session; a headless CLI does the structural layer only.

## Where it helps

- **ORIENT** — before reading source, scope the surface:
  - `graphify query "<question>"` → a scoped subgraph (usually far smaller than grep output).
  - `graphify explain "<concept>"` → a focused explanation of one node.
- **VERIFY** — confirm a claimed relationship actually exists in the code:
  - `graphify path "<spec concept>" "<module>"` → the shortest path between two concepts;
    an empty path is a signal the spec and the code aren't actually connected.

These are **read-only** queries. They orient you; they do not replace reading the specific
lines you are about to change. `query`/`path`/`explain` cost nothing beyond local compute, and
the graph reflects the commit it was built from — for load-bearing checks, confirm against the
working tree.

## Topology — one graph per module, merged at the root

- **Build inside each module** (`<module>/graphify-out/graph.json`) — never one whole-tree extract
  at the root. Per-module is incremental (only changed modules re-extract), keeps queries scoped,
  and is the IP firewall (below).
- **The root graph is a merge**, not a build:
  `graphify merge-graphs <m1>/graphify-out/graph.json … --out graphify-out/graph.json`. Node IDs are
  prefixed `repo::` and tagged with their origin module; shared external deps dedupe by label.
  **Never hand-rebuild the root** — re-merge from the updated modules so a curated root survives.
- In a single repo, the module *is* the root, so one in-place update refreshes it directly.

## SYNC — refresh the graph before every commit (when present)

The graph must not drift behind the code. If graphify is available, refresh it **before**
committing so the updated graph lands in the same commit — never after. Two layers, two cadences:

- **Structural — every commit, free.** AST refresh per impacted module + root merge. The
  deterministic path is `specguard commit --graphify`: it runs `graphify update` with each module
  as its working directory, then `merge-graphs` into the root, staged before the commit.
  Fallback-safe (skips when no graph) and CI-safe (no LLM needed).
- **Semantic — only when that module's docs/specs changed.** Run the skill **from inside the
  module**: `cd <module> && /graphify . --update`. The skill runs AST always and dispatches
  semantic subagents **only** when a changed file is a doc/spec/image — code-only changes skip the
  LLM. This uses your session; no key. Then re-merge the root (`specguard commit --graphify` again,
  or `graphify merge-graphs …`).
- **Run the skill from the module dir — not `/graphify <module>` from the root.** The skill writes
  `graphify-out/` to the *current* directory; pointing it at a subfolder from the root clobbers the
  root's graph. `cd` in first.
- **Never `--update` with `--mode deep`** — `graphify update` rejects `--mode`. `--mode deep` is a
  full `extract` (a rare, deliberate per-module enrichment: `cd <module> && /graphify . --mode deep`),
  never part of the commit loop.

Stage the refreshed `graphify-out/` with the code, then commit.

## IP firewall — never index the knowledge base

The graph carries **deliverable content only** — never `${privateDir}/`, per-agent dirs
(`.claude/`, `.codex/`, `.gemini/`, …), `.env*`, or secrets.

- graphify respects `.gitignore` / `.graphifyignore` and auto-skips secrets and `graphify-out/`.
  A **per-module build (cwd = module) inherits the module's `.gitignore`**, which already excludes
  IP — so it stays clean automatically.
- **Never `graphify extract` at the backup-monorepo root.** The root does not gitignore IP, so a
  root extract indexes `${privateDir}/`, agent dirs, and DB backups straight into the graph. The
  root graph must be a `merge-graphs` of the clean per-module graphs — that *is* the firewall.
- **Never roll a custom corpus walker** that bypasses graphify's `detect`; it re-introduces IP and
  drift. Defense-in-depth: a `.graphifyignore` at the backup root listing `${privateDir}/`, agent
  dirs, and `.env*`.

## Fallback (no graphify)

| Want | With graphify | Without |
|------|---------------|---------|
| Locate a surface | `graphify query "…"` | grep the CLAUDE.md index → targeted read |
| Explain a concept | `graphify explain "…"` | read the governing doc/ADR |
| Check spec↔code link | `graphify path "A" "B"` | grep for the symbol across modules |
