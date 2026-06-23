# Domain-Driven Design Patterns

How to model the domain in code: entities, value objects, aggregates, domain events, repositories,
and factories. These patterns keep the domain honest — free of infrastructure details, self-enforcing
of invariants, and speaking the language of the business. **These are rules, not suggestions — a
deviation is a defect to fix, not a style choice.**

## Contents
- The universal rules
- Entities vs value objects
- Aggregates
- Rich entities and invariants
- Domain events and the outbox pattern
- Repository pattern
- Factory methods
- Application vs domain services
- Bounded contexts
- Python
- TypeScript
- How to verify

## The universal rules

1. **The domain is infrastructure-free.** `domain/` imports nothing from `infrastructure/` or the
   web framework. No SQL, no HTTP, no ORM, no Pydantic-for-HTTP in domain entities. Detect and
   refuse violations.
2. **Prefer rich entities over anemic ones.** An entity that carries only data and no behavior is a
   symptom of logic leaking into use cases or services. Invariants, state transitions, and derived
   facts live on the entity.
3. **Validate at construction time.** Entities must be born valid. Validate all invariants in
   `__post_init__` (Python dataclass) or the constructor. A method that creates an entity must
   either return a valid one or raise a domain error — never return a half-constructed object.
4. **Value objects are immutable and equality is by value.** Two value objects with the same
   properties are equal. If a value has a business rule (IBGE code must be 7 digits; amount must
   be ≥ 0), enforce it in the value object — not in every caller.
5. **Domain events describe what happened, in the past tense.** `OrderPlacedEvent`, `UserDeactivatedEvent`,
   `InvoiceIssuedEvent`. They are immutable facts. Class names carry the `Event` suffix to distinguish event types from entity types at a glance. Never mutate a domain event after creation.
6. **Repositories are ports, not implementations.** The interface lives in `domain/repositories/`,
   returning domain entities. The adapter (`Postgres*Repository`) lives in `infrastructure/`. The
   domain never sees a cursor, session, or ORM model.
7. **One ubiquitous language.** The names in code match the names the domain experts use (see
   [ubiquitous-language.md](ubiquitous-language.md)). No translation layer between domain speech
   and variable names.

## Entities vs value objects

| Concept | Identity | Mutability | Equality |
|---------|----------|------------|----------|
| **Entity** | Stable unique ID across time | Can change state | By ID |
| **Value Object** | None | Immutable | By all properties |
| **Aggregate root** | ID of the root entity | Root controls change | By root ID |

Decision rule: if two objects with the same property values are interchangeable, it's a value
object. If they are distinct despite identical properties (e.g. two Order line items for the same
product), it's an entity.

Enums are a common form of value object — a closed set of valid values for a domain concept
(`PaymentStatus`, `Esfera`, `UnidadeFederativa`). Keep them in `domain/value_objects/` or
`domain/entities/`, never redeclare in consumers.

## Aggregates

An **aggregate** is a cluster of entities and value objects that is treated as a single unit for
data changes. The rules:

1. **One aggregate root.** The root is the only entity in the cluster that external code holds a
   reference to. External objects never navigate to inner entities directly — they always go through
   the root. This protects the cluster's invariants from being violated by outside code.
2. **All mutations go through the root.** Code that needs to change an inner entity calls a method
   on the root; the root enforces the invariant and delegates internally.
3. **The root enforces invariants that span the cluster.** Any business rule that involves more than
   one entity inside the aggregate lives on the root, not on the inner entities or in the use case.
4. **The root owns the event list.** The `_events` list and the `collect_events()` drain belong to
   the aggregate root. Inner entities do not publish events independently; they signal the root,
   which decides what to record.

See the **'Rich entities and invariants'** section below for a worked example of an aggregate root
(`Order`) that implements these rules.

## Rich entities and invariants

