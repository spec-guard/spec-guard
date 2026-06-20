---
id: write
description: Locate or write the spec (scope, acceptance, traceability) before writing code.
---
Run step 2 (SPEC) of the spec-guard loop.

1. Look for an existing spec in `${specDir}` (or a plan / an ADR) covering this change.
2. If none exists, write one. It is not done until it states: In-Scope, Out-of-Scope,
   Acceptance Criteria (testable, outcome-shaped), and Traceability (which ADR/doc it
   implements or which new ADR it produces).
3. For anything architectural or irreversible, get human sign-off on the spec BEFORE coding.

Output the spec (or the path to the existing one) and its acceptance criteria.
