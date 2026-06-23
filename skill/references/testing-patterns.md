# Testing Patterns

How to structure tests so they are fast, faithful, and maintainable. The test suite is the
executable spec; a test that doesn't run, doesn't isolate, or mocks the wrong thing is a false
promise. **These are rules, not suggestions — a deviation is a defect to fix, not a style choice.**

## Contents
- The universal rules
- The test pyramid
- Fake vs Mock
- Null Object pattern
- Test setup: env before imports
- Integration tests: require-or-skip
- E2E tests: full app via factory
- Negative assertions
- Testing domain events
- Factory fixtures for domain objects
- Python
- TypeScript
- How to verify

## The universal rules

1. **Tests verify behavior, not implementation.** Test the observable outcome (return value,
   emitted event, persisted state, HTTP response) — not the sequence of method calls. A test that
   breaks every time you rename a private method is testing the wrong thing.
2. **Fakes over Mocks.** Fakes are in-memory implementations of domain interfaces; Mocks intercept
   calls. Fakes fail when the interface changes, catching regressions. Mocks often pass when the
   real behavior would fail. Use Mocks only when neither a Null Object nor an accumulating Fake is practical — in practice this is rare. For observability collaborators (logging, metrics) use a Null Object when you do not care about the effect, and an accumulating Fake (e.g. FakeLogger with `.records`) when you need to assert what was emitted.
3. **One test, one reason to fail.** A test that asserts five unrelated things produces ambiguous
   failure messages. If two things must both be true to satisfy an acceptance criterion, that's fine
   — but each test should have a single conceptual assertion.
4. **Tests are deterministic.** UTC timestamps, fixed seeds, no sleep, no network. A flaky test is
   a bug that must be fixed before merging.
5. **Never test private methods directly.** Exercise them through the public surface. Private
   methods exist because the public API needs them; the test that covers the public API also covers
   them.
6. **Infrastructure tests require infrastructure.** Unit tests use Fakes; integration tests use the
   real DB/queue/cache but skip gracefully if the infrastructure is unavailable (see §Require-or-skip).

## The test pyramid

```
            ┌───────────────┐
            │  E2E / smoke  │  Few, slow — full app via factory; golden path + critical edges
            ├───────────────┤
            │  Integration  │  Moderate — real DB/queue/cache; skip if env var absent
            ├───────────────┤
            │  Unit         │  Many, fast — Fakes; no I/O; pure logic + use cases
            └───────────────┘
```

Invest in unit tests; keep integration tests focused on persistence contracts; keep E2E tests to
the golden path and critical security scenarios. A pyramid that's inverted (many slow E2E, few unit)
is a finding — the cost of the test suite crushes iteration speed.

## Fake vs Mock

A Fake is an in-memory implementation of the domain interface:

```python
# ✓ Fake — implements the interface, stores state, fails on interface change
class FakeOrderRepository(OrderRepository):
    def __init__(self) -> None:
        self._store: dict[UUID, Order] = {}

    async def get_by_id(self, order_id: UUID) -> Order:
        if order_id not in self._store:
            raise OrderNotFoundError(order_id=order_id)
        return self._store[order_id]

    async def save(self, order: Order) -> Order:
        self._store[order.id] = order
        return order

    async def list_by_account(self, account_id: UUID, *, include_cancelled: bool = False) -> list[Order]:
        return [o for o in self._store.values()
                if o.account_id == account_id
                and (include_cancelled or o.status != OrderStatus.CANCELLED)]

# ✗ Mock — call-recording shell; passes even when interface changes
from unittest.mock import AsyncMock
repo = AsyncMock(spec=OrderRepository)
repo.get_by_id.return_value = some_order
```

