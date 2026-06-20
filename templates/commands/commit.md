---
id: commit
description: Commit the change as a Conventional Commit (no AI attribution), single repo or across the backup monorepo.
---
Run the SYNC/commit step. The message is authored by you; `spec-guard commit` enforces the rules.

1. Review the staged/changed work and draft a **Conventional Commit** message
   (`feat|fix|chore|docs|refactor|test|perf|build|ci|style|revert: subject`), in the repo's
   configured commit language (`commitLanguage`, default English). Body explains the *why*.
   **Never** add AI attribution (no "Co-Authored-By", no "Generated with…", no session links).
2. Commit:
   - Single repo:        `spec-guard commit --add --message "<type>: <subject>"`
   - Whole backup monorepo (each impacted deliverable repo in order, then the root):
     `spec-guard commit --all --message "<type>: <subject>"`
   - Specific modules:   `spec-guard commit --scope <a,b> --message "..."`
   - Re-sync the graph:  add `--graphify` (per-impacted-module extract + curated root merge)
3. Confirm the commit(s) landed and report which repos were committed.
