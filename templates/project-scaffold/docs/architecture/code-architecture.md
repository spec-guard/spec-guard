# Code Architecture — <Project>

> Starter template. Document **this** project's structure so any agent or new developer conforms to it.
> Fill the `<…>` placeholders and delete the guidance lines. Companion: `docs/standards/coding-guidelines.md`.

## Organizing principle

<How is the code organized? Pick and describe one: layer-based (`domain/ application/ infrastructure/
interfaces/`), feature-based (a folder per feature), or layer × feature (a feature folder inside each
layer — a vertical slice). State the rule for where a new file goes.>

## Directory layout

```
src/
├── <layer-or-feature>/
│   └── …
```

<Show the real tree, 2–3 levels deep, and name one representative feature/module.>

## Dependency direction

<Which way may dependencies point? e.g. interfaces → application → domain; infrastructure implements
ports; the domain depends on nothing; shared contracts sit at the root. An import against the grain is
a bug.>

## Barrel exports (`__init__.py` / `index.ts`)

- Barrels at: <architectural layers + component categories>.
- No barrel at: <feature folders, factory subfolders>.
- <One symbol per file? `__all__` / named exports? local-vs-global barrel policy?>

## Imports

- Grouping: <stdlib → third-party → first-party>; ordering enforced by <tool, or "documented manual order">.
- Path aliases: <`@domain/*`, …>.
- Cycle-breaking: <`TYPE_CHECKING` / local import / factory>.

## Per-layer responsibilities

| Layer / area | Responsibility | May depend on |
|---|---|---|
| <domain> | <…> | <nothing> |
| <application> | <…> | <domain> |
| <infrastructure> | <…> | <application contracts> |
| <interfaces> | <…> | <application> |

## Testing by layer

<How each layer is tested (pure unit, mocked, integration, API).>

## Change history

| Date | Change |
|---|---|
| <YYYY-MM-DD> | Initial. |
