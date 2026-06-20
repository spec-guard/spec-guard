---

## In Claude Code

Run `/spec` for the umbrella — it prints the loop, the phase commands, and where the current
task stands. The phases map to: `/spec:orient`, `/spec:write`, `/spec:verify`, `/spec:sync`,
and `/spec:status` anytime. This skill is also injected automatically every session by the
SessionStart hook, and a `[SPEC-GUARD]` badge shows in the statusline while active. Turn it off
with `specguard off`.
