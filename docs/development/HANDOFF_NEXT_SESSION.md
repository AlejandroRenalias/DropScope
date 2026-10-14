# Handoff for the next session (rewritten 2026-10-14)

A new chat starts from a fresh clone and does not remember the previous conversation. Read this file, then `CLAUDE.md`, `AGENTS.md`, `docs/development/WORKING_PRINCIPLES.md` and the end of `docs/development/PROGRESS.md` (the build log and the review records).

## Where things stand

- **Repository:** AlejandroRenalias/DropScope. **Pull requests #48 and #49** (https://github.com/AlejandroRenalias/DropScope/pull/48, https://github.com/AlejandroRenalias/DropScope/pull/49) were **merged into `main` on 2026-10-14** with the user's approval (#48 as merge commit `9784085`, #49 as `6339838`). Everything described below, including run diff, is now on `main`. The branch `claude/inspiring-ritchie-8n0iay` was kept (not deleted). Nothing is half-built and no review is pending. Start new work from `main` on a new branch.
- **Do not touch:** the `codex/*` branches, `backup/codex-handoff-2026-10-13`, `claude/migration-config`. `.claude/launch.json` on the user's machine is theirs; never commit it.
- **Direction:** DropScope is a **learning project** (the user's choice, repeated several times). The idea is "agent run forensics": a local, offline, deterministic auditor for AI agent runs. It imports an OTLP/JSON trace, saves a validated run file, rebuilds the recorded state at any step, and re-applies a budget to the run. Dropshipping is only the built-in demo domain. No live workers, no model calls, no API cost, no network.
- **Sprint exception:** in effect until 2026-10-31 (see `AGENTS.md`). The learning workflow stays paused; the user decided not to resume it.

## What was built (ADR-027 accepted, revision 3)

| Piece | Files | Notes |
| --- | --- | --- |
| Event schemas | `src/run-events.ts` | `schemaVersion` is **2** (version 1 was an unreleased draft and is rejected) |
| Strict JSON parser, OTLP structure check | `src/strict-json.ts`, `src/otlp-structure.ts` | iterative, bounded, exact integers |
| Normalization, privacy classification, event emission | `src/trace-normalize.ts`, `src/run-privacy.ts`, `src/run-emit.ts`, `src/run-import.ts`, `src/canonical*.ts` | default `HASH_ONLY` (content kept only as size and SHA-256); `IMPORTER.version` is **4** and must change whenever the importer's output changes |
| Reducer (state at any step) | `src/run-reducer.ts` | validates every history, re-checks privacy on read |
| Safe file access, write-once store, CLI | `src/run-files.ts`, `src/run-store.ts`, `src/run-log-format.ts`, `src/run-cli.ts` | Windows only in v1 (other platforms refuse); runs go to `%LOCALAPPDATA%\DropScope\runs` |
| Replay screen for imported runs | `src/frontend/replay-screen.tsx`, `run-replay.tsx`, `run-replay-model.ts`, `run-replay.css`, `assets/demo-run.runlog.jsonl` | reads a run file in the browser with a file picker; the original mission replay is unchanged |
| Claim check | `src/claim-check.ts`, `src/claim-report.ts`, `src/frontend/claim-check-panel.tsx`, `claims` command, `src/frontend/assets/demo-run-full.runlog.jsonl` | the user writes a claims file (`tool` or `stepId`, optional `field`, `mustContain`, `caseSensitive`, `atEvent`); verdicts Supported, Not supported, Cannot check. Only content a run file stored can be checked (default import withholds it, so those claims say "cannot check"); each text must sit inside one recorded value; work is bounded by a cost model (`CLAIM_LIMITS`). "Supported" means "appears in the recording", never "true". |
| Run diff | `src/run-diff.ts`, `src/run-diff-report.ts`, `diff` command | compares two run files: matches steps by their full recorded identity in tree order (not by id), finds the first difference, then nesting, outcome, status message, token counts and content including log records (by fingerprint, so a run kept with content and one kept without compare fine). Time is in the totals only. Command line only so far (no screen). **Independently reviewed: four Codex rounds, the last one approved (`eb47e85`).** |
| Budget replay (counterfactual) | `src/budget-replay.ts`, `src/budget-report.ts`, `src/frontend/budget-replay-panel.tsx`, `budget` command | exact whole-number arithmetic; wording is "would have stopped" |

The spec is `docs/schemas/run-event-contract-v1.md` (amended several times with the user's approval; each change is recorded in `PROGRESS.md`). Product proposal: `docs/development/PROPOSAL_AGENT_RUN_FORENSICS.md`. Phases 0 to 3 of the proposal (the approved cut line) are done: import, state at any step, replay, budget replay.

## Commands

```bash
npm run typecheck && npm test && npm run build      # CI runs typecheck and test
npm run test:e2e                                    # Playwright; needs Chrome; works inside the sandbox here
npm run forensics -- import <spans.json> [--logs <logs.json>] [--trace <id>] [--full]
npm run forensics -- state <run file> [--at N]
npm run forensics -- budget <run file> --max-total-tokens 4000 [--max-seconds 8 ...] [--json]
npm run forensics -- claims <run file> --claims <claims.json> [--json]   # needs a run imported with --full to read content
npm run forensics -- diff <run A> <run B> [--json]                  # where do two runs first differ?
npx tsx test/fixtures/make-demo-run.ts              # regenerates the demo run (a test fails if it drifts)
```

Last known results: typecheck clean, 717 unit tests (3 skipped), 59 end-to-end tests, build succeeds.

## How reviews were done (repeat for new risky work)

`AGENTS.md` requires independent read-only review for security, persistence, budget accounting, state transitions, untrusted input. The user runs **Codex gpt-6.1-sol** on their machine. The lead agent writes a brief file in `docs/development/` (see `REVIEW_BRIEF_*.md`: exact commit SHA, scope, areas to examine, decisions to judge, report format, no conclusions), gives the user a short prompt that makes Codex check `git rev-parse HEAD` first, and the user pastes the report back. The lead agent reproduces every finding before fixing it, groups fixes by theme, adds a regression test per finding, then asks for a short review of the delta. At most two implementation attempts per workstream, then stop and bring options to the user (for claim check the user approved a third attempt). Record each round in `PROGRESS.md`. Importer: 4 rounds. Budget replay: 2 rounds. Claim check: 3 rounds. All ended approved.

## Rules to keep

- The lead agent commits explicit paths only (never `git add -A`, `git add .`, `git commit -a`). Local commits are fine.
- **Never push, open or merge a PR, delete a branch, or publish without the user's explicit approval for that action.** Show what would be pushed first.
- Visual snapshots: show the new image to the user and wait for approval before committing a baseline; never regenerate to get green.
- Frozen architecture, ADRs and policies change only through a new ADR with the user's approval. Spec amendments were done with the user's approval each time; ask first.
- Any change to what the importer writes must bump `IMPORTER.version`; a change in the saved format's shape bumps `schemaVersion`.
- **Communication:** the user is a beginner. Plain words, define every term, lead with the conclusion, and explain each feature with a small concrete example and a "why it matters" (saved as a memory file). Keep summaries short. No em dashes.

## Practical gotchas

- Shell: long Bash commands with quotes and apostrophes inside heredocs sometimes fail to parse. Write scripts to the scratchpad folder with the Write tool and run them instead.
- This machine runs the Claude desktop app in a packaged sandbox that redirects `%LOCALAPPDATA%` to a private copy. Do not rely on the typed path equalling the real path.
- Repo is under OneDrive: stop dev servers when done (`preview_stop`).
- `npm run build` warns that the JavaScript bundle is above 500 kB; harmless for a local tool.
- A full unit run is slower now; `test/evaluation-baseline.test.ts` has a 30 s timeout for that reason.

## Still open

- **Real-trace boundary (ADR-028, accepted 2026-10-14):** the `.claude/settings.json` rule that denies development-agent reads of the saved runs folder is in place as a best-effort precaution only. Independent review showed a settings rule cannot be a real boundary (a command can build the path, and it does not cover Codex). Real traces stay excluded until an operating-system boundary exists (for example a separate Windows account) and passes the acceptance test in ADR-028. Use synthetic and demo traces only. Note: any shell command whose text names both the product folder and the runs folder is denied, even harmless ones; use file tools or other wording.
- **Pull request #48:** merged (see top of this file). Nothing left to do for it.
- **Run diff:** done. Built, independently reviewed (four Codex rounds, approved in round 4) and **merged into `main` on 2026-10-14** as pull request #49 (https://github.com/AlejandroRenalias/DropScope/pull/49), a regular merge commit `6339838` of the tested head `99e08c5` (CI `verify` passed on that exact commit); the branch `claude/run-diff` was kept. Command line only; an optional screen like the other features is not built. Claim checking is done and reviewed. The proposal and `ROADMAP.md` dates are only indicative now.
- Small UI items: done on branch `claude/ui-visual-check` (see PROGRESS, "UI visual check"): Mission Replay chronology names, held-out reason wording, task card overlap. The Failure Autopsy and Product Investigation reports were checked visually; nothing else was found.
- Optional: open run files from the runs folder without a file picker (would need a design decision about serving local files).

## Starter prompt for the new chat

> Read CLAUDE.md, AGENTS.md, docs/development/WORKING_PRINCIPLES.md, docs/development/HANDOFF_NEXT_SESSION.md and the end of docs/development/PROGRESS.md on the main branch. DropScope is a learning project and I am a beginner, so explain things in plain words with small examples. First run git fetch origin and create a new working branch from origin/main, then summarize the state in a few lines. Then start on the first open item: the `.claude/settings.json` rule that denies development-agent reads of the saved runs folder (required by ADR-027 before real traces are admitted; it needs its own independent review). Do not push, merge or open anything without my approval.
