---
id: orient
description: Load the governing docs/ADRs for the surface you are about to change, before touching code.
---
Run step 1 (ORIENT) of the spec-guard loop for the task at hand.

1. Read the repo's root `CLAUDE.md` and any module `CLAUDE.md` for the area you touch.
2. Open the architecture doc / ADR / spec that governs this surface. If the CLAUDE.md links an
   ADR index, read the matching ADR — it is mandatory before editing that surface.
3. If `graphify-out/` exists, run `graphify query "<the surface>"` to scope before grepping.
4. If code and the docs disagree, stop and surface it as a finding — do not silently pick one.

Report what governs this surface and the invariants you must respect, then proceed to SPEC.
