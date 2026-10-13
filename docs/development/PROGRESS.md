# DropScope Progress

Concise running report. Update it at each stage: what was done, validation, what remains, risks. Historical Codex-era usage lives in the frozen [`USAGE_LOG.md`](USAGE_LOG.md).

## Current status (2026-10-13)

**Phase:** Codex-to-Claude Code migration (configuration only). No product code changed. The seven-day roadmap has not been created yet.

### Done

- Engine (Milestone 1A): scheduler, event store, reducer and recovery, budget ledger, evidence audit and scoring, tribunal, blind review, divergence detection, risk policy, synthetic fixtures. Typecheck, build, and 296 unit tests (45 files) pass on `origin/main`; the preserved unfinished UI work brings this to 299 tests (46 files).
- Research Office UI foundation (Milestone 1B) and local runtime bridge (merged as PR #45).
- Milestone 2 groundwork: subscription-worker contract, preflight, protocol fake, Google Trends pilot, Failure Autopsy and Product Investigation pilots.
- Public-release documentation drafts and MIT license (Milestone 6 groundwork).
- Migration: agent-neutral `AGENTS.md`, `CLAUDE.md`, rewritten workflow and templates, minimal `.claude/settings.json`, temporary sprint exception.

### In progress / preserved, not yet on main

- Editorial command-desk UI (`410dbfb`, unpushed) and an unfinished clean-research layout pass, preserved on the local branch `backup/codex-handoff-2026-10-13`.
- Isolated design prototypes, five policy drafts, `LEARNING.md`, and the `design-taste-frontend` skill: preserved on the backup branch only; purpose and value still to be decided.

### Remaining

- Land the editorial UI on a clean branch from `origin/main`, with build and e2e validation and reviewed snapshots. Restore the PR template's learning-record item if the learning workflow resumes after the sprint.
- Seven-day roadmap and MVP definition (not yet written).
- Milestones 2 to 6 of `DROPSCOPE_FINAL_PROJECT_PLAN.md` as scoped by the sprint MVP.

### Open risks

- Frozen product plan still names Codex as the local worker runtime (Milestone 2); decide separately whether the MVP keeps that runtime.
- `docs/design/DROPSCOPE_FRONTEND_DIRECTION.md` still refers to "Terra"; update when the UI work lands.
- Visual snapshots (currently only on the backup branch) are `win32`-only, e2e needs Chrome installed, and CI does not run e2e.