Use Fakes as shared `conftest.py` fixtures, reused across all unit tests in the module.
A Fake that accumulates internal state (logs, published events) enables **negative assertions**:
```python
class FakeLogger(LoggerGateway):
    def __init__(self) -> None:
        self.records: list[dict] = []

    def debug(self, event: str, *, context: dict | None = None) -> None:
        self.records.append({"level": "debug", "event": event, "context": context or {}})

    def info(self, event: str, *, context: dict | None = None) -> None:
        self.records.append({"level": "info", "event": event, "context": context or {}})

    def aviso(self, event: str, *, context: dict | None = None) -> None:
        self.records.append({"level": "aviso", "event": event, "context": context or {}})

    def erro(self, event: str, *, context: dict | None = None) -> None:
        self.records.append({"level": "erro", "event": event, "context": context or {}})

    def exception(self, event: str, *, context: dict | None = None) -> None:
        self.records.append({"level": "exception", "event": event, "context": context or {}})
```

## Null Object pattern

Use the **Null Object** for dependencies whose side effects don't matter in a given test —
observability (logging, metrics), audit sinks, notification gateways:

```python
class NullLoggerGateway(LoggerGateway):
    def debug(self, *_, **__) -> None: pass
    def info(self, *_, **__) -> None: pass
    def aviso(self, *_, **__) -> None: pass
    def erro(self, *_, **__) -> None: pass
    def exception(self, *_, **__) -> None: pass

class NullMetricaGateway(MetricaGateway):
    def incrementar_contador(self, *_, **__) -> None: pass
    def observar_histograma(self, *_, **__) -> None: pass
    def definir_gauge(self, *_, **__) -> None: pass
```

Null Objects differ from Mocks: they don't record calls and don't raise if unused. They're silent
collaborators. Use them when you don't care about the effect; use a Fake when you do.

## Test setup: env before imports

Settings classes (Pydantic BaseSettings, Django settings, dotenv loaders) read env vars **at import
time**. Set every required env var before importing the project:

```python
# tests/conftest.py — TOP of file, before any project imports
import os
os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost/test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-not-production")
os.environ.setdefault("CACHE_URL", "redis://localhost:6379/1")
os.environ.setdefault("ENVIRONMENT", "test")

# Only after env vars are set:
from myapp.settings import config_settings   # noqa: E402 (import not at top by design)
```

Why: if `config_settings = ConfigSettings()` runs at import time and `JWT_SECRET_KEY` is absent, the
validator raises before the test even starts. Setting defaults at the top of conftest prevents
`ValidationError` cascades on import.

## Integration tests: require-or-skip

Integration tests that need a real database, cache, or message broker must skip gracefully when the
infrastructure is unavailable — not fail with a connection error:

```python
# tests/integration/conftest.py
import os
import pytest

DATABASE_URL = os.getenv("DATABASE_URL_TEST")

if not DATABASE_URL:
    pytest.skip(
        "Set DATABASE_URL_TEST to run integration tests",
        allow_module_level=True,
    )

@pytest.fixture(scope="session")
async def db_client():
    client = await DatabaseClient.connect(DATABASE_URL)
    yield client
    await client.close()
```

CI always sets `DATABASE_URL_TEST`; local dev skips by default. Mark integration tests explicitly:
```python
@pytest.mark.integration
async def test_order_persists_to_db(...):
    ...
```

## E2E tests: full app via factory

E2E tests use the real app instantiated through its factory function — not a mocked substitute:

```python
# tests/e2e/conftest.py
import pytest
from httpx import AsyncClient, ASGITransport
from myapp.interfaces.http.main import create_app

@pytest.fixture
def app():
    return create_app()

@pytest.fixture
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
```

E2E tests cover:
- The golden path (happy path for the most critical feature)
- Authentication boundaries (unauthenticated → 401, wrong role → 403)
- Validation failures (malformed input → 422 with the canonical error body)

E2E tests do **not** cover every business rule — that's unit and integration territory.

## Negative assertions

Security, privacy, and compliance requirements often manifest as "this must NOT appear" — test them
explicitly. A test that only asserts what should happen misses the constraint.

```python
async def test_login_does_not_log_password(client, fake_logger):
    credentials = {"email": "user@example.com", "password": "s3cr3t"}
    await client.post("/auth/login", json=credentials)

    logged_text = str(fake_logger.records)
    assert "s3cr3t" not in logged_text           # password must not appear in any log
    assert "user@example.com" not in logged_text  # email must not appear in error logs

async def test_error_response_does_not_leak_stack_trace(client):
    response = await client.get("/orders/nonexistent-id")
    body = response.json()
    assert "Traceback" not in str(body)
    assert "psycopg" not in str(body)            # DB driver name must not leak
```

