# Scale & Performance Patterns

Patterns that make systems behave well under load: async I/O, concurrency limits, retry strategies,
connection pooling, pagination, batch operations, feature flags, and multi-tenancy. Apply these from
the first feature; retrofitting is always harder. **These are rules, not suggestions — a deviation
is a defect to fix, not a style choice.**

## Contents
- The universal rules
- Async-first
- Concurrency control
- Retry with exponential backoff + jitter
- Idempotency
- Connection pooling
- Pagination
- Batch / bulk operations
- Feature flags
- Multi-tenancy patterns
- How to verify

## The universal rules

1. **Async-first for I/O.** Every call that blocks on the network or disk must be awaited. A
   synchronous DB call inside an async handler blocks the event loop — every other request waits.
2. **Bound concurrency explicitly.** Unbounded parallelism (`asyncio.gather` over 10 000 items)
   exhausts connections and memory. Always limit with a Semaphore or a bounded worker pool.
3. **Classify errors before retrying.** Not all failures are transient. Retrying a conflict (409)
   or a permission error (403) wastes resources and produces duplicate side-effects. Retry only
   infrastructure errors: timeouts, connection drops, throttle responses.
4. **Measure before optimizing.** Add a cache, batch, or index only when there is a measured
   problem. Premature optimization adds complexity that obscures correctness. Instrument first
   ([observability.md](observability.md)), optimize second.
5. **One source of truth for config.** Feature flags, page sizes, pool sizes, TTLs — all live in
   the infrastructure settings class (Pydantic BaseSettings or equivalent). Never hardcode in
   domain or use-case logic.
6. **Tenant isolation is non-negotiable.** In a multi-tenant system, every query, cache key, and
   background job must be scoped to the tenant. A cross-tenant data leak is a security incident,
   not a bug.

## Async-first

```python
# ✗ Synchronous — blocks event loop
def get_order(self, order_id: UUID) -> Order:
    conn = psycopg.connect(...)
    ...

# ✓ Async — non-blocking
async def get_order(self, order_id: UUID) -> Order:
    async with self._pool.connection() as conn:
        ...
```

Async applies to: DB queries, HTTP calls to external services, message broker operations, cache
reads/writes, file I/O on slow storage. Local CPU computation (parsing, hashing, sorting in memory)
does not need async and should not introduce artificial `await asyncio.sleep(0)` yields.

When integrating a synchronous library in an async context, run it in a thread pool executor to
avoid blocking the loop:
```python
result = await asyncio.get_running_loop().run_in_executor(None, sync_function, arg)
```

## Concurrency control

Limit parallel I/O operations with a Semaphore:

```python
class DiscoverChangesUseCase:
    def __init__(self, ..., max_concurrency: int = 10) -> None:
        self._semaphore = asyncio.Semaphore(max_concurrency)

    async def _process_tenant(self, tenant_id: UUID) -> Result:
        async with self._semaphore:
            return await self._source.load(tenant_id)

    async def execute(self, tenant_ids: list[UUID]) -> list[Result]:
        tasks = [self._process_tenant(t) for t in tenant_ids]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        output = []
        for tenant_id, result in zip(tenant_ids, results):
            if isinstance(result, Exception):
                self._logger.erro(
                    "discover_changes.tenant.falhou",
                    context={"tenant_id": str(tenant_id), "error": str(result)},
                )
            else:
                output.append(result)
        return output
```

Rules:
- `max_concurrency` is a settings value — tunable without a deployment.
- `gather(return_exceptions=True)` — one failure doesn't abort the batch; log and continue.
- Log each exception with context (which tenant, which operation) before discarding.
- A correlation ID generated at the batch level propagates to each per-tenant task
  ([observability.md](observability.md)).

## Retry with exponential backoff + jitter

```python
import asyncio
import random
from typing import Any

RETRYABLE = (TimeoutError, ConnectionError, OperationalError)

async def with_retry(fn, *, max_attempts: int = 3, base_delay: float = 0.5, logger: LoggerGateway | None = None) -> Any:
    for attempt in range(max_attempts):
        try:
            return await fn()
        except RETRYABLE as exc:
            if attempt == max_attempts - 1:
                raise
            delay = base_delay * (2 ** attempt)
            jitter = random.uniform(0, delay)
            await asyncio.sleep(delay + jitter)
            if logger:
                logger.aviso("retry.tentativa", context={"attempt": attempt + 1, "error": str(exc)})
```

Why jitter: without it, all concurrent retriers wake at the same moment and produce a thundering
herd. Jitter spreads them out.

Classify errors before applying retry:

