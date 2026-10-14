# Handoff for the next session (rewritten 2026-10-15)

A new chat starts from a fresh clone and does not remember the previous conversation. Read this file, then `CLAUDE.md`, `AGENTS.md`, `docs/development/WORKING_PRINCIPLES.md` and the end of `docs/development/PROGRESS.md` (the build log and the review records).

## Where things stand

- **This repository is public (2026-10-15).** `AlejandroRenalias/DropScope` was made public on 2026-10-15 after the checks in `docs/PUBLIC_RELEASE_CHECKLIST.md`, and its history is the rewritten one described next. The earlier repository, with the full old history, all its pull requests (#1 to #58) and its branches, was renamed `AlejandroRenalias/DropScope-archive` and kept **private** as an archive. Public pull requests restart at #1: #1 is the public release wording, #2 the `npm audit fix` (merge commit `a6056ee`; `npm audit` reports 0 vulnerabilities). GitHub secret scanning and push protection were switched on by the owner.
- **About this repository's history (2026-10-15):** this repository was created from the earlier private repository's `main` history only, with the author name and email of the owner's older commits rewritten (every commit ID therefore differs from the original). The commit IDs, pull request numbers (#48 to #58) and branch names quoted in this file, in `PROGRESS.md` and in other development notes refer to that earlier private repository; they will not match the IDs here. The file contents are identical. Six early documentation commits keep a `Claude-Session:` link in their message and `Claude` as author; the owner chose to keep them.
- **Repository:** AlejandroRenalias/DropScope. **Pull requests #48 and #49** (https://github.com/AlejandroRenalias/DropScope/pull/48, https://github.com/AlejandroRenalias/DropScope/pull/49) were **merged into `main` on 2026-10-14** with the user's approval (#48 as merge commit `9784085`, #49 as `6339838`). Everything described below, including run diff, is now on `main`. The branch `claude/inspiring-ritchie-8n0iay` was kept (not deleted). **Pull requests #52 (ADR-028 and the runs folder rule), #53 (UI fixes) and #54 (the run diff screen)** were also **merged into `main` on 2026-10-14** with the user's approval, each as a merge commit pinned to its tested head (#52 `8402dbc`, #53 `0dca340`, #54 `2ad29da`); their branches were kept. Nothing is half-built and no review is pending. Start new work from `main` on a new branch. A local branch `tmp/merge-rehearsal` may exist on the user's machine; it is a throwaway and was never pushed.
- **Do not touch:** the `codex/*` branches, `backup/codex-handoff-2026-10-13`, `claude/migration-config`. `.claude/launch.json` on the user's machine is theirs; never commit it.
- **Direction:** DropScope is a **learning project** (the user's choice, repeated several times). The idea is "agent run forensics": a local, offline, deterministic auditor for AI agent runs. It imports an OTLP/JSON trace, saves a validated run file, rebuilds the recorded state at any step, and re-applies a budget to the run. Dropshipping is only the built-in demo domain. No live workers, no model calls, no API cost, no network.
- **Sprint exception:** in effect until 2026-10-31 (see `AGENTS.md`). On 2026-10-14 the user decided **not to extend it**: it expires at 00:00 on 2026-10-31 and all engineering gates then continue unchanged. The learning workflow stays paused; the user decided not to resume it.
- **Release prep (phase 6, 2026-10-14):** `README.md` and `docs/GUIDED_TOUR.md` were added (docs only; see PROGRESS, "Release prep and final gates", which also compares the roadmap's eight acceptance criteria with the evidence and lists the honest gaps). They were merged as pull request #56 (and the final-gates check with it).
- **Final whole-project review (2026-10-15):** two independent read-only reviews with one brief (`REVIEW_BRIEF_FINAL_PROJECT.md`): Claude Opus 5.5 (a fresh subagent) and Codex Sol 6.1 (run by the user), at commit `99bc048`. Every finding was reproduced before it was changed. The fixes (wrong claim-check and diff answers, free text in the run file header, network paths with mixed separators, stale file reads in the browser, wrong wording in documents) went in as **pull request #57**, merged into `main` on 2026-10-15 as merge commit `d529c9a`, pinned to the tested head `052e175` (CI `verify` passed on that exact commit; the branch `review/final-whole-project` was kept). Two delta reviews by Sol followed (`REVIEW_BRIEF_FINAL_PROJECT_FIXES*.md`); the last repair (`1d6bbcf`) was **not** independently reviewed, by the user's choice. ADR-027, the contract and the proposal got wording corrections with the user's approval. See the end of `PROGRESS.md` for the full record and the "Open items" list.

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
| Run diff | `src/run-diff.ts`, `src/run-diff-report.ts`, `diff` command | compares two run files: matches steps by their full recorded identity in tree order (not by id), finds the first difference, then nesting, outcome, status message, token counts and content including log records (by fingerprint, so a run kept with content and one kept without compare fine). Time is in the totals only. Command line, and a card on the Replay screen (`src/frontend/run-diff-panel.tsx`, `run-diff-layout.ts`) that shows the steps side by side. It needed a browser-safe SHA-256 (`src/sha256-pure.ts`) so `run-diff.ts` runs in a browser; the screen's row cap and its notice share limits with the command (`DIFF_TEXT_LIMIT`, `DIFF_JSON_LIMIT`). The third demo run `demo-run-variant` (second refund also fails) feeds it. **Independently reviewed: four Codex rounds, the last one approved (`eb47e85`).** |
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

Last known results (on the public `main` at `a6056ee`): typecheck clean, 759 unit tests (3 skipped), 85 end-to-end tests, build succeeds. CI runs on Ubuntu and skips the Windows-only file-safety tests, so run `npm test` locally on Windows too.

## How reviews were done (repeat for new risky work)

`AGENTS.md` requires independent read-only review for security, persistence, budget accounting, state transitions, untrusted input. The user runs **Codex gpt-6.1-sol** on their machine. The lead agent writes a brief file in `docs/development/` (see `REVIEW_BRIEF_*.md`: exact commit SHA, scope, areas to examine, decisions to judge, report format, no conclusions), gives the user a short prompt that makes Codex check `git rev-parse HEAD` first, and the user pastes the report back. The lead agent reproduces every finding before fixing it, groups fixes by theme, adds a regression test per finding, then asks for a short review of the delta. At most two implementation attempts per workstream, then stop and bring options to the user (for claim check the user approved a third attempt). Record each round in `PROGRESS.md`. Importer: 4 rounds. Budget replay: 2 rounds. Claim check: 3 rounds. All ended approved. Final whole-project review: 2 models, then 2 delta rounds (the user approved a third repair pass and skipped the last review).

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
- **Run diff:** done. Built, independently reviewed (four Codex rounds, approved in round 4) and **merged into `main` on 2026-10-14** as pull request #49 (https://github.com/AlejandroRenalias/DropScope/pull/49), a regular merge commit `6339838` of the tested head `99e08c5` (CI `verify` passed on that exact commit); the branch `claude/run-diff` was kept. The screen was added later (see the table above; pull request #54). Claim checking is done and reviewed. The proposal and `ROADMAP.md` dates are only indicative now.
- Small UI items: done and merged as pull request #53 (see PROGRESS, "UI visual check"): Mission Replay chronology names, held-out reason wording, task card overlap. The Failure Autopsy and Product Investigation reports were checked visually; nothing else was found.
- Skipped for now by the user (2026-10-14): opening run files from the runs folder without a file picker (a local file server would open a new route to the data and conflict with ADR-028; a browser folder permission would be safer), and setting up the real-trace boundary (only needed if real traces are wanted).
- **Left open by the final review (decided not worth doing now, all logged in `PROGRESS.md`):** the importer drops a resource or scope group with no spans without a note (needs a contract change, an `IMPORTER.version` bump and regenerated demo files); the secret scan can be made about 10 times slower by crafted text; a file on a mapped network drive letter is looked at by Windows before it is refused; the Windows-only tests do not run in CI (a Windows CI job would fix that); the run diff does not compare span names, ok-versus-unset status or links (now stated honestly in its "Not compared" note).
- **Going public: done (2026-10-15).** The checklist wording was rewritten for run forensics and independently reviewed (Codex Sol 6.1, three wording findings fixed), the pre-share checks passed on the exact commit in a fresh clone (typecheck, 759 unit tests, build, 85 end-to-end tests, `git diff --check`), and the owner approved the repository, license, wording, identity and commit before switching visibility. Nothing about publication is pending. Future changes still follow `AGENTS.md`; the sprint exception ends at 00:00 on 2026-10-31.
- Optional small items: a test that scans the forensics modules for network and process calls (criterion 6 has no automated guard); the Failure Autopsy activity feed shows a raw task name and its radar chart labels are tiny.

## Starter prompt for the new chat

> Read CLAUDE.md, AGENTS.md, docs/development/WORKING_PRINCIPLES.md, docs/development/HANDOFF_NEXT_SESSION.md and the end of docs/development/PROGRESS.md on the main branch. DropScope is a learning project and I am a beginner, so explain things in plain words with small examples. First run git fetch origin and create a new working branch from origin/main, then summarize the state in a few lines. Then ask me what to do next (the product plan is complete and the remaining items are optional; see "Still open"; anything that touches real traces needs a plain-language design that respects ADR-028 and my approval first). Do not push, merge or open anything without my approval.
