# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-02-07

### Added

- `schemaVersion` and `toolVersion` fields in summary JSON output
- `--format` flag: output as `json`, `html`, or `md`
- Markdown report formatter (`--format md`)
- Backward-compatibility contract tests for summary JSON schema
- Integration test against local fixture server (no network dependency)
- Consumer example workflow for action usage
- `outputs` in `action.yml` (`status`, `summary-path`)
- Automated release workflow (tag → GitHub release + major tag)
- Architecture overview and comparison section in README
- Programmatic API documentation in README

### Changed

- Harden `action.yml` input handling (array quoting, env vars)
- Action usage references `@main` until first stable tag

### Fixed

- Shell injection risk in `action.yml` from unquoted inputs

## [0.1.0] - 2025-01-15

### Added

- CLI entrypoint with Commander (`wqg audit <url>`)
- Playwright smoke runner with deterministic screenshot capture
- axe-core accessibility scanning with severity-level counts
- Lighthouse performance auditing with budget enforcement
- Visual regression diffing with pixelmatch and baseline management
- Zod-based config validation with security limits
- HTML report generation with inline CSS
- JSON summary output with pass/fail status per step
- SSRF protection via URL and hostname validation
- Path traversal prevention for output directories
- SHA-256 baseline integrity verification
- CI workflow with PR comment posting
- Dependabot configuration for automated dependency updates

[0.2.0]: https://github.com/Jahrome907/web-quality-gatekeeper/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Jahrome907/web-quality-gatekeeper/releases/tag/v0.1.0
