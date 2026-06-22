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
   free)** and **semantic (LLM, via the agent's session subagents — no API key; or `GEMINI_API_KEY`
   for a headless run)**. A headless CLI cannot do the semantic layer; only the in-agent skill can.
4. **A broken recipe.** The first cut documented a per-module `/graphify <module>` call carrying
   both `--update` and `--mode deep`, which is invalid twice over: `graphify update` rejects
   `--mode` (exit 2), and the skill writes `graphify-out/` to the *current* directory, so
   `/graphify <module>` from the root clobbers the root graph instead of refreshing the module's.
   This likely pushed a pilot to improvise a non-standard pipeline.

## Decision

When graphify is available (`graphify-out/graph.json` exists), the SYNC/commit step refreshes the
graph **before** committing, so the refreshed `graphify-out/` is staged into the same commit. Two
layers, two cadences (see ADR 0009 for the topology and IP firewall):

- **Structural — every commit, free.** `specguard commit --graphify` runs the incremental
  `graphify update` per impacted module **with the module as its working directory**, then
  `merge-graphs` into the backup-monorepo root (single-repo: the in-place update *is* the root),
  **before** the commits, staging each graph. It is curated-safe (re-merge from updated modules,
  never a naive hand-rebuild) and fallback-safe (skips silently when no graph is present). Enough on
  its own for code-only changes.
- **Semantic — only when a module's docs/specs changed.** The agent runs the skill **from inside
  the module**: `cd <module> && /graphify . --update`. The skill runs AST always and dispatches
  session subagents only for changed docs/specs/images (code-only skips the LLM) — no API key — then
  the root is re-merged. A headless run can instead set `GEMINI_API_KEY`.

The two paths are complementary: the agent does the semantic update from the module dir, then
re-merges and commits (`specguard commit --graphify` re-merges deterministically). The flag is
opt-in (graph refreshes can be slow), so it never surprises a plain `commit`.

**Correct invocation (load-bearing):** run the skill from the module's own directory
(`cd <module> && /graphify . …`), never `/graphify <module>` from the root — the skill writes
`graphify-out/` to the current dir and would clobber the root. Never combine `--update` with
`--mode deep`; they are mutually exclusive at graphify's CLI.

## Consequences

- `--graphify` work moved before staging; single-repo now supported; impacted modules are computed
  up front so their graphs refresh before any commit.
- The committed tree always carries a graph consistent with its code when the flag/workflow is used.
- Structural (`graphify update`) and semantic (`/graphify . --update` from the module dir, or full
  `--mode deep`) are **separate commands**, not flags on one — `update` is incremental and rejects
  `--mode`. A code-only change does the AST layer only, paying nothing for an unneeded semantic
  re-extraction.
- Curated root graphs are preserved by re-merging from updated modules, honoring ADR 0004's caution
  against naive rebuilds.
