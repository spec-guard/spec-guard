# Code Organization

Where new code goes, how modules expose themselves, and how they import each other. The rule is not
"use this structure" — it's **find the structure the repo already has and add to it the same way**. A
file dropped in the wrong layer, a barrel where siblings have none, or an import that points the wrong
way is a regression even when the code compiles. Re-check before BUILD is done.

## Contents
- The universal rules
- Barrel exports
- Import organization
- Python
- TypeScript
- How to verify

## The universal rules

1. **Find the organizing axis before adding a file.** Repos organize by layer (`domain/ application/
   infrastructure/ interfaces/`), by feature (`orders/ users/`), or by both — a feature folder inside
   each layer (a *vertical slice*). Locate where a sibling of what you're adding already lives, and put
   the new file beside it. Never introduce a second axis.
2. **Dependencies point one way.** Inner/owned code never imports outward: the domain depends on
   nothing; outer layers depend inward; shared contract modules sit at the root and everything depends
   on them, never the reverse. An import that crosses against the grain is a *finding*, not a quick fix.
3. **One canonical location per concept.** A type/DTO/enum/constant lives in exactly one module;
   everyone imports it. Re-declaring it locally is the regression `anti-regression.md` ("one
   definition, many imports") exists to stop.
4. **Barrels expose; feature folders don't.** (See below.)
5. **Imports are grouped and ordered the way the repo already does it.** Match the grouping and the
   tool — don't impose your own.

## Barrel exports

A barrel (`__init__.py` in Python, `index.ts` in TypeScript) re-exports a folder's public symbols so
consumers import from the folder, not the file. The convention that scales:

- **Barrels at architectural layers and component categories** — `domain/`, `application/`, `entities/`,
  `repositories/`, `gateways/`, `use_cases/`, an aggregating `exceptions/` folder. These expose a stable
  surface.
- **No barrel at feature folders or factory subfolders** — `entities/orders/`, `repositories/orders/`,
  `factories/gateways/`. Consumers import the concrete module (`entities/orders/order.py`), not the
  feature folder. This keeps a feature free to add files without editing a barrel, and avoids ambiguous
  folder-imports.
- **Local barrels, not reverse coupling.** Each bounded context exports its own symbols through its
  local barrel. A global/root barrel exposes only shared bases and public compatibility — never reach
  into a feature's internals through a generic barrel.
- **One symbol per file + an explicit export list** (`__all__` in Python; named `export { … }` in TS)
  where the repo does this.
- **Match the repo:** don't add a barrel where the siblings have none, and don't skip one where the
  siblings have one.

## Import organization

- **Group** stdlib → third-party → first-party/local, blank-line separated.
- **Order within groups follows whatever the repo enforces or documents.** Where a formatter/linter
  rule owns ordering (isort, Ruff's `I` rules, ESLint `import/order`), run it and don't hand-fight it.
  Where the repo documents a manual order instead, follow that documented order. **A present formatter
  does not imply auto-sorting** — `ruff format` and `black` do *not* reorder imports, so confirm what is
  actually enforced before assuming.
- **Use the repo's path aliases** (`@domain/*`, `@/...`) instead of deep relative paths (`../../../`)
  when the repo defines them.
- **`from __future__ import annotations` as the first import** in every module, where the repo adopts it.
- **Break cycles the way the repo already does** — `TYPE_CHECKING`-guarded imports, function-local
  imports, or factory indirection. A new circular import is a finding; resolve it with the repo's chosen
  technique, don't paper over it.

## Python

A layered tree with feature folders inside each layer; barrels only at the marked spots:

```
src/domain/
├── __init__.py                 ✓ layer barrel
├── entities/
│   ├── __init__.py             ✓ category barrel
│   └── orders/                 (feature — NO __init__.py)
│       ├── order.py
│       └── exceptions/
│           └── __init__.py     ✓ aggregates the feature's exceptions
└── repositories/
    ├── __init__.py             ✓ category barrel
    └── order_repository.py     (interface)
src/infrastructure/db/repositories/
└── orders/                     (feature — NO __init__.py)
    └── postgres_order_repository.py
```

Import the concrete module: `from domain.entities.orders.order import Order` — not
`from domain.entities.orders import Order`.

## TypeScript

- Path aliases per layer in `tsconfig.json`:
  ```jsonc
  "paths": {
    "@domain/*": ["./src/domain/*"],
    "@application/*": ["./src/application/*"],
    "@ui/*": ["./components/ui/*"]
  }
  ```
- A layer barrel re-exports named symbols and marks type-only re-exports with `export type`:
  ```ts
  // src/domain/index.ts
  export { Order } from "./entities/orders/order";
  export type { OrderRepository } from "./repositories/order-repository";
  export { DomainError, NotFoundError } from "./entities/exceptions";
  ```

## How to verify

- Open a sibling of what you added: same layer? same feature-folder depth? barrel present iff the
  siblings have one?
- Read the repo's lint/format config and **run it** — don't hand-order imports it manages.
- Trace the new imports: do any point outward / against the dependency direction? Any new cycle?
- Grep for the symbol you added across modules — is it defined once, or did you fork an existing one?
