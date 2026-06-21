# Coding Conventions

In-file house style: how a line of code should read so it looks like the code already there. Structure
lives in `code-organization.md`; this is the grain at the statement level. Before writing, open a
sibling file and match it. **These are rules, not suggestions — a deviation is a defect to fix, not a
style choice.**

## Contents
- The universal rules
- Naming
- Dependency injection
- Python
- TypeScript
- Code-review checklist

## The universal rules

1. **Serve the principles the work already values — SOLID, DRY, KISS, YAGNI.** One responsibility per
   file/class (SRP); one canonical definition, never a copy (DRY — cross-link `anti-regression.md`); the
   simplest thing that satisfies the spec, no speculative generality or gold-plating (KISS/YAGNI —
   cross-link `token-economy.md`). Surface violations at review.
2. **Names follow the repo's taxonomy.** Role suffixes (`…UseCase`, `…Repository`, `…Gateway`,
   `…Service`); file-per-responsibility names (e.g. a route file named by verb + resource). Don't invent
   a new suffix or casing.
3. **Type everything the repo types.** Use the modern builtins it uses (`list[T]`, `dict[K, V]`,
   `X | None`) — don't reach for legacy `Optional`/`Dict`/`List` if the repo is on PEP 585/604. Type
   public surfaces.
4. **Inject dependencies explicitly — no default values in constructors.** Defaults hide a
   Service-Locator and make the dependency graph invisible. Wire dependencies in factories; factories
   return interfaces, not concrete implementations.
5. **Observe through the repo's logging seam** — never `print`/`console.log`. Depth in
   `observability.md`.
6. **Validate invariants at construction** (`__post_init__`/constructor), raising the domain error —
   not deep inside a use case.
7. **Determinism:** UTC timestamps, idempotent handlers, stable IDs and formats.
8. **Docstrings/comments where the repo expects them** — and explain *why*, not what.

## Naming

Match the established pattern; a few representative shapes:

- Use case: `VerbNoun` + `UseCase` (`PlaceOrderUseCase`).
- Repository interface: `NounRepository`; adapter: `PostgresNounRepository` / `MockNounRepository`.
- Gateway interface: `NounGateway`; HTTP route file: `{verb}_{resource}_router`.

## Dependency injection

```python
# ✗ default hides the dependency (Service-Locator)
def __init__(self, repo: OrderRepository = PostgresOrderRepository()): ...

# ✓ explicit; the factory wires it
def __init__(self, repo: OrderRepository): ...

def create_place_order_use_case(...) -> PlaceOrderUseCase:   # factory returns the interface-typed object
    return PlaceOrderUseCase(repo=create_order_repository(...))
```

## Python

- `from __future__ import annotations` first; `X | None` not `Optional[X]`; `list[T]` not `List[T]`.
- Inject a logger gateway (`self._logger`), never `print`.
- Entities are dataclasses validating in `__post_init__`.

## TypeScript

- `strict` on; explicit types on public surfaces.
- Never `console.log` — use the injected logger / `useLogger`.
- **Backend is the source of truth** — don't re-derive business logic from formatted strings on the
  client.

## Code-review checklist

- [ ] SRP / DRY / KISS / YAGNI respected; no copy of an existing definition.
- [ ] Names match the repo's role-suffix taxonomy.
- [ ] Modern typing; public surfaces typed.
- [ ] No default values in constructors; factories return interfaces.
- [ ] No `print`/`console.log`; logging via the gateway.
- [ ] Invariants validated at construction, raising a domain error.
- [ ] UTC, idempotent, stable IDs.