```python
# requires: from datetime import datetime, UTC
# ✗ Anemic — invariant check leaks into use cases
@dataclass
class Order:
    id: UUID
    status: OrderStatus
    total: Decimal

# ✓ Rich — entity owns its invariants and transitions
@dataclass
class Order:
    id: UUID
    account_id: UUID
    status: OrderStatus
    total: Decimal
    _events: list[DomainEvent] = field(default_factory=list, repr=False, compare=False)

    def __post_init__(self) -> None:
        if self.total < Decimal("0"):
            raise NegativeOrderTotalError(total=self.total)
        if not isinstance(self.status, OrderStatus):
            raise InvalidOrderStatusError(status=self.status)

    @classmethod
    def place(cls, *, account_id: UUID, total: Decimal) -> "Order":
        order = cls(id=uuid4(), status=OrderStatus.OPEN, total=total, account_id=account_id)
        order._events.append(OrderPlacedEvent(order_id=order.id, account_id=account_id, total=total, placed_at=datetime.now(UTC)))
        return order

    def cancel(self) -> None:
        if self.status == OrderStatus.CANCELLED:
            raise OrderAlreadyCancelledError(order_id=self.id)
        self.status = OrderStatus.CANCELLED
        self._events.append(OrderCancelledEvent(order_id=self.id))

    def collect_events(self) -> list[DomainEvent]:
        events, self._events = self._events, []
        return events
```

Key observations:
- `__post_init__` guards all invariants on creation — can't construct an invalid entity.
- Named factory method (`place()`) expresses intent; `reconstruct()` is for restoring from DB (see Factory methods section).
- State transitions (`cancel()`) live on the entity and enforce business rules.
- `collect_events()` drains the event list — the use case calls this after the repository persists.

## Domain events and the outbox pattern

Domain events record significant domain occurrences. The **transactional outbox pattern** ensures
events are published reliably by writing them to an outbox table inside the same DB transaction as
the aggregate state change, then a separate relay process reads and publishes them — eliminating the
gap where a publish failure after DB commit would cause permanent event loss.

```
Outbox pattern:
  1. Load aggregate from repository
  2. Call aggregate method (appends event to _events)
  3. Persist aggregate + write events to outbox table (single DB transaction)
  4. A relay/poller reads undelivered rows from the outbox table
  5. Relay publishes each event to the broker (NATS / SNS / Kafka)
  6. On successful publish, mark outbox row as delivered
```

> **Note — direct publish flow (simpler, less reliable):** If your infrastructure does not yet have
> an outbox relay, you may use a direct flow (collect_events() → publish after DB commit). This is
> simpler but leaves a gap: if publish fails after commit, events are permanently lost. Prefer the
> transactional outbox for production event-driven systems.

Invariants:
- Never publish before persisting — a publish-then-crash creates ghost events.
- Never persist without eventually publishing — a persist-without-publish creates silent failures.
- Events are immutable data classes / records; they carry all context needed for consumers.
- Event names are past-tense domain facts: `OrderPlacedEvent`, not `PlaceOrderEvent`.

```python
@dataclass(frozen=True)
class OrderPlacedEvent:
    order_id: UUID
    account_id: UUID
    total: Decimal
    placed_at: datetime
```

## Repository pattern

```python
# domain/repositories/order_repository.py  — the PORT (interface)
from abc import ABC, abstractmethod

class OrderRepository(ABC):
    @abstractmethod
    async def get_by_id(self, order_id: UUID) -> Order: ...

    @abstractmethod
    async def save(self, order: Order) -> Order: ...

    @abstractmethod
    async def list_by_account(self, account_id: UUID, *, include_cancelled: bool = False) -> list[Order]: ...

# infrastructure/db/repositories/postgres_order_repository.py  — the ADAPTER
class PostgresOrderRepository(OrderRepository):
    def __init__(self, client: DatabaseClient) -> None:
        self._client = client

    async def get_by_id(self, order_id: UUID) -> Order:
        async with self._client.cursor() as cur:
            await cur.execute("SELECT * FROM orders.orders WHERE id = %s", (order_id,))
            row = await cur.fetchone()
            if not row:
                raise OrderNotFoundError(order_id=order_id)
            return self._row_to_entity(row)

    def _row_to_entity(self, row: dict) -> Order:  # private — never leaks DB shape
        return Order(id=row["id"], account_id=row["account_id"], status=OrderStatus(row["status"]), total=row["total"])
```

Rules:
- `_row_to_entity()` is always private — the DB row shape never leaks into the domain.
- Repository raises domain errors (`OrderNotFoundError`), not DB-specific exceptions.
- `save()` returns the persisted entity (use `RETURNING *`), not the raw row.
- Never put business logic in a repository — only persistence operations.

## Factory methods

Use named class methods when construction is non-trivial or semantically meaningful:

```python
@classmethod
def create(cls, *, name: str, account_id: UUID) -> "Order":
    """Create a new order. Call only from PlaceOrderUseCase."""
    ...

@classmethod
def reconstruct(cls, *, id: UUID, ...) -> "Order":
    """Reconstruct from persistence. Does not fire events."""
    ...
```

