# Cache Patterns

When and how to cache — key design, invalidation, warmup, serialization, and tenant isolation.
Cache is an optimization with a correctness surface: stale data, cache-aside races, and key
collisions are real bugs. Apply patterns consistently; a deviation is a defect. **These are rules,
not suggestions — a deviation is a defect to fix, not a style choice.**

## Contents
- The universal rules
- Cache-Aside pattern
- Key design conventions
- Invalidation strategies
- Proactive warmup
- Atomic operations
- Stampede prevention
- Bulk / pipeline operations
- Serialization safety
- Multi-tenant cache keys
- Feature flags for cache
- How to verify

## The universal rules

1. **Cache-Aside is the default.** Read: check cache → hit: return cached; miss: load from source,
   write to cache, return. Write: write to source of truth first, then invalidate (or update) cache.
   Never write cache-first.
2. **Cache is an optimization, not a source of truth.** Every cached value must be reconstructable
   from the canonical source. Cache outage → cache miss → source load; never data loss.
3. **Explicit TTL on every key.** A key without TTL is a silent memory leak. TTL is a last-resort
   safety net, not the primary invalidation strategy.
4. **Invalidate by domain event.** When the domain fact changes (entity updated/deleted), publish a
   domain event; the cache layer subscribes and invalidates. TTL-only invalidation is a consistency
   bet you will eventually lose.
5. **Keys are namespaced, not arbitrary strings.** Namespaced keys prevent collisions, make
   `SCAN/KEYS` patterns safe, and enable batch invalidation.
6. **Serialize to JSON, not binary.** JSON is debuggable, portable, and doesn't create format
   migration nightmares. Handle special types explicitly (UUID → str, Decimal → str, datetime → ISO 8601).
7. **Never cache PII in a shared layer.** User-specific sensitive data must be scoped to the user's
   key and TTL-bounded. When in doubt, don't cache it (cross-link `anti-regression.md`).

## Cache-Aside pattern

```
READ path
─────────────────────────────────────────────────────────────────────
key = build_key(entity_id, variant)
cached = await cache.get(key)
if cached is not None:
    return deserialize(cached)                   # ← cache hit

value = await source.load(entity_id, variant)    # ← cache miss: load
await cache.set(key, serialize(value), ttl=TTL)  # ← populate
return value

WRITE / DELETE path
─────────────────────────────────────────────────────────────────────
await source.save(entity)                        # ← write source FIRST
await cache.delete(build_key(entity.id, variant))  # ← then invalidate
# OR: await cache.set(key, serialize(entity), ttl=TTL) if eager refresh is preferred
```

**Pattern guard**: surround the cache interaction with a try/except (or feature flag). A Redis
outage must degrade to slower responses, not errors. Do not let cache errors surface to callers.

```python
async def get(self, entity_id: UUID) -> Entity:
    if self._cache_enabled:
        try:
            cached = await self._cache.get(self._key(entity_id))
            if cached is not None:
                return self._deserialize(cached)
        except CacheError:
            self._logger.aviso("cache.get.falhou", context={"entity_id": str(entity_id)})
    return await self._source.get(entity_id)
```

## Key design conventions

Use a hierarchical namespace that mirrors the domain. Pattern:

```
{service}:{domain}:{entity_type}:{entity_id}:{aspect}:{variant}
```

Concrete examples:
```
auth:refresh_token:{jti}
auth:token_family:{family_id}
auth:user_tokens:{user_id}
reports:perspectiva:{perspectiva_code}:batch:{tenant_id}:{year}:{month}
catalog:product:{product_id}:price:{currency}
```

Rules:
- Use `:` as separator — safe in Redis, readable in logs.
- Leading namespace (`auth:`, `reports:`) enables bulk scan per service.
- Tenant ID in the key is mandatory for multi-tenant systems (see §Multi-tenant cache keys).
- Keep keys short for performance and readability; excessively long keys waste memory and slow comparisons. Avoid embedding full UUIDs in high-cardinality segments when a shorter stable ID exists.
- Document key schemas alongside the code that creates them — key conventions rot silently.

## Invalidation strategies

| Strategy | When to use | Risk |
|---|---|---|
| **Event-driven** | Domain fact changes (entity updated/deleted) | Requires event infrastructure |
| **TTL-only** | Read-mostly, stale-ok, no events | Silent staleness up to TTL |
| **Write-through** | High read:write ratio, consistency required | Write latency increases (every write hits both cache and source); cache pollution if many written keys are rarely read |
| **Scan + delete by pattern** | Bulk invalidation (e.g. all keys for a tenant) | `SCAN` is O(N) — use sparingly |

Combine strategies: event-driven invalidation + TTL as safety net.

**Pattern — invalidate by domain event:**
```python
async def on_entity_deleted(self, entity_id: UUID) -> None:
    # Scan + delete all variants for this entity
    async for key in self._cache.scan_iter(match=f"reports:entity:*:{entity_id}:*"):
        await self._cache.delete(key)
```

Use `SCAN` with `match=` pattern — never `KEYS *` in production (blocks the Redis event loop).

## Proactive warmup

When the cache for a critical entity is cold (first request after restart, after invalidation),
consider a proactive warmup step triggered by the same domain event that invalidated:

```
on_entity_activated(entity_id):
  → invalidate old keys
  → schedule async warmup: load top variants from source → populate cache
```

