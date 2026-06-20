---
id: sync
description: Update docs/contracts/cross-references so the system stays consistent after the change.
---
Run step 6 (SYNC) of the spec-guard loop.

1. Update the docs this change affects: architecture doc, ADR (new or status), API contract,
   event catalog, glossary. The repo's CLAUDE.md "when to update docs" rule is binding.
2. Keep deliverable docs (`docs/`) separate from the internal IP knowledge base (`${ipDir}/`) and
   per-agent dirs; never let a `docs/` file link into `${ipDir}/` or an agent dir.
3. In a multi-repo workspace, commit inside each affected deliverable repo in dependency order,
   then let the backup root capture the state.

A change that ships code but not docs is incomplete. List every doc you updated.
