# Changelog

All notable changes to this project should be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
once stable releases begin.

## [Unreleased]

## [0.1.0] - 2026-08-31

### Added

- `init`, `doctor`, `list`, `schema`, and `run` commands.
- Fixture-first, multi-trial execution in fresh copied workspaces.
- Built-in profiles for Codex, Claude Code, Gemini CLI, and OpenCode, plus custom commands.
- Assertions for regular files, file content, regexes, changed-file allowlists, commands, and process output.
- Per-run JSON, HTML, JUnit XML, and Markdown reports with per-trial evidence.
- Typed ESM and CommonJS library entry points and a generated JSON Schema.
- A deterministic starter suite and a runnable todo API example that require no model credentials.
- GitHub Actions quality and packed-install smoke workflows across supported Node.js releases.
- Project documentation for positioning, configuration, CI, adapters, and the security model.
- Community and governance files: contributing guide, security policy, code of conduct, and agent instructions.
- GitHub issue and pull request templates.
- Code-native SVG brand and demo assets under `assets/`.

### Security

- Agent and assertion commands run without a shell and receive a minimal environment by default.
- Fixture symlinks and assertion path escapes are rejected.
- Captured output has a shared byte cap and secret-shaped values are redacted by default.

[Unreleased]: https://github.com/SiluPanda/harnesscheck/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/SiluPanda/harnesscheck/releases/tag/v0.1.0
