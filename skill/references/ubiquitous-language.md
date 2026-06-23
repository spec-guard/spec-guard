# Ubiquitous Language

A shared vocabulary between developers and domain experts where every term has exactly one meaning
and every concept has exactly one term. When the code speaks the same language as the business, it
becomes self-documenting, prevents translation bugs, and makes AI-assisted changes more accurate.
**These are rules, not suggestions — a deviation is a defect to fix, not a style choice.**

## Contents
- The universal rules
- Building a project glossary
- Language in code
- Anti-patterns
- When a term is disputed
- How to verify

## The universal rules

1. **One term, one concept.** Never use two words for the same concept in the same bounded context
   (`Account` and `User` should not mean the same thing; if they do, pick one and eliminate the
   other). Synonyms are a maintenance hazard — code that uses both drifts apart.
2. **Code terms match business terms.** If the domain expert says "invoice", the class is
   `Invoice`, the table is `invoice`, the event is `InvoiceIssuedEvent` — not `Bill`, `Receipt`,
   `Document`, or `Financeiro`. The business dictionary is the source of truth.
3. **No abbreviations unless they are the official term.** `codigo_ibge` is canonical; `cd_ibge`,
   `ibge_cd`, or `ibge` are not. Abbreviations create tribal knowledge and break `grep`.
4. **Every ambiguous or non-obvious term has a glossary entry.** If a new developer would not know
   what `MSC` or `Esfera` means, it needs a definition.
5. **The glossary evolves with the domain.** When the business renames a concept, update the
   glossary, the code, the DB schema, the event names, and the API contracts — all together.
   Partial renames are the worst of both worlds.

## Building a project glossary

Create `docs/glossary.md` (deliverable — visible to client/new developer) at project start.
Seed it from the first domain modeling session. Template for each entry:

```markdown
## Term

| Field | Value |
|---|---|
| **Term** | `OrderStatus` |
| **Also known as** | — |
| **Domain** | Orders, Billing |
| **Type** | Enum / Entity / Value Object / Event / Process |
| **Definition** | The lifecycle state of a customer order. |
| **Values / sub-concepts** | `OPEN`, `PROCESSING`, `SHIPPED`, `CANCELLED`, `REFUNDED` |
| **Not to be confused with** | `PaymentStatus` — the state of the payment, not the order |
| **First appeared** | ADR-0003 |
```

Maintain this document as a deliverable: it is the canonical contract between technical and
non-technical stakeholders. It belongs in `docs/` (not `.claude/docs/`).

For internal IP (AI-session context), maintain a mirror in `${privateDir}/docs/` with richer technical
notes (file locations, edge cases, migration history) — cross-reference the deliverable glossary
but do not duplicate it. Do not store it in `.claude/docs/` or any other per-agent directory;
see [ip-vs-deliverable.md](ip-vs-deliverable.md) for the rationale.

**Wiring the glossary into CLAUDE.md:** The repo's root `CLAUDE.md` should carry a direct link to
`docs/glossary.md` as a load-bearing context reference so that any agent following the spec-guard
ORIENT step loads the glossary automatically before naming anything. Example snippet:

```
## Load-bearing context
- Ubiquitous language glossary: `docs/glossary.md` — read before naming any class, field, or event
```

This closes the loop between the living glossary and the spec-guard ORIENT step: the glossary is
not just a document to maintain — it is active context that governs every naming decision.

## Language in code

### Entities, value objects, and events

Names are the domain term, PascalCase:

```python
# ✓ Domain-aligned names
class Invoice: ...
class InvoiceStatus(Enum): DRAFT, ISSUED, OVERDUE, PAID, CANCELLED
@dataclass(frozen=True)
class InvoiceIssuedEvent: ...

# ✗ Technical or translated names
class BillRecord: ...      # "Record" is persistence jargon
class FinancialDoc: ...    # "Doc" abbreviates and loses specificity
class InvoiceModel: ...    # "Model" is ORM jargon — not domain language
```

### Method names

Method names are verb + domain term, reflecting the business operation:

```python
# ✓
def issue_invoice(self) -> None: ...
def cancel_order(self) -> None: ...
def approve_reimbursement(self) -> None: ...

# ✗
def do_financial_action(self) -> None: ...  # too generic
def update_status(self) -> None: ...        # what status? which transition?
def process(self) -> None: ...              # "process" is not a domain concept
```

### Repository methods

Repository method names describe the query in domain terms, not SQL:

