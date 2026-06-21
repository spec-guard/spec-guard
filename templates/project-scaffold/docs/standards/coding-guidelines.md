<!-- spec-guard:scaffold-placeholder -->
# Coding Guidelines — <Project>

> **Single source of truth — rigid.** Fill this in with YOUR project's actual in-file house style. If your
> project already documents coding guidelines elsewhere, do NOT fill this in — replace this whole file
> with a one-line pointer to that canonical doc. Never keep two docs on one topic. Delete this banner and
> the comment line above once filled (or replaced with a pointer).
> Structure/layering lives in `docs/architecture/code-architecture.md`.

## Principles

SOLID, DRY, KISS, YAGNI. One responsibility per file/class; one canonical definition; the simplest
thing that meets the spec; no speculative generality.

## Naming

| Kind | Convention | Example |
|---|---|---|
| Use case | <VerbNoun + UseCase> | `<PlaceOrderUseCase>` |
| Repository (interface / adapter) | `<NounRepository>` / `<PostgresNounRepository>` | |
| Gateway | `<NounGateway>` | |
| Route/handler file | `<{verb}_{resource}_router>` | |

## Typing

<Modern builtins (`list[T]`, `X | None`) / strict mode; type public surfaces; no legacy aliases if on
PEP 585/604.>

## Dependency injection

- **No default values in constructors** — inject explicitly; wire in factories; factories return
  interfaces, not implementations.

## Logging & observability

- Never `<print / console.log>`; use the injected logger. Full policy: `docs/observability/observability.md`.

## Determinism

<UTC timestamps; idempotent handlers; stable IDs/formats.>

## Code-review checklist

- [ ] SOLID / DRY / KISS / YAGNI; no duplicated definition.
- [ ] Naming matches the taxonomy above.
- [ ] Typed; no constructor defaults; factories return interfaces.
- [ ] No `print`/`console.log`; logging via the seam.
- [ ] Invariants validated at construction.
- [ ] UTC / idempotent / stable IDs.