Trade-off: warmup is faster for users; warmup failures silently abort (do not error the event
handler). Log warmup failures; the system degrades to cache-miss behavior, which is acceptable.

## Atomic operations

Prevent race conditions on write:

```redis
SET key value NX EX 3600   # SET if Not eXists — atomic; safe concurrent insertion
INCR counter               # Atomic increment — safe for rate limiting / quota
```

Python (redis.asyncio):
```python
result = await cache.set(key, value, nx=True, ex=ttl)
if not result:
    # Key already exists — concurrent writer won; that's correct
    pass
```

Use pipelines (`async with cache.pipeline() as pipe`) for multi-key reads/writes to reduce
round-trips. Keep pipeline batches under ~1000 keys to avoid blocking Redis for long operations.

## Stampede prevention

**The problem:** When a popular cache key expires, many concurrent requests all experience a miss
simultaneously and all race to load from the origin — a cache stampede (also called dog-piling).
The result is a sudden burst of expensive DB or API calls that the cache was meant to absorb.

**The solution:** Use a distributed lock so that only one caller populates the cache while others
either wait briefly or return a slightly stale value. The simplest pattern is a SET NX lock key:

```python
lock_key = f'lock:{key}'
if await cache.set(lock_key, '1', nx=True, ex=5):
    value = await source.load(entity_id)
    await cache.set(key, serialize(value), ex=TTL)
    await cache.delete(lock_key)
    return value
else:
    # another caller is populating; fall back to source load (avoids hard lock dependency)
    return await source.load(entity_id)
```

Rules:
- The lock TTL (`ex=5`) must be long enough to cover the expected maximum load time (plus a safety margin), so the lock does not expire before the writer finishes. A finite lock TTL is what prevents permanent lock-out if a writer crashes.
- The `else` branch is a fallback, not an error — it avoids a hard dependency on the lock.
- An alternative is **probabilistic early expiration**: before the TTL expires, a small fraction of
  requests proactively refresh the cache, eliminating the stampede window without a lock.

## Bulk / pipeline operations

```python
# ✗ N individual round-trips
for key in keys:
    value = await cache.get(key)

# ✓ 1 round-trip via pipeline
async with cache.pipeline() as pipe:
    for key in keys:
        pipe.get(key)
    values = await pipe.execute()
```

Pattern for bulk token revocation:
```python
async with cache.pipeline() as pipe:
    for token_key in token_keys:
        pipe.delete(token_key)
    await pipe.execute()
```

## Serialization safety

```python
import json
from decimal import Decimal
from uuid import UUID
from datetime import datetime

def _serialize(value: Any) -> str:
    return json.dumps(value, default=_json_default)

def _json_default(obj: Any) -> Any:
    if isinstance(obj, UUID):
        return str(obj)
    if isinstance(obj, Decimal):
        if not obj.is_finite():
            raise ValueError(f"Non-finite Decimal not serializable: {obj}")
        return str(obj)  # use str, not float — preserves precision
    if isinstance(obj, datetime):
        return obj.isoformat()
    raise TypeError(f"Object of type {type(obj)} is not JSON serializable")
```

Never use `pickle` for cache: Python-version-locked, opaque to debugging, and a code execution
vector if the cache backend is shared. Always serialize to JSON.

## Multi-tenant cache keys

When the system has tenants (organizations, accounts, municipalities), the tenant ID **must** appear
in the cache key to prevent cross-tenant data leakage:

```
reports:{tenant_id}:{resource_type}:{resource_id}:{variant}
```

Bulk invalidation when tenant is deactivated or deleted:
```python
async for key in cache.scan_iter(match=f"reports:{tenant_id}:*"):
    await cache.delete(key)
```

Never cache data shared across tenants alongside tenant-specific data. Separate the key namespaces:
- `shared:catalog:product:{id}` — cross-tenant
- `tenant:{id}:cart:{cart_id}` — per-tenant

## Feature flags for cache

Gate cache behavior at runtime to enable/disable without a deployment:

```python
class CachedEntityRepository(EntityRepository):
    def __init__(self, source: EntityRepository, cache: CacheClient, settings: Settings) -> None:
        self._source = source
        self._cache = cache
        self._enabled = settings.FEATURE_ENTITY_CACHE_ENABLED
        self._ttl = settings.FEATURE_ENTITY_CACHE_TTL_SECONDS

    async def get(self, entity_id: UUID) -> Entity:
        if not self._enabled:
            return await self._source.get(entity_id)
        # ... cache-aside logic
```

Feature flag settings live in the infrastructure settings class (Pydantic BaseSettings, env var
backed). Expose the flag status via a health/config endpoint so mobile/client apps can adapt.

## How to verify

- [ ] Is every cached key namespaced? Does the namespace include the tenant ID when the system is multi-tenant?
- [ ] Does every `SET` have a TTL? Are there any keys without expiry?
- [ ] Is cache invalidated on write (event or explicit delete), not only by TTL?
- [ ] Does cache failure degrade gracefully (miss → source load) rather than propagating as an error?
- [ ] Is `SCAN` used instead of `KEYS` for pattern matching?
- [ ] Is JSON used for serialization? Are Decimal/UUID/datetime handled explicitly?
- [ ] Is `pickle` absent from cache paths?
- [ ] Are multi-key operations batched via pipeline?
- [ ] Is the cache feature flag respected? Does the flag live in infrastructure settings?
- [ ] For high-traffic keys, is there a stampede prevention mechanism (SET NX lock or probabilistic early expiration)?
