# Schema & Data Contracts

Changing the shape of stored data. Match **how this repo defines and migrates schema**, and remember a
schema change is never code alone. This doc covers *how schema is defined and documented*; the
FK/migration/version invariants you must satisfy live in `anti-regression.md` ("Data & contracts") —
this extends them, it doesn't restate them. **These are rules, not suggestions — a deviation is a defect
to fix, not a style choice.**

## Contents
- The universal rules
- Multi-module / shared databases (worked example)
- Defining schema (worked example)
- TableLocator pattern
- Soft delete pattern
- Tenant partitioning
- Documenting schema
- How to verify

## The universal rules

1. **Detect the definition style first.** Schema may be ORM declarative models, Core `Table` objects,
   migration-files-only, or a schema file (Prisma/Drizzle). Find where the existing tables live and add
   yours the same way — don't introduce a second mechanism.
2. **A schema change ships three things or none:** a migration (sequential, named, **reversible**), the
   schema-doc update, and any contract/event version bump the shape feeds. (Cross-link
   `anti-regression.md`.)
3. **Constraints live at the database, not just in app code:** an explicit FK with defined `ON DELETE`
   for every `*_id`; unique indexes for uniqueness invariants; check constraints for enums/ranges.
   App-level validation is not a substitute. (Cross-link `anti-regression.md`.)
4. **Migrations are owned.** Exactly one module owns and migrates each schema; other modules read it.
   Never migrate a schema you don't own.

## Multi-module / shared databases (worked example)

When several modules share one database:

- Each module keeps its **own migration-version table** (e.g. `<module>_migrations`), so histories
  don't collide.
- Data schemas shared across modules (`accounts`, `ledger`) are **migrated only by their owner**;
  consumers get read access via a documented contract.
- Each module sets its own `search_path` / migrations table via config (`DATABASE_MIGRATIONS_TABLE`,
  `DATABASE_FEATURE_SCHEMAS`).
- A small **table-locator** abstraction (schema + name constants, inherited shared schemas) keeps
  cross-schema references from hard-coding names.

## Defining schema (worked example)

Fully-specified columns and constraints, not just types — e.g. a Core `Table`:

```python
orders = Table(
    "orders", metadata,
    Column("id", UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid(), comment="…"),
    Column("account_id", CHAR(7), ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
    UniqueConstraint("account_id", "reference", name="uq_orders_account_reference"),
    CheckConstraint("amount >= 0", name="ck_orders_amount_nonneg"),
    Index("ix_orders_open", "status", postgresql_where=text("status = 'OPEN'")),
)
```

Map rows → domain entities in the repository (a private `_row_to_entity`), not by leaking the table
into the domain.

## TableLocator pattern

Type-safe references to table names prevent hard-coded strings from drifting and protect against
schema injection when building dynamic queries:

```python
# infrastructure/db/table_locator.py
@dataclass(frozen=True)
class TableReference:
    schema: str
    table: str

    @property
    def qualified_name(self) -> str:
        _validate_identifier(self.schema)
        _validate_identifier(self.table)
        return f"{self.schema}.{self.table}"

def _validate_identifier(name: str) -> None:
    if not re.match(r"^[a-z][a-z0-9_]*$", name):
        raise ValueError(f"Invalid identifier: {name!r}")

class CoreTableLocator:
    ORDER   = TableReference(schema="orders",   table="orders")
    ACCOUNT = TableReference(schema="accounts", table="account")
    INVOICE = TableReference(schema="billing",  table="invoice")

locator = CoreTableLocator()
```

Usage in a repository:
```python
await cur.execute(
    f"SELECT * FROM {locator.ORDER.qualified_name} WHERE id = %s",
    (order_id,)
)
```

Rules:
- `_validate_identifier` guards against SQL injection in dynamic table references.
- Every schema and table name lives as a constant in the locator — no bare strings in repositories.
- When a table is renamed, one locator change propagates to all usages (grep surfaces the rest).

## Soft delete pattern

When records must be logically removed but retained for audit or recovery:

```sql
ALTER TABLE orders ADD COLUMN deleted_at TIMESTAMPTZ;
```

```python
@dataclass
class Order:
    ...
    deleted_at: datetime | None = None

    @property
    def is_deleted(self) -> bool:
        return self.deleted_at is not None
```

Repository convention:
```python
async def get_by_id(self, order_id: UUID, *, include_deleted: bool = False) -> Order:
    clause = "" if include_deleted else "AND deleted_at IS NULL"
    ...

async def soft_delete(self, order_id: UUID, *, deleted_at: datetime) -> Order:
    # Sets deleted_at, collects domain events, returns the updated entity
    ...
```

Rules:
- Default is **exclude** deleted records; callers must explicitly pass `include_deleted=True`.
- Soft-delete fires domain events just like a hard delete (`OrderDeletedEvent`).
- Soft-deleted rows accumulate — add a background job or partition rotation for rows older than the
  retention policy. Document the retention period in the schema doc.
- Never mix soft-deleted records with active data in aggregate root loading (risk of invariant
  violations on a logically-gone entity).

## Tenant partitioning

When a table has very high row counts and access is always tenant-scoped, partition by tenant ID:

```sql
CREATE TABLE ledger_entry (
    id          UUID        NOT NULL,
    tenant_id   VARCHAR(7)  NOT NULL,
    amount      NUMERIC     NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (id, tenant_id)   -- tenant_id required in PK for partitioned tables
) PARTITION BY LIST (tenant_id);

-- Per-tenant partitions created by a procedure, not by app migrations:
CALL create_tenant_partitions('tenant_123');
```

Implications:
- The PK must include the partition key (`tenant_id`) — PostgreSQL requirement for declarative
  partitioning. This changes FK references from `REFERENCES ledger_entry(id)` to
  `REFERENCES ledger_entry(id, tenant_id)`.
- Document this PK composition in the ADR that introduces partitioning — it surprises developers
  who expect a plain UUID PK.
- Partition creation/deletion is a DDL operation; use `SECURITY DEFINER` procedures so the
  application account needs no DDL privileges.
- Query planner eliminates non-matching partitions automatically; always filter by `tenant_id`.

## Documenting schema

Every owned schema gets a deliverable schema doc — seed it from the scaffold
`docs/database/schema-template.md`. A good schema doc carries: an ER diagram, a state-machine diagram
for lifecycle columns, a data-flow diagram, column/constraint/index tables, an operational query
library, and a change history.

## How to verify

- Is there a reversible migration, in the same mechanism as the existing ones?
- Schema doc updated; contract/event version bumped if the shape is exposed?
- FK + `ON DELETE` on every new `*_id`; uniqueness/range enforced at the DB?
- Did you migrate only schemas you own? Grep consumers for the changed shape.
- Are all table/schema references going through `TableLocator`? Any bare strings left?
- Does every soft-delete query default to excluding deleted rows? Is the domain event fired?
- If a tenant-partitioned table was changed: is the partition key still in the PK? Is the ADR updated?
