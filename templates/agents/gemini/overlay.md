---

## In Gemini CLI

Installed as the `spec-guard` extension. Run `/spec` for the umbrella (the loop map + where the
task stands); the phases are custom commands (`/spec:orient`, `/spec:write`, `/spec:verify`,
`/spec:sync`, then `/spec:commit` to close SYNC — refresh the knowledge graph if present, then
commit — and `/spec:status` anytime). The skill is activated each session via the extension's hooks.
Project conventions are also recorded in `GEMINI.md`.
