# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- A `dropscope` command: `npx dropscope <command>` after `npm install` in a clone (or `npm link`). It runs the same commands as `npm run forensics` (`import`, `state`, `budget`, `claims`, `diff`).
- A "Works with" table for common trace emitters, with synthetic fixtures and tests.
- Browser tests run on Linux in CI (picture comparisons stay Windows only).
- Linting and formatting with Biome (`npm run lint`, `npm run format`), checked in CI.
- A contributing guide and issue forms.

### Changed

- Run files use schema version 3 (contract v1.1, [ADR-029](docs/adr/ADR-029-name-mapping-for-common-emitters.md)). The importer now reads the step kinds and token counts that OpenInference, OpenLLMetry and the LangSmith export write, and records in each step which attribute it used. Version 2 run files still open.

- The package declares Node.js 22.12 or newer.
- React, Radix and the icon set are development dependencies: they are bundled into the web build, and the command does not use them.
