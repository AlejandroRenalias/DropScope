# Independent review brief: budget replay

**For the user (plain words).** Budget replay is the feature that takes a budget you type (for example "at most 4,000 tokens") and shows where that limit would have been passed in a recorded agent run. Under `AGENTS.md`, budget accounting needs an independent review, and this is the handout for it. It says which commit to read, what the code is supposed to do, what to examine, and how to report. It does not say the code is right; the reviewer decides that. Same read-only setup as before, run in this folder on your machine. Nothing needs to be pushed.

---

## 1. Target

- Repository: `AlejandroRenalias/DropScope`, local checkout, branch `claude/inspiring-ritchie-8n0iay`.
- **Exact commit under review:** `1e0ad6ebc569cd97a68455672e3a64cdc9ceb31c`.
- Base for the diff: `cef2db3ba5099a6bd0513408ed1c8ef7700d486f` (the last commit pushed to GitHub, with the run importer, reducer, store and the first replay screen already reviewed or accepted).
- Check first: `git rev-parse HEAD` must print the SHA above. If it does not, stop and say so.
- Read-only: do not edit files, commit, push, or change settings. Do not run `npm run forensics` against the default runs folder.
- Diff to review: `git diff cef2db3 1e0ad6e -- src test e2e docs/development/PROGRESS.md` (about 1,400 added lines). Everything older is already reviewed and may be re-read.

## 2. What was built

Budget replay re-applies a budget that the user supplies to a recorded run, offline. It reads a run history that the reducer has already validated (`createReplay` / `parseRunLog`) and reports the first point at which a guard with those limits would have fired, and what would not have happened afterwards. It is **counterfactual**: DropScope never controls an agent, and the wording must say "would have stopped", never "stopped".

Files:

| Purpose | Files |
| --- | --- |
| Budget core (the accounting) | `src/budget-replay.ts` |
| Plain-language sentences, shared by the screen and the command line | `src/budget-report.ts` |
| Command line (`budget` command) | `src/run-cli.ts` (the `budget` branch and its flags) |
| Screen: form, result, gauges, timeline marker | `src/frontend/budget-replay-panel.tsx`, `src/frontend/run-replay.tsx`, `src/frontend/run-replay.css` |
| Tests | `test/budget-replay.test.ts`, `test/budget-report.test.ts`, `e2e/run-replay.spec.ts` (the "budget replay" block), `e2e/run-replay-visual.spec.ts` |

Product source for the feature: `docs/development/PROPOSAL_AGENT_RUN_FORENSICS.md` (phase 3: "User-supplied budget policy re-applied to the run: the first step where it would have been exceeded, and the counterfactual remainder"; risks: "Budget enforcement is counterfactual... the UI must say would have stopped, not stopped"). The run-event contract is `docs/schemas/run-event-contract-v1.md` (sections 8 and 9 define usage and state). There is no separate spec for budget replay; the rules are in the header comment of `src/budget-replay.ts`.

## 3. Why independent review is required

`AGENTS.md` lists budget accounting as review-required. The numbers shown to a user as "would have stopped here" and "this many tokens would not have been spent" must be right and must not overclaim.

## 4. What to examine

Report only actionable findings. For each, give a concrete input or sequence, and say whether you **verified** it (ran it, or traced it to a definite result) or only **suspect** it.

