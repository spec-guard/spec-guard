---
id: verify
description: Adversarially check the change against the spec and the anti-regression invariants.
---
Run step 5 (VERIFY) of the spec-guard loop.

1. Walk each Acceptance Criterion in the spec and confirm the change meets it — cite evidence.
2. Run the repo's full gate: type-check + lint + tests. Paste the actual command output; never
   assert "tests probably pass".
3. Take a separate verifier stance (or dispatch a verifier subagent): try to prove the change is
   wrong, incomplete, or regressive. Default to "not done" until evidence says otherwise.
4. Re-check every anti-regression invariant (exhaustiveness, one-definition, FK-on-every-id,
   contract version bump + docs).

Report PASS/FAIL per criterion with evidence, and any invariant at risk.
