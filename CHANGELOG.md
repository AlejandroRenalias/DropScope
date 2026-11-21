# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- A `dropscope` command: `npx dropscope <command>` after `npm install` in a clone, or `npm install -g github:AlejandroRenalias/DropScope`. It runs the same commands as `npm run forensics` (`import`, `state`, `budget`, `claims`, `diff`).
- A "Works with" table for common trace emitters, with synthetic fixtures and tests.
- Browser tests run on Linux in CI (picture comparisons stay Windows only).

### Changed

- The package declares Node.js 22.12 or newer.
- React, Radix and the icon set are development dependencies: they are bundled into the web build, and the command does not use them.
