# Error & Exception Model

Which error you raise, where it's caught, and how it reaches the caller. Conform to the hierarchy the
repo already has — **never fork a parallel base error or invent a new envelope**. A business rule that
fails with a raw `Exception`, or a handler that maps a known error to the wrong status, is a regression.
Re-check before VERIFY is done. **These are rules, not suggestions — a deviation is a defect to fix, not a
style choice.**

## Contents
- The universal rules
- Organizing the hierarchy
- Mapping at the boundary
- Workers & messaging
- Python
- TypeScript
- How to verify

## The universal rules

1. **The domain speaks business errors.** When a failure has a business name, raise a named domain
   error — not `ValueError`/`Exception`/`RuntimeError`/`Error`. Generic types belong only at framework
   edges, library validation, scripts, and the outermost fallback.
2. **One rooted hierarchy.** Errors descend from the repo's small set of roots (typically a domain
   root, an infrastructure root, and an integration/external root). Find them; subclass the right one.
   Never start a second parallel root.
3. **Errors carry context, render a safe message.** Attach the identifiers/values as attributes
   (`order_id`, `field`, `reason`); expose a client-safe message. Never leak internals or PII.
4. **Convert at the boundary.** Infrastructure/transport errors are translated to domain or
   presentation errors before crossing inward. The UI never branches on `response.status`; the domain
   never sees an HTTP/SQL exception.
5. **Map centrally.** Exception → status (or → ACK/NAK) lives in one registered place, not scattered
   `if`/`catch` across handlers. Registration order matters: most specific first.
6. **Broad catch only at operational edges** — logging, ACK/NAK/TERM, the 500 fallback. A bare
   `except`/`catch` above a typed handler hides the case you care about (see `anti-regression.md`).

## Organizing the hierarchy

Two organizations are both valid — match the repo's:

- **One class per file + a folder barrel** (library style): `exceptions/order_not_found_error.py` …
  re-exported from `exceptions/__init__.py`. Feature-specific errors nest under the feature.
- **One consolidated module with per-feature base classes + section banners** (service style): a single
  `exceptions.py` where `OrderError(DomainError)` is the feature base and `OrderNotFoundError(OrderError)`
  the concrete one.

Either way: a concrete error subclasses a feature base which subclasses a root. Don't duplicate a base.

## Mapping at the boundary (worked example)

A central handler registry maps each error to a status and the canonical envelope:

| Error root / type | Status |
|---|---|
| not-found | 404 |
| conflict | 409 |
| invalid input / domain-invariant | 422 |
| not authenticated | 401 |
| integration / external failure | 502 |
| infra error + uncaught fallback | 500 |

Define **exactly one** canonical body and route every error through it — never fork a second shape. The
shape itself is the repo's to choose; example:
```json
{ "detail": [ { "type": "snake_case_code", "msg": "Client-safe message", "context": {} } ] }
```

- Register handlers most-specific-first; a generic domain-error handler refines by subtype.
- **Routers/controllers do not raise transport exceptions (`HTTPException`) for business rules** — they
  raise domain errors and let the handler serialize. Empty success body → `204`, not a thrown error.

## Workers & messaging

For event/queue consumers, classify the failure before deciding the ack:

```
WorkerError → BusinessError          → ACK   (definitive; don't retry)
            → InfrastructureError    → NAK   (transient; retry with backoff)
            → corrupt/undeserializable → TERM (drop; never redeliver)
```

Classify first, then ACK/NAK/TERM — never let an unclassified error escape the consumer loop.

## Python

- Roots as a tiny set: e.g. `DomainError(Exception)` (abstract), `InfraError(Exception)`,
  `IntegrationError(Exception)`. Catch the typed error before any generic `except`.
- Raise from the use case / entity: `raise OrderNotFoundError(order_id)`; validate invariants in
  `__post_init__`/constructor.

## TypeScript

- Domain hierarchy: `class DomainError extends Error` (+ `NotFoundError`, `InvalidInputError`,
  `ConflictError`, `AuthenticationError`, `NetworkError`).
- Transport stays in infrastructure: `class ApiError extends Error { status; detail? }` with an
  `isApiError(e): e is ApiError` guard. Convert `ApiError` → domain/presentation error before it reaches
  a component.

## How to verify

- Does every new error subclass an existing root? (No new parallel base.)
- Is it mapped centrally — status/ack added to the one registry — and does the envelope shape match?
- Did any router raise a transport exception for a business rule?
- Typed catches before generic; no PII/internal leak in messages.
