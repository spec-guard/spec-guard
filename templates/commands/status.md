---
id: status
description: Show the spec-guard loop checklist and where the current task stands in it.
---
Print the spec-guard loop and mark where the current task is.

```
Spec-Guard Progress:
- [ ] 1. ORIENT  — read repo CLAUDE.md + the doc(s)/ADR(s) governing this surface
- [ ] 2. SPEC    — locate or write the spec (scope, acceptance, ADR traceability)
- [ ] 3. PLAN    — decompose into small verifiable increments
- [ ] 4. BUILD   — implement one increment; match surrounding code
- [ ] 5. VERIFY  — check output against the spec + invariants; run tests
- [ ] 6. SYNC    — update docs/contracts/cross-references; record decisions
```

Specs live in `${specDir}`; plans in `${plansDir}`. State the current step and the next action.
