# DropScope Progress

Concise running report. Update it at each stage: what was done, validation, what remains, risks. Historical Codex-era usage lives in the frozen [`USAGE_LOG.md`](USAGE_LOG.md).

## Current status (2026-10-13)

**Phase:** command-center UI redesign on branch `claude/editorial-ui` (local, awaiting approval to push and open a PR). The Codex-to-Claude Code migration is merged (PR #46). The seven-day roadmap has not been created yet.

### Done

- Engine (Milestone 1A): scheduler, event store, reducer and recovery, budget ledger, evidence audit and scoring, tribunal, blind review, divergence detection, risk policy, synthetic fixtures.
- Research Office UI foundation (Milestone 1B) and local runtime bridge (merged as PR #45).
- Milestone 2 groundwork: subscription-worker contract, preflight, protocol fake, Google Trends pilot, Failure Autopsy and Product Investigation pilots.
- Public-release documentation drafts and MIT license (Milestone 6 groundwork).
- Migration (PR #46): agent-neutral `AGENTS.md`, `CLAUDE.md`, rewritten workflow and templates, minimal `.claude/settings.json`, temporary sprint exception.
- Command-center UI on `claude/editorial-ui` (presentation only; the engine, contracts and policies are untouched):
  - light cobalt-on-white design with one accent and one alert colour, self-hosted IBM Plex, approved brief in `docs/design/DROPSCOPE_FRONTEND_DIRECTION.md`;
  - persistent frame (top bar with live status and event counter, side rails) on all six screens;
  - Research Office constellation and inspector, Mission Replay scrubber, Final Report verdict briefing, Agent Desk provenance chain, Review Office score radar and revision path, Tribunal Room courtroom, polished first-mission panel;
  - nine reviewed `win32` visual baselines committed.

### Validation (latest, on the branch)

Typecheck clean; 316 unit tests (47 files); build succeeds; 27 of 27 Playwright e2e tests pass (stable over repeated runs). Screens were also reviewed at 1440px and 390px for every fixture, including the guarded-action tiles (Google Trends pilot) and the held-out, insufficient-evidence and no-review states.

### In progress

- Awaiting approval to push `claude/editorial-ui` and open a PR. Optional: a Codex review of keyboard and accessibility behaviour of the constellation and scrubber.

### Remaining

- Seven-day roadmap and MVP definition (not yet written).
- Milestones 2 to 6 of `DROPSCOPE_FINAL_PROJECT_PLAN.md` as scoped by the sprint MVP.
- Preserved on the local backup branch only: isolated design prototypes, five policy drafts, `LEARNING.md`, the `design-taste-frontend` skill; decide their value later.
- Restore the PR template's learning-record item if the learning workflow resumes after the sprint.

### Open risks

- Frozen product plan still names Codex as the local worker runtime (Milestone 2); decide separately whether the MVP keeps that runtime.
- Visual snapshots are `win32`-only, e2e needs Chrome installed, and CI does not run e2e.
- Replay chronology still shows raw event type names; Autopsy and Investigation reports were only checked through the existing e2e assertions, not visually.
- `CLAUDE.md` still mentions "Terra" in an example line; changing it needs independent review under `AGENTS.md`.
