# Optional Graphify Enhancer

Some repos carry a knowledge graph under `graphify-out/` (built by the `graphify` CLI). When
present, it answers "where does X live" and "is this spec connected to that module" far more
cheaply and accurately than a blind grep. spec-guard uses it to sharpen ORIENT and VERIFY —
but it is **strictly optional**: every step has a grep/read fallback, and nothing requires it.

## Detect before use

Treat graphify as available only when `graphify-out/graph.json` exists at the repo root.
Otherwise fall back to grep/read and proceed normally — never error, never block on it.

## Where it helps

- **ORIENT** — before reading source, scope the surface:
  - `graphify query "<question>"` → a scoped subgraph (usually far smaller than grep output).
  - `graphify explain "<concept>"` → a focused explanation of one node.
- **VERIFY** — confirm a claimed relationship actually exists in the code:
  - `graphify path "<spec concept>" "<module>"` → the shortest path between two concepts;
    an empty path is a signal the spec and the code aren't actually connected.

These are **read-only** queries. They orient you; they do not replace reading the specific
lines you are about to change.

## Freshness & cost

- `graphify query`/`path`/`explain` cost nothing beyond local compute. Prefer them over a broad
  inline grep when the graph is present.
- The graph reflects the commit it was built from; for load-bearing checks, confirm against the
  working tree.

## SYNC — refresh the graph before every commit (when present)

The graph is part of the repo's truth, so it must not drift behind the code. In the SYNC/commit
step, **if graphify is available (`graphify-out/graph.json` exists), refresh it BEFORE committing**
so the updated graph lands in the same commit — never after:

- **Each impacted module:** `/graphify <module> --update --mode deep`. `--update` is incremental
  (re-extracts only what changed), so this is *not* a naive full rebuild. AST/structural runs
  always (syntactic); the LLM semantic pass runs for changed docs/specs; `--mode deep` enriches
  INFERRED (semantic) edges. The deep semantic pass needs the agent (the `/graphify` skill) or
  `GEMINI_API_KEY` — a headless CLI does the structural layer only.
- **Root graph:** in a backup monorepo, re-merge the *freshly updated* module graphs into the root
  (`graphify merge-graphs … --out graphify-out/graph.json`) — re-merging from updated modules
  preserves a curated root; do **not** hand-rebuild it. In a single repo, the module update above
  already refreshed the root graph.
- **Fallback / CI:** `specguard commit --graphify` performs the structural refresh + root merge
  before committing for you. It is curated-safe and fallback-safe (skips silently when no graph is
  present). The deep semantic pass still belongs to the in-agent `/spec:commit` workflow.

## Fallback (no graphify)

| Want | With graphify | Without |
|------|---------------|---------|
| Locate a surface | `graphify query "…"` | grep the CLAUDE.md index → targeted read |
| Explain a concept | `graphify explain "…"` | read the governing doc/ADR |
| Check spec↔code link | `graphify path "A" "B"` | grep for the symbol across modules |
