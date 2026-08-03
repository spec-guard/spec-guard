# Spec 0005 - Commit-message style guidance in `/spec:commit`

**Status:** IMPLEMENTED

## Context / Problem

`templates/commands/commit.md` step 1 tells the agent to "draft a Conventional Commit message...
Body explains the why" — correct but thin. The user's own personal git-workflow convention
(`~/.claude/commands/commit-all-projects.md`, used across their other projects) is more specific
and has proven itself in practice: a bulleted body (one `-` line per distinct change) and, for
Portuguese commits, a title that is never in the infinitive (a noun phrase or past participle
instead — `fix: correção de X`, not `fix: corrigir X`). The user asked for `/spec:commit` to take
the same shape.

spec-guard's own commit history (and its `commitLanguage` default of `"en"`) already follows the
standard Conventional Commits convention of imperative-mood English titles (`fix: correct …`,
`refactor: rename …`) — that convention is correct for English and should not change. The
infinitive-avoidance rule is specifically a Portuguese-grammar concern (English's imperative mood
has no equivalent ambiguity), so it must be scoped to `commitLanguage: "pt"`, not applied blindly
regardless of language.

## In-Scope

- `templates/commands/commit.md` step 1: add explicit guidance that the body is a bulleted list
  (`-` per distinct change), each bullet explaining the *why*.
- Same step: make title mood language-aware — English (default) keeps imperative-mood Conventional
  Commits as-is; Portuguese (`commitLanguage: "pt"`) never uses the infinitive, using a noun phrase
  or past participle instead, with the same before/after examples as the source convention.

## Out-of-Scope

- Any change to `src/cli/commit.js` (it validates/strips attribution; it does not author or
  reformat the message — the agent does, per this template).
- Any change to `commitLanguage`'s allowed values or default.
- Applying the infinitive rule to any language other than Portuguese.

## Acceptance Criteria

1. `templates/commands/commit.md` explicitly instructs a bulleted body.
2. It states the title-mood rule conditioned on `commitLanguage`, with a Portuguese example pair
   (correct/incorrect) matching `commit-all-projects.md`'s convention.
3. `npm test` stays green (no source behavior changed, template-only).

## Traceability

- User-originated convention: `~/.claude/commands/commit-all-projects.md`.
