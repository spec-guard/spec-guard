# Token Economy & Context Engineering

The context window is a shared, finite resource. In a large monorepo, sloppy context use is the difference between an agent that stays sharp across a long session and one that thrashes, forgets invariants, and regresses. Economy is not cheapness — it's keeping the *right* signal in context.

## Contents
- Principles
- Reading
- Delegating to subagents
- Writing docs & code for future agents
- Anti-patterns

## Principles

1. **Load only the slice you need.** Progressive disclosure: read the CLAUDE.md index → the one governing doc/ADR → the specific files. Don't pre-read whole trees "just in case."
2. **Push detail to disk, keep pointers in context.** Reference files, examples, and large data belong on the filesystem, loaded on demand — not pasted into every prompt.
3. **Delegate breadth; keep the conclusion.** When a question means sweeping many files, dispatch a search/explore subagent and keep its conclusion, not the file dumps.
4. **Smaller surface = fewer regressions.** Inject narrow ports/interfaces, not god-facades. The less a unit can touch, the less an edit can break.

## Reading

- Start at the repo CLAUDE.md (it's the map), then follow exactly one link deep to the governing doc. Resist opening ten files before you know which one matters.
- When you only need a fact (a port number, an enum value), grep for it — don't read the whole file. If the repo has a knowledge graph, query it first ([graphify-integration.md](graphify-integration.md)).
- Re-read the governing doc at the start of a session; do not trust cross-session memory for load-bearing invariants (they may have changed).

## Delegating to subagents

- Use subagents for fan-out work (audits, multi-file search, parallel implementation) so their intermediate reading doesn't fill your context — you receive only their structured result.
- Give each subagent a tight, self-contained spec and a structured output shape. Partition so they don't overlap.
- For verification, a fresh subagent with no attachment to the implementation makes a better skeptic.

## Writing docs & code for future agents

- A CLAUDE.md should be an **index of load-bearing invariants + a map to canonical docs**, not a copy of those docs. Keep the invariant inline (one tight block); link the full detail.
- Don't duplicate the same boilerplate (tooling commands, package-manager rules) across every module file — state it once at the root and link. Duplication rots and burns tokens on every load.
- Avoid time-stamped "(NEW 2026-xx)" / "last updated" noise inside guidance files — git tracks history; stamps just rot and add tokens. Date the ADR instead.
- Keep guidance concise: assume the reader (human or model) is already competent; add only what they can't infer.

## Anti-patterns

| Anti-pattern | Cost | Instead |
|--------------|------|---------|
| Reading whole directories before scoping | fills context, drowns signal | grep/index → targeted read |
| Pasting large files into prompts | token burn, lost focus | reference on disk, load on demand |
| Boilerplate copied across N module docs | N× token cost, drift | state once at root, link |
| Wide god-object dependencies | any edit can regress anything | narrow ports |
| Doing a broad search inline | context bloat | dispatch an explore subagent |
| Re-deriving an invariant from code each time | wasted tokens, wrong guesses | read the canonical doc/ADR once |
