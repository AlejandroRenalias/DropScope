# Independent review brief: repair after the first review of the fixes (delta only)

**For the user (plain words).** Sol reviewed the fixes (commit `83993d2`) and found six problems: two wrong answers and four weak tests. The lead agent repaired them in commit `f20ab7c`. This brief asks a fresh reviewer to check only that repair. It is a short review, not a new look at the project.

## 1. Target

- Repository `AlejandroRenalias/DropScope`, local branch `review/final-whole-project`.
- **Commit under review:** `f20ab7c` (run `git log --oneline -6` first; stop if it is not listed). Review `git diff 83993d2 f20ab7c`. Later commits only change documents.
- **Read-only.** Do not edit, commit or push in the repository. A temporary copy outside it may be changed to plant bugs.
- Do not run `import` or open `%LOCALAPPDATA%\DropScope`. Demo data only (ADR-028).
- The author's notes ("Review record: fixes after the final review, round 1" at the end of `docs/development/PROGRESS.md`) are claims to verify.

## 2. What changed

| Earlier finding | Change | Files |
| --- | --- | --- |
| A nameless tool turned "Not supported / TOO_LATE" into "Cannot check" | The withheld-name rule now applies only when a nameless step recorded the claimed field at or before the claim's cutoff event | `src/claim-check.ts` |
| A step with two tool-name attributes was counted by the first name only | Diff counts use every tool name the step records | `src/run-diff.ts` |
| Browser privacy test checked storage names, not contents | Scan reads database records and cached response bodies; has a positive control; uses a valid claims file | `e2e/final-review.spec.ts` |
| Ordering tests used a timer and missed two panels | Reads are held and released by the test, for success and failure, in all three panels | `e2e/final-review.spec.ts` |
| Resolved network path check untested | Test with the current directory on a network share, asserting no file-system call | `test/final-review-fixes.test.ts` |
| Load-error sentence untested | Test for both sentences | `test/final-review-fixes.test.ts` |

## 3. Questions

1. **Is the claim rule right?** Find an input where a claim is still wrongly "Cannot check" or wrongly "Not supported" because of nameless tools: several nameless steps, a `stepId` claim, a different `field`, `atEvent` equal to the exact content event, a claim on a run with content stored, content recorded as several items.
2. **Is the diff count right?** Repeated tool names where only the order differs; a step with no tool name; tool names equal in one run's first attribute but different in the second; titles versus counts for the report and the screen. Does any demo comparison change? Compare `diff` output on the three demo files against a copy at `83993d2`.
3. **Are the tests real now?** Plant a bug for each row of section 2 and report which survive. For the browser tests, say whether any can pass without exercising the race, or whether the storage scan could miss a copy kept somewhere else (for example the Cache API under a different origin, `window.name`, `history.state`, a service worker).
4. **Did anything else change?** The diff should touch only the files in section 2 plus `PROGRESS.md`. Report anything else.

Out of scope: items the author left open (the "Open items" list in `PROGRESS.md`) and anything not in the diff.

## 4. Checks

```bash
npm run typecheck
npm test                                        # author: 757 passed, 3 skipped
npx playwright test e2e/final-review.spec.ts    # optional; needs Chrome; 10 tests
```

## 5. Report format

1. **Verdict:** `APPROVE`, `APPROVE WITH CHANGES` or `REJECT`, one paragraph.
2. **Findings**, most severe first, at most 8: severity, file and line, what is wrong, a concrete failing input, **verified** or **suspected**, suggested direction.
3. **Planted bugs:** what you planted and whether the tests caught it.
4. **What you could not check.**

No praise, no summary of the code, no style changes.

## 6. Prompt

> You are an independent read-only reviewer. In this repository, first run `git log --oneline -6` and stop if commit `f20ab7c` is not listed. Then read `docs/development/REVIEW_BRIEF_FINAL_PROJECT_FIXES_ROUND2.md` and review the commit as it describes. Do not edit the repository (a temporary copy outside it is allowed), commit or push anything, and do not run import or open `%LOCALAPPDATA%\DropScope`. Answer in the report format of section 5.
