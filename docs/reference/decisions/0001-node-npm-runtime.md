# ADR 0001 — Node + npm runtime

**Status:** Accepted

## Context

spec-guard ships a CLI plus lifecycle hooks for AI coding agents. The existing hook scripts
are already Node/CommonJS. The two reference tools split: Spec Kit is Python/`uv`, OpenSpec
is Node/npm. We need broad reach, zero extra language runtime for users, and reuse of the
existing JS hooks.

## Decision

Build on **Node + npm**, distributed as the scoped package `@spec-guard/cli`. Entry via a
`bin` shebang script; `npx @spec-guard/cli` for one-shot use. Target `node >= 20`.

## Consequences

- Reuses the existing JS hooks; matches OpenSpec's distribution model.
- Scoped package name avoids npm squatting and enables org-managed publishing
  (`--access public`).
- Users need Node, not Python. Self-update is `npm i -g @spec-guard/cli@<tag>`.
