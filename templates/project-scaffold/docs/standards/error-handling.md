# Error Handling — <Project>

> Starter template. Document **this** project's error policy so failures are expressed in the domain's
> language and mapped consistently. Fill the `<…>` placeholders.

## Principle

Business-rule failures are raised as named domain errors, never raw `<ValueError / Exception / Error>`.
Generic types are confined to <framework edges, library validation, scripts, the outer fallback>.

## Error roots (hierarchy)

```
<DomainError>            -> <status / handling>
├── <NotFoundError>      -> <404>
├── <ConflictError>      -> <409>
└── <InvalidInputError>  -> <422>
<InfraError>             -> <500>
<IntegrationError>       -> <502>
```

<Show the real root set. A new error subclasses an existing root — never a new parallel root.>

## Response envelope

```json
{ "detail": [ { "type": "<snake_case_code>", "msg": "<client-safe message>", "context": {} } ] }
```

## Boundary mapping

- A central handler registry maps error → status, most-specific first: <where it lives>.
- Routers/controllers raise domain errors, **not** transport exceptions, for business rules.
- Empty success body → `204`.

## Workers / messaging (if any)

<Classification → ACK (definitive) / NAK (transient, backoff) / TERM (corrupt), and where it's decided.>

## Usage rules

- Create a named error when a rule has a recurring business name.
- Broad `catch` only at operational edges (logging, ack/nak, 500 fallback).
