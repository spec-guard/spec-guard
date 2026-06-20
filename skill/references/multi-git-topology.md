# Multi-Git-Repo & Backup-Monorepo Topology

Many "monorepos" are not one git repo. A common professional layout is **N deliverable git
repos** (each shipped to a client) sitting inside a **backup monorepo** (a private root repo
that versions everything — code plus intellectual property plus secrets — for the team).
spec-guard reasons about this so a contract change and an IP/deliverable decision are correct
across repo boundaries, not just folder boundaries.

## The shape

```
~/dev/workspace/                 ← backup monorepo root (private; versions EVERYTHING)
├── .git/                        ← root repo (IP-bearing; never delivered)
├── service-a/                   ← deliverable repo (own .git, own remote)
│   ├── .git/
│   ├── .gitignore               ← excludes ${ipDir}/ .env* agent-dirs graphify-out/ (never ships)
│   └── ${ipDir}/                ← IP knowledge base: local + in backup, gitignored in the deliverable
├── service-b/                   ← deliverable repo (own .git)
└── ride-along/                  ← no own .git; versioned only via the backup root
```

## Load-bearing facts

1. **Module HEAD ≠ backup HEAD.** Each deliverable repo has its own commit history (what the
   client receives). The backup root has a *separate* history capturing all of it plus IP.
   "The current commit" is ambiguous — be explicit about which repo you mean.
2. **`.git` may be transiently renamed.** Some backup setups rename each module's `.git` to
   `.git_backup` *during* a root commit (so the root can stage module files without nested-repo
   conflicts), then restore it. If you inspect git state, a module's `.git` may momentarily be
   `.git_backup` — tooling must tolerate both.
3. **IP is gitignored per-module but captured at the root.** The IP knowledge base (`${ipDir}/`),
   per-agent integration dirs (`.claude/`, `.codex/`, `.gemini/`, `.github/`), `.env*`, and
   generated artifacts (e.g. `graphify-out/`) are excluded from each deliverable's `.gitignore`
   so they never ship — yet they exist on disk and are versioned by the backup root. Do not assume
   a file is untracked just because the deliverable ignores it.
4. **Ride-along dirs.** Some folders have no own `.git`; they are not separate deliverables and
   ride along only in the backup. If one ever becomes deliverable, add a deliverable `.gitignore`
   (`${ipDir}/`, agent dirs, `.env*`, generated artifacts) **before** `git init` + push, or IP leaks.

## What this means for the loop

- **PLAN / ripple:** a contract change crosses *repo* boundaries, not just module folders.
  Update every consuming deliverable repo, and commit each in dependency order — the change is
  not "done" until each affected repo is committed, plus the backup root.
- **SYNC / commit:** commit inside the affected deliverable repo(s) first, then let the backup
  root capture the state. Committing only at the root leaves the deliverable repos stale.
- **IP wall:** the wall (see [ip-vs-deliverable.md](ip-vs-deliverable.md)) is enforced per
  deliverable repo — a `docs/` file in `service-a` must not link into `service-a/${ipDir}/` or
  any of its agent dirs.
