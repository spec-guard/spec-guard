---
id: commit
description: Sync the knowledge graph (if present), then commit as a Conventional Commit (no AI attribution), single repo or across the backup monorepo.
---
Run the SYNC/commit step. The message is authored by you; `specguard commit` enforces the rules.

0. **Knowledge-graph sync — MANDATORY when graphify is available, and it MUST happen BEFORE the
   commit** (so the refreshed graph lands in the same commit, never after). Detect availability by
   checking for `graphify-out/graph.json` at the repo root (and inside each impacted module, for a
   backup monorepo). If it is absent, skip this entire step — graphify is optional and never blocks.
   If it is present, refresh the graph syntactically **and** semantically:
   - **Each impacted module** (every module whose code/docs changed): run a **deep incremental
     update** so both layers stay current —
     - Preferred (full syntactic **+ semantic**, when your agent has the graphify skill):
       `/graphify <module-path> --update --mode deep`
       — `--update` re-extracts only what changed; AST/structural runs always (syntactic); the LLM
       semantic pass runs for changed docs/specs; `--mode deep` enriches INFERRED (semantic) edges.
     - Fallback (no skill, e.g. CI or a non-Claude agent): `specguard commit --graphify …` performs
       the deterministic **structural** refresh + root merge (the semantic pass needs the agent or
       `GEMINI_API_KEY`).
   - **Root graph sync:**
     - **Backup monorepo:** after the per-module updates, re-merge the *freshly updated* module
       graphs into the root — `graphify merge-graphs <m1>/graphify-out/graph.json … --out graphify-out/graph.json`.
       For a curated root graph, re-merge from the updated modules; do **not** hand-rebuild it.
     - **Single repo:** `/graphify . --update --mode deep` already refreshed the root graph — done.
   - Confirm every graph rebuilt without error. Stage the refreshed `graphify-out/` together with
     your code (`--add` / `git add` below covers it). Only then proceed to the commit.
1. Review the staged/changed work and draft a **Conventional Commit** message
   (`feat|fix|chore|docs|refactor|test|perf|build|ci|style|revert: subject`), in the repo's
   configured commit language (`commitLanguage`, default English). Body explains the *why*.
   **Never** add AI attribution (no "Co-Authored-By", no "Generated with…", no session links).
2. Commit (this stages the refreshed graphs together with the code):
   - Single repo:        `specguard commit --add --message "<type>: <subject>"`
   - Whole backup monorepo (each impacted deliverable repo in order, then the root):
     `specguard commit --all --message "<type>: <subject>"`
   - Specific modules:   `specguard commit --scope <a,b> --message "..."`
   - No graphify skill?  add `--graphify` to let the CLI do the structural refresh + root merge
     **before** committing (e.g. `specguard commit --all --graphify --message "..."`).
3. Confirm the commit(s) landed and report which repos were committed and which graphs were refreshed.
