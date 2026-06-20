# ADR 0008 — Knowledge-graph sync runs before the commit

**Status:** Accepted

## Context

ADR 0004 made graphify an optional, fallback-safe enhancer for ORIENT/VERIFY. The commit path also
had a `--graphify` flag, but it ran the graph refresh **after** the commit and only in `--all`
(multi-repo) mode, using a structural `extract` + `merge-graphs`. Two problems:

1. **Ordering.** A graph refreshed *after* the commit is not in that commit — it dangles as an
   uncommitted change, so the committed tree never carries the matching graph. The graph drifts
   behind the code it describes.
2. **Coverage.** Single-repo commits never refreshed the graph at all.
3. **Layers.** graphify extraction has two layers — **structural/AST (syntactic, deterministic,
   free)** and **semantic (LLM, via the agent's subagents or `GEMINI_API_KEY`)**. A headless CLI
   cannot do the semantic layer; only the in-agent `/graphify --mode deep` can.

## Decision

When graphify is available (`graphify-out/graph.json` exists), the SYNC/commit step refreshes the
graph **before** committing, so the refreshed `graphify-out/` is staged into the same commit:

- **`/spec:commit` (the agent workflow) is the authoritative forcer.** It runs
  `/graphify <impacted-module> --update --mode deep` per impacted module (syntactic AST always +
  the LLM **semantic** pass + deep INFERRED edges), then re-merges the freshly-updated module graphs
  into a backup-monorepo's root (`graphify merge-graphs … --out graphify-out/graph.json`); a single
  repo's root is refreshed by the module update itself. This is mandatory when graphify is present.
- **`specguard commit --graphify` (the CLI) is the deterministic structural complement.** It runs
  the incremental `graphify update` per impacted module + root merge (single-repo: root update)
  **before** the commits and stages each graph. It is curated-safe (re-merge from updated modules,
  never a naive hand-rebuild) and fallback-safe (skips silently when no graph is present). The deep
  **semantic** pass remains the agent's job — or set `GEMINI_API_KEY` for a headless semantic run.

The two paths are complementary, not duplicated: the agent runs the deep/semantic update and then
`specguard commit --add` (no `--graphify`); CI/headless callers pass `--graphify` for the structural
refresh. The flag is opt-in (graph rebuilds can be slow), so it never surprises a plain `commit`.

## Consequences

- `--graphify` work moved before staging; single-repo now supported; impacted modules are computed
  up front so their graphs refresh before any commit.
- The committed tree always carries a graph consistent with its code when the flag/workflow is used.
- The correct flag is `--mode deep` (not `--deep`); `--update` keeps the refresh incremental, so a
  code-only change does the AST layer without paying for an unneeded semantic re-extraction.
- Curated root graphs are preserved by re-merging from updated modules, honoring ADR 0004's caution
  against naive rebuilds.
