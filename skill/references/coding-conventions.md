# Coding Conventions

In-file house style: how a line of code should read so it looks like the code already there. Structure
lives in `code-organization.md`; this is the grain at the statement level. Before writing, open a
sibling file and match it. **These are rules, not suggestions — a deviation is a defect to fix, not a
style choice.**

## Contents
- The universal rules
- Naming
- Dependency injection
- Entry-points
- Null Object pattern
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
   return interfaces, not concrete implementations. Exception: use cases that have no separate
   interface may return the concrete class — the factory still wires dependencies.
5. **Observe through the repo's logging seam** — never `print`/`console.log`. Depth in
   `observability.md`.
6. **Validate invariants at construction** (`__post_init__`/constructor), raising the domain error —
   not deep inside a use case.
7. **Determinism:** UTC timestamps, idempotent handlers, stable IDs and formats.
8. **Docstrings/comments where the repo expects them** — and explain *why*, not what.

## Naming

Match the established pattern; a few representative shapes:

- Use case: `VerbNoun` + `UseCase` (`PlaceOrderUseCase`).
- Repository interface: `NounRepository`; adapter: `PostgresNounRepository` / `FakeNounRepository`.
- Gateway interface: `NounGateway`; HTTP route file: `{verb}_{resource}_router`.
- Exception: match the repo's organization (see [error-model.md](error-model.md)); the most common style is one class per file with filename matching the class name in snake_case (`order_not_found_error.py`).

## Dependency injection

```python
# ✗ default hides the dependency (Service-Locator)
def __init__(self, repo: OrderRepository = PostgresOrderRepository()): ...

# ✓ explicit; the factory wires it
def __init__(self, repo: OrderRepository): ...

def create_place_order_use_case(...) -> PlaceOrderUseCase:   # use case has no separate interface here; return type is the concrete class
    return PlaceOrderUseCase(repo=create_order_repository(...))
```

## Entry-points

The application entry-point is a factory function, not a module-level side-effect:

```python
# interfaces/http/main.py
def create_app() -> FastAPI:
    app = FastAPI(...)
    app.include_router(order_router)
    app.add_exception_handler(DomainError, domain_exception_handler)
    return app

app = create_app()   # module-level instance for the ASGI server
```

Why a factory: tests call `create_app()` and get a fresh, isolated instance. Module-level
instantiation makes test isolation impossible. Never import `app` directly in tests — use
`TestClient(create_app())`.

## Null Object pattern

Use the Null Object pattern for collaborators whose side effects don't matter in a given context (tests, CLI scripts, worker startups) — observability (logger, metrics), audit sinks, notification gateways:

```python
class NullLoggerGateway(LoggerGateway):
    def debug(self, *_, **__) -> None: pass
    def info(self, *_, **__) -> None: pass
    def aviso(self, *_, **__) -> None: pass
    def erro(self, *_, **__) -> None: pass
    def exception(self, *_, **__) -> None: pass
    # ... all interface methods as pass-through no-ops

class NullMetricaGateway(MetricaGateway):
    def incrementar_contador(self, *_, **__) -> None: pass
    def observar_histograma(self, *_, **__) -> None: pass
    def definir_gauge(self, *_, **__) -> None: pass
```

A Null Object is not a Mock — it doesn't record calls or raise on unexpected invocations. It is a
silent collaborator. Use it when the effect is irrelevant to the test's assertion; use an
accumulating Fake when you need to assert what was logged or measured. See
[testing-patterns.md](testing-patterns.md).

## Python

- `from __future__ import annotations` first; `X | None` not `Optional[X]`; `list[T]` not `List[T]`.
- Inject a logger gateway (`self._logger`), never `print`.
- Entities are dataclasses validating in `__post_init__`.
- Exceptions grouped in `exceptions/` folders with an `__init__.py` barrel; one class per file (library style) or a consolidated `exceptions.py` (service style) — match the repo's (see [error-model.md](error-model.md)).
- Never import env vars or settings inside `domain/` — settings belong in `infrastructure/settings/`.

## TypeScript

- `strict` on; explicit types on public surfaces.
- Never `console.log` — use the injected logger / `useLogger`.
- **Backend is the source of truth** — don't re-derive business logic from formatted strings on the
  client.

## Code-review checklist

- [ ] SRP / DRY / KISS / YAGNI respected; no copy of an existing definition.
- [ ] Names match the repo's role-suffix taxonomy and the ubiquitous language glossary.
- [ ] Modern typing; public surfaces typed.
- [ ] No default values in constructors; factories return interfaces (or the concrete class when no separate interface exists, e.g. use cases).
- [ ] No `print`/`console.log`; logging via the gateway.
- [ ] Invariants validated at construction, raising a domain error.
- [ ] UTC, idempotent, stable IDs.
- [ ] App entry-point is a factory function (`create_app()`); not a module-level side-effect.
- [ ] Null Objects used when the side effect is irrelevant (observability, audit sinks, notification gateways); accumulating Fakes (e.g. FakeLogger) when asserting what was logged, audited, or notified; Fakes for all other stateful collaborators.
- [ ] Exception names are concrete (`OrderNotFoundError`, not `Error`); organization matches the repo's chosen style (see [error-model.md](error-model.md)).
