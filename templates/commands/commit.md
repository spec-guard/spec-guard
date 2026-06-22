---
id: commit
description: Sync the knowledge graph (if present), then commit as a Conventional Commit (no AI attribution), single repo or across the backup monorepo.
---
Run the SYNC/commit step. The message is authored by you; `specguard commit` enforces the rules.

0. **Knowledge-graph sync — when graphify is available, it MUST happen BEFORE the commit** (so the
   refreshed graph lands in the same commit, never after). Detect availability by checking for
   `graphify-out/graph.json` at the repo root (and inside each impacted module, for a backup
   monorepo). If it is absent, skip this entire step — graphify is optional and never blocks. The
   semantic pass runs in **your session** (subagents) — no API key. Two layers, two cadences:
   - **Structural — always (free).** Run `specguard commit --graphify …` (add the flag to the
     commit in step 2): it runs `graphify update` per impacted module **with the module as cwd**,
     then `merge-graphs` into the backup-monorepo root, staged before the commit. This is the
     deterministic, fallback-safe path and is enough for code-only changes.
   - **Semantic — only for modules whose docs/specs changed.** Run the skill **from inside the
     module**: `cd <module> && /graphify . --update`. The skill runs AST always and dispatches
     semantic subagents only when a changed file is a doc/spec/image (code-only skips the LLM).
     Then re-merge the root: `cd <root> && graphify merge-graphs <m1>/graphify-out/graph.json … --out graphify-out/graph.json`
     (or just re-run `specguard commit --graphify`, which re-merges).
   - **Never** `/graphify <module>` from the repo root (the skill writes `graphify-out/` to the
     *current* dir and would clobber the root) — `cd` into the module first. **Never** pass
     `--update` with `--mode deep` (`update` rejects `--mode`); a full `--mode deep` re-extract is a
     rare manual op (`cd <module> && /graphify . --mode deep`), not part of the commit.
   - Single repo: the in-place update *is* the root — no merge needed.
   - Confirm every graph refreshed without error. Stage the refreshed `graphify-out/` together with
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
