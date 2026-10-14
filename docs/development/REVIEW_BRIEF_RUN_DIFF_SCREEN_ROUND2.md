# Independent review brief: run diff screen, round 2 (the round 1 repair only)

**For the user (plain words).** The first review approved the run diff screen with two small changes. I made both: (1) when someone opens a folded group of matching steps, the card could draw thousands of rows, so the row cap now covers those too; (2) a size calculation in the hand-written fingerprint code could fail for inputs near 2 GiB (far above the accepted file sizes), so it now uses ordinary arithmetic. I also added tests, including one that pins the whole command-line report text. This is the short second review, about that change only. Same read-only setup as before.

---

## 1. Target

- Repository: `AlejandroRenalias/DropScope`, branch `claude/run-diff-screen`.
- **Exact commit under review:** `3ed26a90572938f3015188edfb3fe8e5a852e433`. (A later commit adds only documentation.)
- Check first: `git rev-parse 3ed26a9` must print the SHA above, else stop and say so.
- Diff: `git diff 7b1d076 3ed26a9`.
- Read-only: do not edit files, commit, push, or change settings. Do not run `npm run forensics` or open any saved-run location.
- Context: `REVIEW_BRIEF_RUN_DIFF_SCREEN.md` and your round 1 report. Treat the author's account as claims to verify.

## 2. What changed

1. **Row cap (round 1 finding P2).** New pure module `src/frontend/run-diff-layout.ts`: `foldEntries` folds runs of 2 or more matching steps; `limitEntries` applies one shared budget of 300 rows to drawn rows and to the steps inside opened groups. `hidden` counts every step or row not drawn. `run-diff-panel.tsx` now uses them, draws only `entry.drawn` steps of an opened group, and its notice says how many steps are not shown and that the command line diff has the full list.
2. **Padding size (round 1 finding P3).** `src/sha256-pure.ts` exports `paddedSize(length) = Math.ceil((length + 9) / 64) * 64` and uses it instead of the shift expression.
3. **Tests.** `test/run-diff-layout.test.ts` (fold rules, the 300 boundary, 5,000 matching steps opened, one shared budget, hidden counts); a `paddedSize` test in `test/sha256-pure.test.ts` (boundaries, including 2^31 - 64, 2^31, 2^32); two whole-output report tests in `test/run-diff.test.ts` (demo against variant, and two matching runs) so whitespace, ordering and blank lines are pinned.

## 3. What to examine (actionable findings only; say verified or suspected)

1. Your round 1 examples: two identical 5,000-step runs, group opened. How many rows are drawn now, and does the card say what is not shown? (The logic is in `limitEntries`; the component only maps its result.)
2. Is `limitEntries` correct? Consider a budget that runs out exactly at a group boundary, an opened group when the budget is already 0, closed groups after the budget is spent (counted as hidden, not drawn), the order of rows, and whether the count in the notice matches what is not drawn. Can a difference (a non-matching step) be hidden without the notice?
3. Is `paddedSize` right for every length, including 0, 55, 56, 63, 64 and past 2^31? Does `sha256Bytes` stay correct (the output must equal Node's for all lengths; the existing tests compare with Node for lengths 0 to 200 and larger sizes)? Is there any remaining 32-bit overflow in `sha256Bytes` for large inputs (for example `view.setBigUint64`, `padded.set`, offsets)?
4. Do the whole-output report tests pin the real current output (compare with the code), and would they catch a change in a blank line, a semicolon or ordering? The author planted these bugs: dropping the blank line after the run ids (2 tests fail) and dropping a semicolon in the counts line (1 test fails).
5. Layout tests: the author planted seven bugs in `run-diff-layout.ts` and `paddedSize` (an unbounded opened group, a missing hidden count for an opened group, a missing budget decrement, a missing hidden count for a closed group after the budget is spent, a missing hidden count for rows, a fold threshold off by one, the old padding expression); all seven are caught. Name any other bug these tests miss.

## 4. How to run the checks

```bash
npm run typecheck
npx vitest run test/run-diff-layout.test.ts test/sha256-pure.test.ts test/run-diff.test.ts test/run-diff-cli.test.ts
npm test
```

Last known author result: typecheck clean; build succeeds; 734 unit tests pass with 3 skipped; 67 end-to-end tests pass.

## 5. Report format

1. **Verdict:** `APPROVE`, `APPROVE WITH CHANGES` or `REJECT`, with the SHA you reviewed.
2. **Findings**, most severe first: severity, file and line, what is wrong, a concrete failing input, verified or suspected, suggested direction.
3. **Round 1 findings:** fixed or not, one line each.
4. **Test gaps** that matter.
5. **What you could not check**, and why.

No praise, no summary of the code, no style changes.

## 6. Prompt to paste into Codex

> You are an independent read-only reviewer. In this repository, first run `git rev-parse 3ed26a9` and stop if it does not print `3ed26a90572938f3015188edfb3fe8e5a852e433`. Then read `docs/development/REVIEW_BRIEF_RUN_DIFF_SCREEN_ROUND2.md` and review exactly that commit as it describes. Do not edit, commit or push anything, and do not run `npm run forensics`. Answer in the report format of section 5.
