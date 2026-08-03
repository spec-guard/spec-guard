# Spec 0003 - README refresh and minimal branding

**Status:** IMPLEMENTED

## Context / Problem

The root `README.md` is technically accurate but reads like an ADR: dense tables, no narrative
hook, no visual identity. The repo and npm listing also ship with no logo/image, so both
`github.com/spec-guard/spec-guard` and `npmjs.com/package/@spec-guard/cli` look unfinished next to
competitors. Separately, the README states spec-guard's differentiation from GitHub Spec Kit /
OpenSpec in one line without backing it up anywhere a reader can quickly scan.

## In-Scope

- A minimal SVG wordmark/logo, committed to the repo, referenced at the top of the README via a
  relative path (renders on GitHub and, via npm's README image-URL rewrite for GitHub-hosted
  packages, on the npm listing too).
- A rewritten README narrative voice: friendlier and more direct, still professional/technical —
  no change to factual claims about commands, flags, or behavior.
- A dedicated, evidence-based "vs Spec Kit / OpenSpec" comparison section placed near the top,
  grounded in ADR 0007 and confirmed against each project's own public description.
- Preserve every existing accurate technical detail (command tables, agent capability matrix,
  configuration, uninstall/safety model).

## Out-of-Scope

- GitHub repo "social preview" image upload and any npm/org avatar — both require an authenticated
  action in each platform's web UI; not achievable from the repo/CLI. The asset is produced here;
  uploading it is a manual step for the maintainer.
- Any change to CLI behavior, `src/`, or `skill/` content.
- A full rebrand (color system, style guide) — out of scope for a README pass.

## Acceptance Criteria

1. `README.md` renders a logo at the top via a relative image path that resolves on GitHub.
2. A comparison section names GitHub Spec Kit and OpenSpec and states differentiators that are
   traceable to ADR 0007 (and are independently consistent with each tool's own public
   documentation, checked via web search on 2026-08-03).
3. No factual regression: every command, flag, and table present before the rewrite still appears,
   accurate, after it.
4. The prose voice changes (shorter sentences, direct address, less passive/formal phrasing) without
   introducing inaccuracies or unsupported marketing claims.

## Traceability

- ADR 0007 (binary name / competitive positioning vs Spec Kit & OpenSpec).
- ADR 0003 / 0010 (multi-agent single-source rendering + honest capability matrix).
- ADR 0006 (harness-agnostic IP/deliverable wall).
- ADR 0009 (multi-module topology + IP firewall on the graph).
- ADR 0005 (manifest-guarded, non-destructive updates).
