# Changelog

## [0.3.18](https://github.com/spec-guard/spec-guard/compare/cli-v0.3.17...cli-v0.3.18) (2026-09-08)


### Bug Fixes

* **coordinate:** merge writes an explicit message instead of git's --no-edit default ([a59e8fb](https://github.com/spec-guard/spec-guard/commit/a59e8fb494756a68b8a79d9987f99131b2638d98))

## [0.3.17](https://github.com/spec-guard/spec-guard/compare/cli-v0.3.16...cli-v0.3.17) (2026-09-07)


### Bug Fixes

* re-init no longer clobbers module list or spec/plans/private dirs ([854bb8a](https://github.com/spec-guard/spec-guard/commit/854bb8a9c7f54329ef813a920e483da777287ca6))

## [0.3.16](https://github.com/spec-guard/spec-guard/compare/cli-v0.3.15...cli-v0.3.16) (2026-09-07)


### Features

* add multi-front coordinator (specguard coordinate / /spec:coordinate) ([78eb7aa](https://github.com/spec-guard/spec-guard/commit/78eb7aa9b1fe80489bf827c07bdf447d3a294e61))

## [0.3.15](https://github.com/spec-guard/spec-guard/compare/cli-v0.3.14...cli-v0.3.15) (2026-08-13)


### Bug Fixes

* opencode skill and command dirs must be plural (skills/commands) ([03bee82](https://github.com/spec-guard/spec-guard/commit/03bee82c533fe8ae7c0cc6d16df131c6266532f7))

## [0.3.14](https://github.com/spec-guard/spec-guard/compare/cli-v0.3.13...cli-v0.3.14) (2026-08-03)


### Bug Fixes

* stop config.json drifting from reality in both directions ([7dccc25](https://github.com/spec-guard/spec-guard/commit/7dccc25adaf388ae9bc44cee36109398c4436f80))

## [0.3.13](https://github.com/spec-guard/spec-guard/compare/cli-v0.3.12...cli-v0.3.13) (2026-08-03)


### Features

* language-aware commit-message style guidance in /spec:commit ([1b7fd58](https://github.com/spec-guard/spec-guard/commit/1b7fd589acd6e66cf2697ec9fca82496860e827f))


### Bug Fixes

* preserve existing agents when re-initializing a repo ([671616d](https://github.com/spec-guard/spec-guard/commit/671616d6b42c5074fb2c2f629e01f279664a4c73))

## [0.3.12](https://github.com/spec-guard/spec-guard/compare/cli-v0.3.11...cli-v0.3.12) (2026-07-10)


### Bug Fixes

* ship CHANGELOG.md in the npm package ([d3ee119](https://github.com/spec-guard/spec-guard/commit/d3ee119f65ace143a2101920aea6a32a01b197d9))

## [0.3.11](https://github.com/spec-guard/spec-guard/compare/cli-v0.3.10...cli-v0.3.11) (2026-07-10)


### Features

* clarify agent support capabilities ([8c69797](https://github.com/spec-guard/spec-guard/commit/8c69797f277d80eb22de0cb0ad24d162fedaafda))


### Bug Fixes

* github-copilot overlay missing spec-commit and umbrella commands ([be9290f](https://github.com/spec-guard/spec-guard/commit/be9290f3ca616c3d98d71028b62d7b807093c05a))
* harden self-upgrade guard, init wiring gate, and codex stop hook edge ([4835c28](https://github.com/spec-guard/spec-guard/commit/4835c289837aae7b8325a335841871d36295d6e6))

## [0.3.10](https://github.com/spec-guard/spec-guard/compare/cli-v0.3.9...cli-v0.3.10) (2026-06-25)


### Bug Fixes

* make tryAutoUpdate agent-aware and scope-safe ([08ed349](https://github.com/spec-guard/spec-guard/commit/08ed3495f34d2c06041393a41379471b8c2dc255))

## [0.3.9](https://github.com/spec-guard/spec-guard/compare/cli-v0.3.8...cli-v0.3.9) (2026-06-25)


### Features

* auto-update per-repo skill at SessionStart, remove specguard update command ([2389ece](https://github.com/spec-guard/spec-guard/commit/2389eced1a0ddae837989cc39f111750c9e9f35d))

## [0.3.8](https://github.com/spec-guard/spec-guard/compare/cli-v0.3.7...cli-v0.3.8) (2026-06-23)


### Features

* add DDD, cache, testing, scale, and ubiquitous-language reference guides ([8ce64d5](https://github.com/spec-guard/spec-guard/commit/8ce64d5de8f035ec51ad6dac09cd6048560cb839))

## [0.3.7](https://github.com/spec-guard/spec-guard/compare/cli-v0.3.6...cli-v0.3.7) (2026-06-22)


### Features

* **graphify:** correct sync recipe + per-module topology & IP firewall ([f150470](https://github.com/spec-guard/spec-guard/commit/f1504709833f14a4ceab3cee1ce1e3f1ba8315a5))

## [0.3.6](https://github.com/spec-guard/spec-guard/compare/cli-v0.3.5...cli-v0.3.6) (2026-06-21)


### Features

* brownfield single-source guard + doctor placeholder check; harden convention docs ([2c409af](https://github.com/spec-guard/spec-guard/commit/2c409afaa5929a1e7ff4ccda6824966f980e1c5c))

## [0.3.5](https://github.com/spec-guard/spec-guard/compare/cli-v0.3.4...cli-v0.3.5) (2026-06-21)


### Features

* convention reference docs + scaffold templates for BUILD-phase governance ([c3373dd](https://github.com/spec-guard/spec-guard/commit/c3373dd32f167a2a7a269bddfde9a66040c97c44))

## [0.3.4](https://github.com/spec-guard/spec-guard/compare/cli-v0.3.3...cli-v0.3.4) (2026-06-20)


### Features

* idempotent self-update and consistent, discoverable command UX ([72a9a79](https://github.com/spec-guard/spec-guard/commit/72a9a79d5da60b85d97d9b336bb9408b8bb37897))

## [0.3.3](https://github.com/spec-guard/spec-guard/compare/cli-v0.3.2...cli-v0.3.3) (2026-06-20)


### Features

* shell completion for bash, zsh, fish, and PowerShell ([597203e](https://github.com/spec-guard/spec-guard/commit/597203ecd16e9dff029496926009cd5c0961ac8f))

## [0.3.2](https://github.com/spec-guard/spec-guard/compare/cli-v0.3.1...cli-v0.3.2) (2026-06-20)


### Bug Fixes

* auto-remove stale .spec-guard-update sidecar once the file is reconciled ([c0d8dce](https://github.com/spec-guard/spec-guard/commit/c0d8dce16c43d3fd7f4ee1b374fe90a0b34d6e8b))

## [0.3.1](https://github.com/spec-guard/spec-guard/compare/cli-v0.3.0...cli-v0.3.1) (2026-06-20)


### Bug Fixes

* clearer init messaging for re-init, already-wired machine, and owned-file divergence ([163c889](https://github.com/spec-guard/spec-guard/commit/163c8895b07817ceb903ae8a879a970514386820))

## [0.3.0](https://github.com/spec-guard/spec-guard/compare/cli-v0.2.0...cli-v0.3.0) (2026-06-20)


### ⚠ BREAKING CHANGES

* the CLI binary is now `specguard` (was `spec-guard`); machine wiring moved from `install --global` to `setup`.

### Features

* specguard binary + single init front door, graph-sync before commit ([6122071](https://github.com/spec-guard/spec-guard/commit/61220712672aea465870d1786ed9342bd3e47e4f))

## [0.2.0](https://github.com/spec-guard/spec-guard/compare/cli-v0.1.0...cli-v0.2.0) (2026-06-20)


### Features

* `spec-guard commit` — Conventional Commit + multi-repo + no AI attribution ([7dd4601](https://github.com/spec-guard/spec-guard/commit/7dd460151d7d68422fdae5b2caf969ad3d421a8e))
* add bare /spec umbrella command ([d4d8088](https://github.com/spec-guard/spec-guard/commit/d4d808857d16fe0590093a5d88f537accfe91867))
* add opencode agent support (covers OpenWork) ([fee74c2](https://github.com/spec-guard/spec-guard/commit/fee74c2dbba6eaedcc79b175bc1fee1fb4298dc4))
* add uninstall command (per-repo + --global) ([7acf7fe](https://github.com/spec-guard/spec-guard/commit/7acf7fe533663ae2472beb6ee463c7d7f127cda0))
* **cli:** init/update/install/self/status/doctor/toggle + 4-agent installer ([4b6573c](https://github.com/spec-guard/spec-guard/commit/4b6573ccf73820c547ec101e8eba41211d540d51))
* **core:** render engine, agent matrix, 4-case hook merge, manifest + rules-block guard ([203f307](https://github.com/spec-guard/spec-guard/commit/203f307ee95cac22d87e6d1cd9b90399930efb31))
* **differentiators:** topology detection, IP-wall lint, graphify enhancer, project scaffold ([093566c](https://github.com/spec-guard/spec-guard/commit/093566c5477482bcae1bf55103fceab56354b1e5))
* harness-agnostic IP knowledge base (configurable ipDir, default .private) ([84926af](https://github.com/spec-guard/spec-guard/commit/84926afbae30c5eef0cfbfd756ca3e6300513138))
* port skill + references + hooks, decoupled from superpowers, English-only ([b313519](https://github.com/spec-guard/spec-guard/commit/b3135192ee88b7b8fbd2084a434e845cc713ab83))
* transitional `spec-guard migrate` command ([0ae4619](https://github.com/spec-guard/spec-guard/commit/0ae4619a03570b378ab953f58dc8ac9645ff9cc4))

## [0.1.0] - 2026-06-20

### Added
- CLI (init/update/install/self/status/doctor/toggle/migrate/commit) with single-source rendering for Claude Code, Codex, GitHub Copilot, Gemini CLI, and opencode (incl. OpenWork).
- Spec-driven loop skill + slash commands; manifest-guarded installs; multi-git topology detection; harness-agnostic IP wall (configurable privateDir); optional graphify enhancer; `migrate` and `commit` commands.

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Releases are managed
by [release-please](https://github.com/googleapis/release-please) from Conventional
Commits — do not hand-edit released sections.
