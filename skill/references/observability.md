# Observability

Logging, metrics, and tracing — instrumentation is part of "done", not an afterthought. Go through the
repo's logging/telemetry seam and emit what its contract requires; a feature that ships without the
logs/metrics/traces the repo expects is incomplete even when its tests pass.

## Contents
- The universal rules
- Instrumentation is part of done
- Detect & conform
- Python
- TypeScript
- How to verify

## The universal rules

1. **Instrument through the repo's seam — never raw `print`/`console.log`/stdout.** Use the provided
   logger/gateway, injected (not a global singleton).
2. **Structured logs.** Emit an event name + key/value fields, not interpolated prose. One event
   taxonomy, the repo's.
3. **Propagate a correlation/trace id** across every boundary (request → use case → adapter → outbound
   call) so a flow is reconstructable.
4. **Never log PII or secrets** — use the repo's masking/redaction helper (cross-link
   `anti-regression.md`).
5. **Emit the metrics/spans the observability contract requires** — counters/histograms/spans with the
   established names and labels. Don't add a feature without its instrumentation.
6. **Use the repo's log levels** consistently (error = actionable failure, warn = recoverable,
   info = lifecycle, debug = detail).

## Instrumentation is part of done

Treat observability as an acceptance criterion: a new endpoint/handler/job is not complete until it
logs its lifecycle (start / success / failure with context), increments the relevant metric, and
participates in the trace. Add this to the VERIFY pass for the change.

## Detect & conform

Find the repo's logging gateway and telemetry stack — a structured logger, an injected
`LoggerGateway`/`useLogger`, OpenTelemetry, a Prometheus client, Loki/Tempo exporters — and use it.
Never stand up a parallel logging mechanism alongside the existing one.

## Python

- Inject a logger gateway; name it `self._logger`. Log structured context:
  ```python
  self._logger.info("order.placed", context={"order_id": order.id, "account_id": order.account_id})
  ```
- Register/emit metrics with the repo's client and the established metric names.

## TypeScript

- Obtain the logger via DI/hook — `const logger = useLogger()` — in every component/hook. Never
  `console.log`.
- Convert transport errors before logging at the UI boundary; log the domain error with context, not
  the raw response.

## How to verify

- Grep the change for raw `print`/`console.log`/stdout writes — there should be none.
- Does the new code log its lifecycle with structured context, emit the required metric, and propagate
  the correlation id?
- No PII/secret in any log line.
