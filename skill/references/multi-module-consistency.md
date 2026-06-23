# Multi-Module Consistency

In a monorepo of many services sharing contracts, a change is almost never single-module. This file is the ripple checklist: when you touch a contract, what else must move, and in what order.

## Contents
- The mental model
- Contract change ripple
- Dependency order
- Shared modules: don't fork, extend
- The API-change fan-out
- Parallelizing safely
- How to verify

## The mental model

Think of the repo as a dependency graph, not a folder list. The shared contract modules sit at the root; every service depends on them. A change at the root propagates to every leaf. The Coordinator's first job is to compute that propagation *before* coding, so nothing breaks silently downstream.

## Contract change ripple

When you change any of these, enumerate and update every consumer:

| You change… | Then you must touch… |
|-------------|----------------------|
| A shared enum / status | the canonical definition + every service that switches on it (exhaustively) + persisted data if values changed |
| An event payload | the event contract module + every publisher + every consumer + the event catalog doc + version bump |
| An API request/response | the route + the API contract doc + the customer-facing docs site + the API client collection (e.g. Insomnia) + SDK/code samples |
| A DB schema | the migration + the database-schema doc + any repo reading the table + any event carrying those fields |
| A domain value object | its module + every place that constructs/serializes it (public vs storage form) |

## Dependency order

Operate (build, test, migrate, commit) in dependency order — shared/core first, then the services that consume them, then the orchestration/backup layer. Reversing the order produces transient broken states and confusing test failures. The repo's commit/quality workflow encodes this order; follow it.

## Shared modules: don't fork, extend

- If a contract (enum, DTO, event, VO) exists in a shared module, **reuse it**. Never copy it into a consumer "to move faster" — that fork is a guaranteed future divergence.
- Need a new variant? Add it to the shared source and fix the compile/test breakage everywhere. The breakage *is* the feature — it shows you every consumer that must adapt.
- Cross-module behavior changes deserve an ADR; the decision must be discoverable, not buried in one service's commit.

## The API-change fan-out

A public API change is the highest-ripple event. Minimum fan-out (adapt to the repo's actual surfaces):

1. Implement + version the endpoint per the repo's API standards/governance doc.
2. Update the internal architecture/contract-alignment doc.
3. Update the customer-facing documentation site (the canonical external contract).
4. Update the API client collection (Insomnia/Postman) used for manual + runtime testing.
5. Update SDK snippets / code samples if the repo ships them.
6. Update the changelog and error-code reference if errors changed.

Shipping the endpoint without 2–6 leaves the contract docs lying — a regression for every customer and every future agent.

## Parallelizing safely

- Partition work at the spec level into **non-overlapping** file sets so parallel implementors don't collide; dispatch independent tasks to parallel subagents.
- For risky parallel edits, isolate each agent in its own git worktree.
- Keep one integration point: after parallel work, a single Verifier pass reconciles the contract across modules before commit.
- When the "monorepo" is actually several deliverable git repos plus a backup monorepo, the ripple crosses repo boundaries — see [multi-git-topology.md](multi-git-topology.md).

## How to verify

- [ ] Was every consumer of the changed enum / event / API / schema / VO enumerated before coding started? (No consumer discovered mid-implementation.)
- [ ] Did commits happen in dependency order — shared/core first, then consumers, then orchestration? No consumer committed before its dependency.
- [ ] For an API change: were all 6 fan-out targets updated? (endpoint + internal arch doc + customer docs + API client collection + SDK samples + changelog/error-code reference)
- [ ] Was a single Verifier pass run after all parallel work to reconcile the contract across modules before commit?
- [ ] If the change crossed repo boundaries: were all affected deliverable repos updated and committed individually — not lumped into the backup monorepo commit?
- [ ] Is the contract change recorded in an ADR? Is the ADR cross-linked from every affected module's CLAUDE.md?
