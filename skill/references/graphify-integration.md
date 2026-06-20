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
  working tree. In curated multi-repo graphs, do **not** trigger a naive rebuild that could
  clobber the curated merge — leave rebuilds to the repo's own maintenance flow.

## Fallback (no graphify)

| Want | With graphify | Without |
|------|---------------|---------|
| Locate a surface | `graphify query "…"` | grep the CLAUDE.md index → targeted read |
| Explain a concept | `graphify explain "…"` | read the governing doc/ADR |
| Check spec↔code link | `graphify path "A" "B"` | grep for the symbol across modules |
