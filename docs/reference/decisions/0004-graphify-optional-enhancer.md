# ADR 0004 — Graphify as an optional enhancer

**Status:** Accepted

## Context

Some repos carry a `graphify-out/` knowledge graph that can answer "where does X live" and
"is this spec connected to that module" far more cheaply than grep. spec-guard's ORIENT and
VERIFY steps could use it — but spec-guard must work in repos without graphify.

## Decision

Treat graphify as an **optional enhancer with graceful fallback**. When
`graphify-out/graph.json` exists, ORIENT may use `graphify query` and VERIFY may use
`graphify path "<concept>" "<module>"`; otherwise fall back to grep/read. Never a hard
dependency, never required for any command to succeed.

## Consequences

- Zero install-time or runtime coupling to graphify.
- `src/core/graphify.js` probes for the graph and degrades silently when absent.
