# Releasing

Releases are automated by [release-please](https://github.com/googleapis/release-please):
merging Conventional Commits to `main` opens/updates a Release PR; merging that PR cuts the
tag + GitHub Release, and the same `release-please.yml` run then runs `npm publish` (a
`GITHUB_TOKEN`-created release cannot trigger other workflows, so the publish is gated on
`release_created` inside that workflow). `release.yml` remains a manual fallback
(`gh workflow run release.yml`) to (re)publish whatever version is on `main`.

## One-time setup gates (must be done before the first `v0.1.0` publish)

These require org-owner / npm-account access and are **not** automatable from the repo:

1. **Org Actions permissions** — GitHub org `spec-guard` → Settings → Actions → General →
   Workflow permissions → **Read and write permissions** (+ allow Actions to create PRs).
   Without this, `release-please.yml` cannot open its Release PR.
   *(Status: org currently blocks workflow write — enable before release.)*
2. **npm org + token** — create/own the npm org `spec-guard` at npmjs.com; generate an
   **Automation** access token scoped to the org; add it to the repo as the secret
   `NPM_TOKEN`. Without this, `release.yml`'s `npm publish` fails.
3. **Verify** — `npm access ls-packages @spec-guard` lists the org once membership is wired.

## Versioning

Conventional Commits drive SemVer: `fix:` → patch, `feat:` → minor, `feat!:` /
`BREAKING CHANGE:` → major. `chore:`/`docs:`/`refactor:`/`test:` do not bump the version.
