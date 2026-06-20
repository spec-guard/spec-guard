# Contributing

spec-guard dogfoods its own governance: changes follow the spec-driven loop
(ORIENT → SPEC → PLAN → BUILD → VERIFY → SYNC).

## Ground rules

- **Spec before code.** Non-trivial changes need a spec in [`docs/specs/`](docs/specs/)
  and, for decisions, an ADR in [`docs/reference/decisions/`](docs/reference/decisions/).
- **Conventional Commits.** Releases are cut by release-please from commit messages
  (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`…). A `feat:` bumps minor,
  `fix:` bumps patch, `feat!:`/`BREAKING CHANGE:` bumps major.
- **Tests.** `npm test` (Node's built-in test runner) must pass. New behavior ships with a test.
- **The IP wall.** Deliverable docs live in `docs/`; internal notes never ship and are
  gitignored. `docs/` must never link into ignored paths.

## Local development

```bash
npm install
npm test
node bin/specguard.js --help
```

## Adding a new agent

Agents are rows in the path matrix (`src/core/agents.js`): a skill dir, a commands
target + format, a hooks config, and a rules file. Add the row, add an
`templates/agents/<agent>/overlay.md`, and add a render/verify test. No core changes.
