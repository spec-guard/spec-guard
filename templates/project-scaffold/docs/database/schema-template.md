# Schema: <schema_or_table_name>

> Starter template for documenting one database schema/table. Copy it per owned schema. Fill the `<…>`.

## Overview

<What this schema stores, who owns it (which module migrates it), and who reads it.>

## ER diagram

```mermaid
erDiagram
  <ENTITY_A> ||--o{ <ENTITY_B> : "<relationship>"
```

## Lifecycle (if a status column exists)

```mermaid
stateDiagram-v2
  [*] --> <state_1>
  <state_1> --> <state_2>
```

## Columns

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `<uuid>` | no | `<gen_random_uuid()>` | PK |
| `<account_id>` | `<…>` | no | — | FK → `<accounts.id>` `ON DELETE <CASCADE>` |

## Constraints & indexes

| Name | Kind | Definition |
|---|---|---|
| `<uq_…>` | unique | `<cols>` |
| `<ck_…>` | check | `<expr>` |
| `<ix_…>` | index | `<cols / partial where>` |

## Migrations

- Mechanism: <Alembic / Prisma / Drizzle / …>; this schema's migration-version table: `<…>`.
- Every change ships a reversible migration + this doc + any contract/event version bump.

## Operational queries

```sql
-- <common operational query>
```

## Change history

| Date | Migration | Change |
|---|---|---|
| <YYYY-MM-DD> | `<0001_…>` | Initial. |
