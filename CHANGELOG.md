# Changelog

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