| Error class | Action |
|---|---|
| Connection drop, timeout, pool exhaustion | Retry with backoff |
| Conflict (409), resource locked | **Do not retry** — deterministic; use idempotency keys instead |
| Not found (404), validation (422), auth (401/403) | **Do not retry** — deterministic failure |
| Corrupt / undeserializable message | **Drop** (TERM/dead-letter) — retrying makes it worse |

For message broker consumers (NATS / SQS / Kafka), the classification maps to ACK/NAK/TERM:
```
BusinessError          → ACK  (handled; don't redeliver)
InfrastructureError    → NAK  (transient; retry with backoff)
Corrupt/parse failure  → TERM (dead-letter; never redeliver)
```

## Idempotency

An operation is **idempotent** if calling it N times produces the same result as calling it once.
Idempotency is a prerequisite for safe retries: if a retry might re-execute the operation, the
operation must tolerate being run more than once without creating duplicate side-effects.

### Idempotency key pattern (HTTP endpoints)

The client generates a unique key (e.g. a UUID) and sends it in a header (`Idempotency-Key`). The
server stores the response keyed by it after the first successful execution; on a duplicate request
with the same key, it returns the cached response without re-executing the operation.

### UPSERT for DB writes

Use `INSERT … ON CONFLICT` instead of `INSERT` + catching a duplicate-key exception:

```python
# DB upsert — safe to retry
await cur.execute(
    '''
    INSERT INTO orders (id, account_id, total, status)
    VALUES (%s, %s, %s, %s)
    ON CONFLICT (id) DO UPDATE
      SET status = EXCLUDED.status
    RETURNING *
    ''',
    (order.id, order.account_id, order.total, order.status.value),
)
```

`DO NOTHING` is correct when you only need to prevent the duplicate error and don't need to update.

### Deduplication for message consumers

Message brokers guarantee at-least-once delivery. Consumers must deduplicate:
- Maintain a `processed_events` table (or a Redis set) keyed by the event/message ID.
- Before processing, check if the ID is already present; if so, ACK and skip.
- After processing, record the ID atomically with the side-effect (same DB transaction when
  possible).

## Connection pooling

```python
pool = AsyncConnectionPool(
    conninfo=DATABASE_URL,
    min_size=settings.DB_POOL_MIN_SIZE,     # keep N connections always ready
    max_size=settings.DB_POOL_MAX_SIZE,     # never exceed M concurrent connections
    max_idle=settings.DB_POOL_MAX_IDLE,     # close connections idle longer than N seconds
    max_lifetime=settings.DB_POOL_MAX_LIFETIME,  # replace connections older than N seconds
)
```

Health check pattern — send a lightweight `SELECT 1` before returning a connection from the pool.
Necessary when a proxy (PgBouncer, RDS Proxy) silently closes idle connections:

```python
async def _check_connection(conn) -> None:
    try:
        await conn.execute("SELECT 1")
    except Exception:
        raise  # pool discards this connection and opens a new one
```

When behind a connection pooler in transaction mode (PgBouncer):
- Disable prepared statements — they are session-scoped and break under transaction-mode proxying.
- Do not use `LISTEN/NOTIFY` — the session is shared.

Pool sizing rule of thumb: `max_size ≤ (DB max_connections / number_of_app_instances) * 0.8`.
A pool that's too large starves other app instances; a pool that's too small queues requests.
Make pool sizes settings-configurable; tune per environment.

## Pagination

Standard paginated response shape:

```python
@dataclass
class PaginatedResponse(Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int
    total_pages: int
```

SQL pattern:
```sql
SELECT * FROM orders WHERE account_id = $1
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;

SELECT COUNT(*) FROM orders WHERE account_id = $1;
```

Or cursor-based for high-cardinality tables:
```sql
SELECT * FROM orders WHERE account_id = $1 AND id > $2
ORDER BY id
LIMIT $3;
```

Rules:
- `page_size` is a settings constant (default) plus an optional user override bounded to `[1, MAX_PAGE_SIZE]`.
- Never return unbounded lists in a public API — a missing `LIMIT` is an O(N) query waiting to happen.
- Cursor-based pagination is preferable for real-time feeds (events, activity logs) where offset
  pagination produces inconsistent results under concurrent writes.
- `total_pages = ceil(total / page_size)` — compute server-side; clients should not re-derive.

## Batch / bulk operations

When processing N items, batch the I/O:

```python
# ✗ N individual queries — O(N) round trips
for item_id in item_ids:
    item = await repo.get(item_id)
    results.append(process(item))

# ✓ Batch load — O(1) round trips
items = await repo.get_many(item_ids)
results = [process(item) for item in items]
```

