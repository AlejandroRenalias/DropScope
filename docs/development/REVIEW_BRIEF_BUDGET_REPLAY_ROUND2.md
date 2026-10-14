# Independent review brief, budget replay round 2: fixes to your four findings

**For the user (plain words).** Codex's first review of budget replay found two major and two minor problems. All four are fixed in commit `207e4a4`. This is a short check of just those changes. Same read-only setup; nothing needs to be pushed.

---

## 1. Target

- Repository: `AlejandroRenalias/DropScope`, local checkout, branch `claude/inspiring-ritchie-8n0iay`.
- **Exact commit under review:** `207e4a439a7dff318ebf8f896223c176a2221a97`.
- Previously reviewed commit: `1e0ad6ebc569cd97a68455672e3a64cdc9ceb31c`.
- Check first: `git rev-parse HEAD` must print the SHA above. If it does not, stop and say so.
- Read-only: do not edit, commit, push or change settings. Do not run `npm run forensics` against the default runs folder.
- Delta: `git diff 1e0ad6e 207e4a4 -- src test` (about 150 added and 20 removed lines). Earlier code is unchanged and may be re-read.

## 2. Scope

1. **Verify each of your four findings is fixed** (section 3). Re-run your original inputs where you can. Report `fixed`, `partly fixed` or `not fixed`, with evidence.
2. **Find regressions and new defects** caused by this delta, in the areas of the first budget brief (`docs/development/REVIEW_BRIEF_BUDGET_REPLAY.md`, section 4): accounting, stop-point rules, time semantics, cost, wording, user input, consistency, performance, tests.
3. Judge whether the new wording and caveats are true and complete.

## 3. Your findings and where the change is

| # | Your finding | Where to look |
| --- | --- | --- |
| 1 | Major: terminal output can be manipulated (step titles printed unescaped by the `budget` command) | `src/run-cli.ts` (`titleOf`, the escaped report lines), `src/frontend/run-replay-model.ts` (`tidy`, used by `stepTitle`) |
| 2 | Major: elapsed time can decrease and understate the run | `src/budget-replay.ts` (`reached`, `maxElapsed`, header comment on duration) |
| 3 | Minor: cost formatting hides the amount that caused a breach | `src/budget-replay.ts` (`formatPico`) |
| 4 | Minor: estimated endings are presented as observed; caveats omit the limited checking points | `src/budget-report.ts` (`describeBreach` TIME case, `budgetCaveats`), `src/budget-replay.ts` (`estimatedEnds`) |

Your test gaps and what was done: full-content terminal-control cases (`test/budget-report.test.ts`, "never lets a trace put terminal control codes or a forged line into the report"); accepted histories with decreasing event times and the random test now asserting that tokens, steps and elapsed time never decrease (`test/budget-replay.test.ts`, "unusual times" and the random-case loop); estimated endings (`test/budget-replay.test.ts`, `test/budget-report.test.ts`); costs below one millionth (`test/budget-replay.test.ts`, `test/budget-report.test.ts`).

## 4. Facts about the changes (verify, do not assume)

- Elapsed time is now the greatest elapsed time reached so far, never the latest event's time. Breach detection is unchanged in outcome: the first event that makes the running maximum exceed the limit is also the first event whose own time exceeds it.
- A step end is "estimated" when `endNs` is null or differs from `endEffectiveNs` (a missing end, or an end before the start that the importer clamped).
- Titles from a trace are made one tidy line of at most 80 characters when the run model is built (control and bidirectional characters become spaces), and the command escapes every report line again before printing.
- `formatPico` now shows up to 12 decimals (the full precision of tokens times a micro-priced rate), trailing zeros trimmed, at least 2 decimals.
- A test-only change outside the feature: `test/evaluation-baseline.test.ts` has a 30 s timeout instead of the 5 s default, because it timed out under load twice in full runs.

Known limits stated by the author (unchanged): no future spend, retry or rate-limit model; a call's cost is unknown before it runs; clock skew between machines is not corrected. Still deferred: `LENGTH_ONLY` mode, a sanitized export, and the `.claude/settings.json` rule for the runs folder.

## 5. How to run the checks

```bash
npm run typecheck
npx vitest run test/budget-replay.test.ts test/budget-report.test.ts test/run-replay-model.test.ts
npx playwright test e2e/run-replay.spec.ts e2e/run-replay-visual.spec.ts
```

Last known author result: typecheck clean, 603 unit tests passing with 2 skipped in the full suite, 20 browser tests passing. Report environmental failures separately.

## 6. Report format

1. **Verdict:** `APPROVE`, `APPROVE WITH CHANGES` or `REJECT`, with the SHA you reviewed.
2. **Status of each of your four findings.**
3. **New findings**, most severe first: severity (`blocker`, `major`, `minor`), file and line, what is wrong, a concrete failing scenario, verified or suspected, and a suggested direction.
4. **Wording or caveats** that are untrue, incomplete or misleading.
5. **Test gaps** that matter.
6. **What you could not check**, and why.

No praise, no summary of the code, no style changes.