## Testing domain events

Domain operations append events to the aggregate's `_events` list. The use case then calls
`collect_events()` and publishes them. Tests must verify both the aggregate's events and the
gateway's published events.

Use a **FakeEventGateway** that accumulates published events, and assert event types and payloads:

```python
class FakeEventGateway(EventGateway):
    def __init__(self) -> None:
        self.published: list[DomainEvent] = []

    async def publish(self, events: list[DomainEvent]) -> None:
        self.published.extend(events)

async def test_place_order_emits_order_placed_event():
    fake_events = FakeEventGateway()
    use_case = PlaceOrderUseCase(repo=FakeOrderRepository(), events=fake_events)
    await use_case.execute(account_id=uuid4(), total=Decimal('100.00'))
    assert len(fake_events.published) == 1
    event = fake_events.published[0]
    assert isinstance(event, OrderPlacedEvent)
    assert event.total == Decimal('100.00')
```

Pattern: **arrange → execute → collect events → assert**. You can also call `collect_events()`
directly on the aggregate returned by a Fake repository to assert which events were appended before
the use case published them.

## Factory fixtures for domain objects

Create domain objects via factory functions in fixtures, not ad-hoc inline construction:

```python
# tests/conftest.py
import pytest
from myapp.domain.entities.order.order import Order
from myapp.domain.value_objects.order.order_status import OrderStatus

def make_order(
    *,
    account_id: UUID | None = None,
    total: Decimal = Decimal("100.00"),
    status: OrderStatus = OrderStatus.OPEN,
) -> Order:
    # Use the entity's `reconstruct()` classmethod (not the plain constructor) — consistent with ddd-patterns.md Factory methods.
    return Order.reconstruct(
        id=uuid4(),
        account_id=account_id or uuid4(),
        status=status,
        total=total,
    )

@pytest.fixture
def open_order():
    return make_order()

@pytest.fixture
def cancelled_order():
    return make_order(status=OrderStatus.CANCELLED)
```

Benefits: tests express intent (`cancelled_order`, not `Order(id=..., status=CANCELLED, ...)`),
and when the entity gains a new required field, one factory change fixes all tests.

## Python

- conftest.py lives at `tests/`, `tests/unit/`, `tests/integration/` — coarse shared fixtures at root,
  fine fixtures at the relevant sub-layer.
- Fakes as module-level fixtures in `tests/conftest.py`; return fresh instances so tests don't share
  state.
- `pytest.mark.asyncio` (or `asyncio_mode = "auto"` in `pytest.ini`) for async test functions.
- `@pytest.fixture(scope="session")` for expensive infra (DB client); `scope="function"` for any
  fixture that carries state between tests.

```ini
# pyproject.toml
[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
```

## TypeScript

- Vitest + `vi.fn()` for mocks when truly needed; prefer in-memory service classes as Fakes.
- `describe/it` grouping mirrors the feature folder structure.
- `beforeEach` resets shared state — never depend on test-run order.
- `supertest` / `@testing-library/react` for E2E / component tests.

## How to verify

- [ ] Do all unit tests use Fakes (not Mocks) for domain interface collaborators?
- [ ] Is there a Null Object for logging and metrics so tests are silent by default?
- [ ] Are env vars set before any project import in conftest?
- [ ] Do integration tests skip gracefully when infra env var is absent?
- [ ] Do E2E tests instantiate the app via `create_app()` / factory function?
- [ ] Do tests covering security/privacy include negative assertions for PII and internal details?
- [ ] Are domain objects constructed via make_* factory functions, not raw constructors?
- [ ] Is there any Fake that shares mutable state between tests? (scope should be "function")
- [ ] Is there at least one test that calls collect_events() (or asserts via FakeEventGateway) after a domain operation to verify which events were emitted?