SQL bulk insert with `COPY` or `INSERT … VALUES ($1,$2),($3,$4),…`:
```python
async with conn.copy("COPY orders (id, account_id, total) FROM STDIN") as copy:
    for order in orders:
        await copy.write_row((str(order.id), str(order.account_id), str(order.total)))
```

Redis pipeline (see [cache-patterns.md](cache-patterns.md)):
```python
async with cache.pipeline() as pipe:
    for key in keys:
        pipe.delete(key)
    await pipe.execute()
```

Batch sizing: keep batches large enough to amortize round-trip overhead but small enough to avoid
lock contention and memory pressure. 100–1000 rows per batch is a reasonable starting range; tune
with measurement.

## Feature flags

Runtime configuration for progressive rollout, A/B testing, and circuit-breaker-style kill switches:

```python
class AppSettings(BaseSettings):
    FEATURE_CACHE_ENABLED: bool = True
    FEATURE_CACHE_TTL_SECONDS: int = 300
    FEATURE_NEW_ALGORITHM_ENABLED: bool = False
    PAGINATION_DEFAULT_PAGE_SIZE: int = 20
    PAGINATION_MAX_PAGE_SIZE: int = 100
    DB_POOL_MIN_SIZE: int = 2
    DB_POOL_MAX_SIZE: int = 10

config = AppSettings()
```

Rules:
- Feature flags live in infrastructure settings — never in domain or application layers.
- Flags are read once at startup and injected; do not call `os.getenv()` inside business logic.
- Expose current flag values via a health/config endpoint so observability tools and clients can
  see the runtime state without a deployment.
- When a flag reaches 100% rollout, schedule its removal — a flag graveyard rots code.

## Multi-tenancy patterns

### Tenant identity

A tenant is the top-level isolation boundary (organization, account, municipality). Establish:
- How the tenant is identified: a header (`X-Tenant-Id`), a subdomain, a JWT claim, or a
  path prefix (`/tenants/{id}/`).
- How it is validated: extracted and verified in middleware, before reaching business logic.
- How it propagates: as an explicit parameter through all use cases and repositories — never as a
  thread-local or implicit ambient context. An explicit parameter is visible in every call site and
  testable without faking global state.

```python
# ✓ Explicit propagation — visible, testable
async def get_orders(self, *, tenant_id: UUID, page: int, page_size: int) -> PaginatedResponse[Order]:
    ...

# ✗ Implicit ambient context — hidden dependency, test trap
async def get_orders(self, *, page: int, page_size: int) -> PaginatedResponse[Order]:
    tenant_id = TenantContext.current()  # where does this come from in a test?
    ...
```

### Tenant isolation at the DB level

Options in order of strength:

| Strategy | Isolation | Complexity |
|---|---|---|
| **Separate DB per tenant** | Maximum | High (connection routing, migrations) |
| **Separate schema per tenant** | Strong | Medium (`SET search_path` per connection) |
| **Shared tables, `tenant_id` column + RLS** | Medium | Low–Medium (row-level security) |
| **Shared tables, `tenant_id` column, app-enforced** | Weak | Low (easy to forget a WHERE) |
| **Partition by tenant** | Medium + perf | Medium (partition key in PK) |

Choose the strategy at project inception; changing it later is a full schema migration. Document
the choice in an ADR.

### Tenant isolation in cache

Every cache key that carries tenant data must include the tenant ID (see
[cache-patterns.md](cache-patterns.md)). Bulk invalidation on tenant deactivation/deletion must
cover all key namespaces.

### Tenant isolation in background jobs

Workers that process events or scheduled tasks must:
1. Extract the tenant ID from the event payload or job parameters.
2. Scope every query and cache operation to that tenant.
3. Never process items for multiple tenants in a single DB transaction.

## How to verify

- [ ] Are all I/O operations awaited? Any synchronous DB/HTTP call inside an async handler?
- [ ] Is parallel fan-out bounded by a Semaphore or bounded pool?
- [ ] Does retry logic classify errors before retrying? Is `max_attempts` and backoff configurable?
- [ ] Are pool min/max sizes, TTLs, and page sizes in settings (not hardcoded)?
- [ ] Does every list endpoint paginate? Is there a `LIMIT` on every unbounded query?
- [ ] Are N-item loops replaced with batch operations where feasible?
- [ ] Do feature flags live in infrastructure settings? Are they exposed via config endpoint?
- [ ] Is the tenant ID explicit in every use-case and repository signature?
- [ ] Is every DB query, cache key, and background job scoped to a single tenant?
- [ ] Is the tenant isolation strategy documented in an ADR?
- [ ] Are write operations that may be retried idempotent (UPSERT, deduplication check, or idempotency key)? Is the retry classification table correct — are only idempotent operations retried?
