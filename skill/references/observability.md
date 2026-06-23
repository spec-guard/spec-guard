# Observability

Logging, metrics, and tracing — instrumentation is part of "done", not an afterthought. Go through the
repo's logging/telemetry seam and emit what its contract requires; a feature that ships without the
logs/metrics/traces the repo expects is incomplete even when its tests pass. **These are rules, not
suggestions — a deviation is a defect to fix, not a style choice.**

## Contents
- The universal rules
- Instrumentation is part of done
- Correlation IDs
- Tracing
- Detect & conform
- Instrumented decorator pattern
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
6. **Use the repo's log levels** consistently (erro/error = actionable failure, aviso/warn = recoverable,
   info = lifecycle, debug = detail).

## Instrumentation is part of done

Treat observability as an acceptance criterion: a new endpoint/handler/job is not complete until it
logs its lifecycle (start / success / failure with context), increments the relevant metric, and
participates in the trace. Add this to the VERIFY pass for the change.

## Correlation IDs

Every operation that crosses a boundary (HTTP request → use case → outbound call; event consumer →
handler; batch job → per-item processor) must carry a correlation / trace ID so the full flow is
reconstructable in logs and traces.

```python
# Generate once at the boundary (HTTP middleware, event consumer, batch launcher),
# then propagate explicitly as a parameter through every layer.
import uuid

class FulfillOrderUseCase:
    async def execute(self, order_id: UUID, correlation_id: str) -> Result:
        self._logger.info("order.fulfillment.started", context={
            "order_id": str(order_id),
            "correlation_id": correlation_id,
        })
        result = await self._do_work(order_id, correlation_id=correlation_id)
        self._logger.info("order.fulfillment.done", context={
            "order_id": str(order_id),
            "correlation_id": correlation_id,
            "result": result.status,
        })
        return result
```

For HTTP requests, extract or generate the ID from a header (`X-Correlation-Id`,
`X-Request-Id`), inject it into middleware context, and echo it in the response headers so
callers can trace their own requests.

For batch / parallel fan-out, generate one ID for the batch and propagate it to each task:
```python
batch_id = str(uuid.uuid4())
tasks = [
    self._process_item(item, batch_correlation_id=batch_id)
    for item in items
]
```

## Tracing

Distributed tracing records the path of a request through all services and layers. Use the repo's
OpenTelemetry setup — never instantiate a separate tracer.

**Creating and propagating a span:**

```python
from opentelemetry import trace
from opentelemetry.trace import StatusCode

tracer = trace.get_tracer(__name__)

class FulfillOrderUseCase:
    async def execute(self, order_id: UUID, correlation_id: str) -> Result:
        with tracer.start_as_current_span("FulfillOrderUseCase.execute") as span:
            span.set_attribute("operation", "FulfillOrderUseCase.execute")
            span.set_attribute("correlation_id", correlation_id)
            try:
                result = await self._do_work(order_id, correlation_id=correlation_id)
                span.set_status(StatusCode.OK)
                return result
            except Exception as exc:
                span.set_status(StatusCode.ERROR, description=str(exc))
                span.record_exception(exc)
                raise
```

Rules:
- **Start the span at the boundary** (use case entry, HTTP handler, event consumer) — not inside domain methods.
- **Pass context through** all downstream calls (repositories, gateways, sub-use-cases) by relying on the OTel context propagation — do not thread span objects manually.
- **End the span in a `finally`** block (or via context manager) so it always closes, even on exceptions.
- **Minimum span attributes:** `operation` (qualified name of the use case or handler), `correlation_id`; span status is set via `set_status(StatusCode.OK/ERROR)`, not as a custom attribute.
- **Create child spans** for sub-operations that are independently meaningful for latency analysis (e.g. a DB query that could be slow, an outbound HTTP call, an event publish step). Do not create child spans for trivial in-process calls.

## Detect & conform

Find the repo's logging gateway and telemetry stack — a structured logger, an injected
`LoggerGateway`/`useLogger`, OpenTelemetry, a Prometheus client, Loki/Tempo exporters — and use it.
Never stand up a parallel logging mechanism alongside the existing one.

## Instrumented decorator pattern

When you need to add observability to an existing gateway or adapter without modifying it, wrap it
with an instrumented decorator that measures and records:

```python
# infrastructure/gateways/instrumented_payment_gateway.py
import time

class InstrumentedPaymentGateway(PaymentGateway):
    def __init__(self, inner: PaymentGateway, metrics: MetricaGateway, logger: LoggerGateway) -> None:
        self._inner = inner
        self._metrics = metrics
        self._logger = logger

    async def charge(self, amount: Decimal, account_id: UUID) -> ChargeResult:
        start = time.perf_counter()
        try:
            result = await self._inner.charge(amount, account_id)
            elapsed = time.perf_counter() - start
            self._metrics.observar_histograma(
                "payment.charge.duration_seconds",
                elapsed,
                labels={"status": "success"},
            )
            return result
        except Exception as exc:
            elapsed = time.perf_counter() - start
            self._metrics.observar_histograma(
                "payment.charge.duration_seconds",
                elapsed,
                labels={"status": "error"},
            )
            self._logger.erro("payment.charge.falhou", context={"account_id": str(account_id)})
            raise
```

Wire via the DI factory:
```python
def create_payment_gateway(metrics: MetricaGateway, logger: LoggerGateway) -> PaymentGateway:
    inner = StripePaymentGateway(api_key=settings.STRIPE_API_KEY)
    return InstrumentedPaymentGateway(inner, metrics=metrics, logger=logger)
```

Benefits: the inner gateway stays clean; observability is a cross-cutting concern applied in the
factory layer; the interface is unchanged so consumers and tests need no modification.

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

- [ ] Grep the change for raw `print`/`console.log`/stdout writes — there must be none.
- [ ] Does the new code log its lifecycle with structured context, emit the required metric, and propagate the correlation id?
- [ ] No PII/secret in any log line.
- [ ] Is a correlation ID generated at the boundary and passed through all downstream calls?
- [ ] If a new gateway was introduced, is it wrapped with an instrumented decorator (or does the gateway itself emit metrics)?
- [ ] Are log levels correct? (`erro`/`error` only for actionable failures; `aviso`/`warn` for recoverable; `info` for lifecycle; `debug` for detail — not `erro` for expected conditions like 'not found'.)
- [ ] Does the new endpoint/handler create a span and propagate trace context to downstream calls?
