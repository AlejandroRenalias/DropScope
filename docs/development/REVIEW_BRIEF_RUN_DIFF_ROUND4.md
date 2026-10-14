# Independent review brief: run diff, round 4 (the round 3 repair only)

**For the user (plain words).** Round 3 found one real problem in my last fix: for very different runs I said "nesting not checked" too often, which hid changes that could be proved. I fixed that and the weak tests. This is the short fourth review, about that change only. Same read-only setup as before.

---

## 1. Target

- Repository: `AlejandroRenalias/DropScope`, branch `claude/run-diff`.
- **Exact commit under review:** `eb47e858f245105e176006d95e649d6fa1171aaa`. (A later commit adds only documentation.)
- Diff: `git diff 87ebe49 eb47e85 -- src test`. Check first: `git rev-parse eb47e85` must print the SHA above, else stop and say so.
- Read-only: do not edit files, commit, push, or change settings.
- Context: `REVIEW_BRIEF_RUN_DIFF_ROUND3.md` and the end of `docs/development/PROGRESS.md` ("Review record: run diff, round 3"). Treat the author's account as claims to verify.

## 2. What changed

1. **Nesting rule when the runs were too different to line up in full (`fullyAligned: false`).** A matched step's nesting is "not checked" (counted in `unverifiedNesting`, no `PARENT`) only when both parents are real steps and neither has a partner. Otherwise it is decided: both top-level means same; exactly one top-level means changed; a paired parent must be paired with the other run's parent, else changed. When the runs line up in full the rule is unchanged (an unmatched parent is a change). See the comment and `unresolved` in `src/run-diff.ts`.
2. **Report note** reworded: "sit under parents that fell in the part that could not be lined up in either run".
3. **Tests added:** the two provable cases in both directions, the exact count (two children of one unmatched parent count 2), the count in `--json` and in the text report, an aligned run with two different parents, and repeated content in one log record in order.

## 3. What to examine

Report only actionable findings, each with a concrete input and whether you **verified** or only **suspect** it.

1. Rerun your round 3 examples (tail top-level on one side; one parent in the matched prefix and the other unmatched): fixed?
2. Is the new rule sound? Can it still call an equivalent nesting changed, or an actual change "not checked", in the fallback? Consider parents in the trimmed suffix, repeated step names, a parent paired to a step that is itself an ancestor of the other run's parent, and chains of unmatched ancestors.
3. Does the count `unverifiedNesting` match the number of steps affected, in text and `--json`?
4. Wording: does the note state exactly when nesting was not checked?
5. Tests: the author planted 23 bugs; 22 are caught and 1 survives (removing `kind` from the signature, believed equivalent because the label always begins with the kind). Verify, and name any other planted bug in the nesting, count or log-content code that the tests miss.

## 4. How to run the checks

```bash
npm run typecheck
npx vitest run test/run-diff.test.ts test/run-diff-cli.test.ts
npm test
```

Last known author result: typecheck clean; build succeeds; 716 unit tests pass with 3 skipped.

## 5. Report format

1. **Verdict:** `APPROVE`, `APPROVE WITH CHANGES` or `REJECT`, with the SHA you reviewed.
2. **Findings**, most severe first: severity, file and line, what is wrong, a concrete failing scenario, verified or suspected, suggested direction.
3. **Round 3 findings:** fixed or not, one line each.
4. **Test gaps** that matter.
5. **What you could not check**, and why.

No praise, no summary of the code, no style changes.

## 6. Prompt to paste into Codex

> You are an independent read-only reviewer. In this repository, first run `git rev-parse eb47e85` and stop if it does not print `eb47e858f245105e176006d95e649d6fa1171aaa`. Then read `docs/development/REVIEW_BRIEF_RUN_DIFF_ROUND4.md` and review exactly that commit as it describes. Do not edit, commit or push anything. Answer in the report format of section 5.
