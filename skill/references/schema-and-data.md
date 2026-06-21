# Schema & Data Contracts

Changing the shape of stored data. Match **how this repo defines and migrates schema**, and remember a
schema change is never code alone. This doc covers *how schema is defined and documented*; the
FK/migration/version invariants you must satisfy live in `anti-regression.md` ("Data & contracts") —
this extends them, it doesn't restate them.

## Contents
- The universal rules
- Multi-module / shared databases
- Defining schema
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
