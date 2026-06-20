**This project is governed by [spec-guard](https://github.com/spec-guard/spec-guard).**

Before any non-trivial change (a feature, a refactor touching >1 file, a schema/API/contract/event change, or a bugfix in load-bearing code), follow the loop: **ORIENT → SPEC → PLAN → BUILD → VERIFY → SYNC**. Read the governing `CLAUDE.md` / architecture doc / ADR before coding. Put specs in `${specDir}` and plans in `${plansDir}`. Verify against the spec, not from memory. Keep deliverable docs (`docs/`) separate from internal IP. The full governance is loaded as the spec-guard skill in this agent.