1. **Accounting correctness.** Totals of tokens, calls, steps and time: exactness (whole numbers only; token values near and beyond 2^53), strict "greater than" boundaries, zero limits, a metric the trace did not report, usage on non-model steps, repeated or out-of-order events in a history that the reducer accepts (for example end times before start times, equal times, parallel steps).
2. **The stop-point rules.** Are the three bases coherent (after-the-fact for tokens and cost, before-start for counts, time at step events)? Is the choice of the "first" breach across several limits well defined (ordering and ties)? Is the remainder (steps not started, steps in flight, tokens after the stop) consistent with those definitions, including when the stop falls in the middle of parallel steps or on a step that is itself the breaching one?
3. **Time semantics.** Elapsed time is measured from the earliest recorded step start and evaluated only at step start and step end events, using the importer's derived order and its repaired ("effective") end times. Is that defensible and clearly worded? What happens with unfinished spans (estimated ends), skewed clocks, and the largest 64-bit times?
4. **Cost.** Prices per million tokens in millionths of a currency unit, exact integer products, no rounding, comparison against the limit scaled by 10^6. Look for scaling, formatting, overflow or rounding mistakes, and for a place where a float sneaks in.
5. **Overclaiming and wording.** Does every sentence in `src/budget-report.ts`, the panel and the command output stay counterfactual and true? Are the caveats (usage is known only after a call, running steps cannot be recalled, prices are the user's, missing token counts) accurate and complete? Is anything shown that the recorded data cannot support?
6. **User input.** Parsing in `parseBudgetPolicy` (digits, separators, decimals, caps, currency), error messages that must not echo the input, and any place where typed text reaches output unescaped (the command line escapes terminal control characters elsewhere; check that this path cannot print raw input).
7. **Consistency.** The screen, the command line (including `--json`) and the module must give the same numbers. Check the shared code paths and whether anything is computed twice in different ways.
8. **Performance and limits.** Work per policy change on a run with up to 1,000,000 events (the screen recomputes while the user types), memory of the sparse series, behavior with very large token values and many events.
9. **Tests.** Tests that pass for the wrong reason. In particular: the independent oracle in `test/budget-replay.test.ts` was written by the same author from the same rules, so it can confirm the implementation matches the rules but cannot confirm the rules are right; judge the rules. Missing adversarial cases.

## 5. Decisions made in the build (verify, do not assume)

These are the author's decisions, not spec text. Judge them:

- Tokens and cost are charged at the usage record, and the stop point is just after it (the call already finished and its tokens are spent).
- A count limit is checked when a step starts; the step that would make the count exceed the limit would not have started.
- Duration is measured from the earliest step start, at step start and step end events only; the limit is inclusive (a step ending exactly at the limit is inside it).
- The "first breach" is the one with the earliest stop point; ties are listed as "also exceeded at the same point".
- Steps already running at the stop point are "in flight" and cannot be recalled; steps that start at or after it "would not have started". Tokens are attributed to those groups through the step the usage belongs to.
- A usage metric the trace did not report counts as zero and the result says how many model calls or records were affected.
- Whole-number limits accept up to 18 digits, decimals at most 12 integer digits, six decimal places for money, nine for seconds.
- The budget policy is not persisted; it lives in the page state and the command line flags.
- Tool calls, agent steps and non-model steps carry no tokens; steps count every kind.

Known limits stated by the author: the budget does not model future spend, retries or provider rate limits; it cannot know a call's cost before the call; clock skew between machines is not corrected (the importer notes it).

Out of scope: the importer, reducer and store (already reviewed in four rounds), the mission engine, visual design, and the deferred items (`LENGTH_ONLY` mode, sanitized export, the `.claude/settings.json` rule for the runs folder).

## 6. How to run the checks

Node 24 matches CI. From the repository root:

```bash
npm run typecheck
npx vitest run test/budget-replay.test.ts test/budget-report.test.ts test/run-replay-model.test.ts test/run-reducer.test.ts
npx playwright test e2e/run-replay.spec.ts e2e/run-replay-visual.spec.ts
```

The end-to-end tests need Chrome and may need to run outside a restricted sandbox; report an environmental failure separately from a code defect. Last known author result: typecheck clean; 597 unit tests passing with 2 skipped; 49 end-to-end tests passing. The author's own claims are in `docs/development/PROGRESS.md`; treat them as claims to verify.

## 7. Report format

1. **Verdict:** `APPROVE`, `APPROVE WITH CHANGES` or `REJECT`, with the SHA you reviewed.
2. **Findings**, most severe first. For each: severity (`blocker`, `major`, `minor`), file and line, what is wrong, a concrete failing scenario, verified or suspected, and a suggested direction (not a patch).
3. **Judgement of the decisions** in section 5: any you consider wrong or misleading.
4. **Test gaps** that matter.
5. **What you could not check**, and why.

No praise, no summary of the code, no style changes.