```python
# ✓
async def get_open_orders_by_customer(self, customer_id: UUID) -> list[Order]: ...
async def find_overdue_invoices_before(self, cutoff: date) -> list[Invoice]: ...

# ✗
async def select_where_status_open(self, customer_id: UUID) -> list[Order]: ...  # SQL leaked
async def query(self, filters: dict) -> list: ...  # too generic, no domain signal
```

### Use case names

Use case class names are the business operation, using the ubiquitous language:

```python
# ✓
class PlaceOrderUseCase: ...
class IssueInvoiceUseCase: ...
class ApproveReimbursementRequestUseCase: ...

# ✗
class OrderCreationService: ...     # "Service" is ambiguous; "Creation" is CRUD-speak
class ProcessOrderUseCase: ...      # "Process" is not specific to any domain operation
```

### Database column names

Column names follow the same vocabulary:

```sql
-- ✓
CREATE TABLE invoice (
    id         UUID,
    status     VARCHAR(20),    -- matches InvoiceStatus enum
    issued_at  TIMESTAMPTZ,    -- matches "issuance" domain event
    overdue_on DATE            -- matches domain concept "overdue date"
);

-- ✗
CREATE TABLE invoice (
    id         UUID,
    stat       VARCHAR(20),   -- abbreviated
    created_at TIMESTAMPTZ,   -- generic technical term; ambiguous (issued vs created)
    exp_date   DATE           -- "exp" is jargon; "date" is ambiguous
);
```

### API / event field names

API response and event field names use the ubiquitous language too — the contract between services
is part of the domain model:

```json
// ✓  — domain-aligned
{ "invoice_id": "...", "status": "OVERDUE", "issued_at": "...", "overdue_on": "..." }

// ✗  — technical jargon in the contract
{ "id": "...", "doc_status_cd": "...", "ts": "...", "exp": "..." }
```

## Anti-patterns

| Anti-pattern | Problem | Fix |
|---|---|---|
| **Synonyms in the same context** | `Customer` and `Client` used interchangeably | Pick one, grep-replace the other |
| **CRUD names for domain events** | `UserUpdated`, `OrderCreated` | `ProfileCompletedEvent`, `OrderPlacedEvent` |
| **Generic verbs** | `process()`, `handle()`, `do()` | Use the domain verb: `dispatch()`, `approve()`, `cancel()` |
| **Layered suffixes on domain objects** | `OrderEntity`, `OrderModel`, `OrderDTO`, `OrderRecord` | One `Order` class in domain; separate DTOs named by context |
| **Translated terms** | Portuguese domain, English code mixes | Be consistent: full Portuguese OR full English; never hybrid |
| **Abbreviations not in the business glossary** | `cust`, `inv`, `pmnt` | Spell them out: `customer`, `invoice`, `payment` |
| **Technical terms in domain** | `OrderRow`, `UserRecord`, `cache_key` in domain layer | Keep infrastructure terms in infrastructure |

## When a term is disputed

It is normal for domain experts to disagree, or for terms to evolve. When a term is disputed:

1. **Surface the ambiguity** — note it in the glossary with all candidate terms and their
   proponents. Don't silently pick one.
2. **Create an ADR** to record the decision: which term was chosen, why, and what alternatives
   were considered.
3. **Rename consistently** — once a term is decided, update all layers (code, DB, API, events,
   docs) in one commit. A partial rename is worse than no rename.
4. **Don't invent new terms in code** — if the domain experts don't use the term you're about to
   introduce, stop and ask. Code that drifts from business language requires a mental translation
   layer on every read.

## How to verify

- [ ] Does `docs/glossary.md` exist? Is it up to date with all domain terms in the codebase?
- [ ] Do entity, value object, and event names match the glossary exactly?
- [ ] Are there any synonyms (two terms meaning the same thing) in the same bounded context?
- [ ] Are there any abbreviations not in the official glossary?
- [ ] Do repository method names use domain verbs, not SQL verbs?
- [ ] Do use case class names use the domain operation name, not generic CRUD verbs?
- [ ] Do API fields and event payload fields follow the same vocabulary as the domain model?
- [ ] Are domain events named in the past tense and carry the `Event` suffix (`OrderPlacedEvent`, not `PlaceOrder` or `OrderPlaced`)?
- [ ] If a term was renamed, was it renamed everywhere (code + DB + API + events + docs)?
- [ ] Does the repo's root CLAUDE.md carry a direct link to `docs/glossary.md` under a 'Load-bearing context' section so that the ORIENT step auto-loads the glossary before any naming decision?
