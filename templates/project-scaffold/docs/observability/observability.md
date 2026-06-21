<!-- spec-guard:scaffold-placeholder -->
# Observability — <Project>

> **Single source of truth — rigid.** Fill this in with YOUR project's actual observability contract
> (logging, metrics, tracing). If your project already documents observability elsewhere, do NOT fill this
> in — replace this whole file with a one-line pointer to that canonical doc. Never keep two docs on one
> topic. Delete this banner and the comment line above once filled (or replaced with a pointer).

## Logging seam (mandatory)

- Use `<the injected logger / gateway / useLogger()>`. **Never** `<print / console.log / stdout>`.
- Structured logs: an event name + key/value context, not interpolated prose.
- Event taxonomy: <naming scheme, e.g. `domain.action`>.

## Log levels

| Level | Use for |
|---|---|
| error | <actionable failure> |
| warn | <recoverable> |
| info | <lifecycle> |
| debug | <detail> |

## Metrics

<Client (e.g. Prometheus); naming/labels; the metric(s) every `<handler/job>` must emit.>

## Tracing

<Tracer / stack (e.g. OpenTelemetry); correlation/trace-id propagation across boundaries.>

## Instrumentation requirements (acceptance criterion)

A feature is **not done** until it: logs lifecycle (start / success / failure with context), emits its
metric(s), and participates in the trace.

## PII & secrets

Never log PII or secrets; redact via <the masking helper>.