`create()` / `place()` / `register()` — express the domain operation, fire domain events.
`reconstruct()` / `from_row()` — restore from storage, skip domain event emission.
Plain `__init__` — avoid direct construction except inside the entity itself.

## Application vs domain services

| Service type | Location | Depends on | Purpose |
|---|---|---|---|
| **Domain service** | `domain/services/` | Domain only | Logic spanning multiple entities that doesn't fit one aggregate (e.g. tax calculation) |
| **Application service / use case** | `application/use_cases/` | Domain + infrastructure ports | Orchestration: load → apply domain logic → persist → publish events |
| **Infrastructure service** | `infrastructure/` | External systems | Email gateway, payment adapter, DB client |

Use case = one public method (`execute()`), one cohesive operation. Don't split a use case across
methods. If a use case needs two operations, create two use cases.

## Bounded contexts

A bounded context is a linguistic boundary: the same word may mean different things in two contexts
(an `Account` in billing is not an `Account` in access control). Separate them into modules or
packages; they communicate through well-defined events or API contracts, not shared domain objects.

Signals that a context boundary exists:
- The same term means subtly different things to two teams.
- Two features share a DB table but evolve at different rates.
- A change to one domain requires coordinating with an unrelated team.

When you detect a context boundary, document it as an ADR and define the integration contract
(anti-corruption layer, event, or explicit API).

## Python

```python
# domain/entities/order/order.py
from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime, UTC
from decimal import Decimal
from uuid import UUID, uuid4
from domain.entities.order.events import OrderPlacedEvent, DomainEvent
from domain.entities.order.exceptions import NegativeOrderTotalError
from domain.value_objects.order.order_status import OrderStatus

@dataclass
class Order:
    id: UUID
    account_id: UUID
    status: OrderStatus
    total: Decimal
    _events: list[DomainEvent] = field(default_factory=list, repr=False, compare=False)

    def __post_init__(self) -> None:
        if self.total < Decimal("0"):
            raise NegativeOrderTotalError(total=self.total)

    @classmethod
    def place(cls, *, account_id: UUID, total: Decimal) -> Order:
        order = cls(id=uuid4(), account_id=account_id, status=OrderStatus.OPEN, total=total)
        order._events.append(OrderPlacedEvent(order_id=order.id, account_id=account_id, total=total, placed_at=datetime.now(UTC)))
        return order

    def collect_events(self) -> list[DomainEvent]:
        events, self._events = self._events, []
        return events
```

## TypeScript

```typescript
// domain/entities/order/order.ts
export class Order {
  private _events: DomainEvent[] = [];

  private constructor(
    public readonly id: string,
    public readonly accountId: string,
    public status: OrderStatus,
    public readonly total: number,
  ) {
    if (total < 0) throw new NegativeOrderTotalError(total);
  }

  static place(params: { accountId: string; total: number }): Order {
    const order = new Order(crypto.randomUUID(), params.accountId, OrderStatus.OPEN, params.total);
    order._events.push(new OrderPlacedEvent({ orderId: order.id, ...params }));
    return order;
  }

  static reconstruct(params: { id: string; accountId: string; status: OrderStatus; total: number }): Order {
    return new Order(params.id, params.accountId, params.status, params.total);
  }

  collectEvents(): DomainEvent[] {
    const events = [...this._events];
    this._events = [];
    return events;
  }
}
```

## How to verify

- [ ] Does `domain/` import anything from `infrastructure/` or the web framework? If yes, a finding.
- [ ] Do all entities validate invariants in `__post_init__`/constructor? No half-valid objects?
- [ ] Are value objects immutable (`frozen=True` / `readonly`)? Equality by value?
- [ ] Are domain events immutable data classes? Past-tense names?
- [ ] Does the repository interface live in `domain/`, implementation in `infrastructure/`?
- [ ] Does `_row_to_entity()` exist and is it private? Does the DB shape leak into domain?
- [ ] Does the use case collect events after persisting (not before)?
- [ ] Are application services one-operation use cases (`execute()` method)?
- [ ] For any aggregate: does external code reference only the root (never inner entities directly)? Do all state mutations go through a root method rather than directly modifying child entities?
- [ ] Do names in code match the ubiquitous language glossary?
- [ ] Are domain events delivered via the transactional outbox pattern (outbox table + relay), or if direct-publish is used, is it documented as an accepted trade-off in the ADR/spec for this surface?
