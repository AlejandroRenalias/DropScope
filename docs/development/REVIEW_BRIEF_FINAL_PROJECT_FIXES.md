# Independent review brief: fixes after the final whole-project review

**For the user (plain words).** Two models reviewed the whole run forensics part and found problems. The lead agent fixed the ones about wrong answers, privacy and file safety in one commit. This brief asks a fresh reviewer to check only that commit: are the fixes right, did they break anything, and are the tests real? It does not ask for a new review of the whole project.

---

## 1. Target

- Repository `AlejandroRenalias/DropScope`, local branch `review/final-whole-project`.
- **Commit under review:** `83993d2` (run `git log --oneline -3` first; stop if `83993d2` is not there). HEAD is the next commit, which only adds this brief. The parent of `83993d2` is `99bc048`. Review `git diff 99bc048 83993d2`.
- **Read-only.** Do not edit, commit or push in the repository. A temporary copy outside it may be changed (for example to plant bugs and see whether the tests notice).
- Do not run `import` or open `%LOCALAPPDATA%\DropScope`. Use demo data only (ADR-028).
- Treat the author's notes (the "Final whole-project review" section at the end of `docs/development/PROGRESS.md`) as claims to verify.

## 2. What changed, and what each change should do

| Change | Files | Intended behaviour |
| --- | --- | --- |
| Claim check, withheld tool name | `src/claim-check.ts`, `claim-report.ts` | A claim naming a tool is "Cannot check" (reason `TOOL_NAME_WITHHELD`) instead of "Not supported" when any step has a tool name kept only as a fingerprint |
| Run diff, tool use | `src/run-diff.ts` | Tool-use counts use the recorded tool name's fingerprint, not the shortened display title. Too-large runs keep their real totals |
| Run diff, wording | `src/run-diff-report.ts` | The "Not compared" note and the verdict line say what is and is not compared (span names, ok-versus-unset status, links and trace state are not) |
| Header fields | `src/run-events.ts` | `importer.id`, `importer.version`, `conventionVersion`, `limitsVersion` accept only shapes the importer writes |
| Network paths | `src/run-files.ts` | A path starting with any two of `/` and `\` is refused before the file system is touched, and again after resolving |
| Stale reads | `src/frontend/replay-screen.tsx`, `run-diff-panel.tsx`, `claim-check-panel.tsx` | A file that finishes reading after a newer choice (file, demo, clear, edit) is dropped |
| Notes and errors | `src/frontend/run-replay-model.ts`, `load-error.ts` | The secret-text note depends on the content mode; the "withheld in a full run" load error says the right thing |
| Command line | `src/run-cli.ts` | Off Windows every command prints an error and exits 1; `state --at` out of range prints a usage error and exits 2 |
| Documents | `README.md`, `docs/GUIDED_TOUR.md`, `PROGRESS.md`, `HANDOFF_NEXT_SESSION.md` | Corrected statements |
| Tests | `test/final-review-fixes.test.ts`, `test/run-files.test.ts`, `test/run-cli.test.ts`, `test/run-diff.test.ts`, `e2e/final-review.spec.ts` | One regression test or more per finding |

## 3. Questions

1. **Are the fixes correct and complete?** For each row above, find an input where the fix still gives the wrong answer or breaks something nearby. Especially: the claim check (a `stepId` claim, several claims, claims on a run with content, a tool name that is readable but a different step has a withheld one); the diff tool counts (two runs where one tool's name is withheld in only one file, steps with no tool name); the header patterns (are all legitimate historical values still accepted, including every committed run file and the importer's own output?); the path rule (any legitimate Windows path newly refused, such as `C:/a/b` or a relative path; any network form still reaching the file system).
2. **Did a fix change an answer elsewhere?** Compare the `state`, `budget`, `claims`, `diff` commands on the three demo run files before and after (`git stash` is not allowed; use a copy of the repository at `99bc048`). Any difference in output other than the intended wording is a finding.
3. **Is the wording now true?** Check each changed sentence in `README.md`, `docs/GUIDED_TOUR.md` and `PROGRESS.md` against the code.
4. **Are the new tests real?** Plant a bug in a copy for each fix (for example: restore the title-keyed tool count, drop the `unnamedTools` check, loosen a header pattern, remove the second path check, remove the counter in one panel) and report which survive. For the browser tests, say whether the ordering tests can pass by luck.

Out of scope: the findings the author deliberately left open (listed under "Open items" in the PROGRESS section), and anything not in the diff.

## 4. How to run the checks

```bash
npm run typecheck
npm test               # last author result: 753 passed, 3 skipped
npm run build
npx playwright test e2e/final-review.spec.ts   # optional; needs Chrome
```

## 5. Report format

1. **Verdict:** `APPROVE`, `APPROVE WITH CHANGES` or `REJECT`, with one paragraph.
2. **Findings**, most severe first, at most 10: severity (`high`, `medium`, `low`), file and line, what is wrong, a concrete failing input, **verified** or **suspected**, suggested direction.
3. **Planted bugs:** a list of what you planted and whether the tests caught it.
4. **What you could not check.**

No praise, no summary of the code, no style changes.

## 6. Prompts

**Codex:**

> You are an independent read-only reviewer. In this repository, first run `git log --oneline -3` and stop if commit `83993d2` is not listed (HEAD may be one later commit that only adds the brief). Then read `docs/development/REVIEW_BRIEF_FINAL_PROJECT_FIXES.md` and review the commit as it describes. Do not edit the repository (a temporary copy outside it is allowed), commit or push anything, and do not run import or open `%LOCALAPPDATA%\DropScope`. Answer in the report format of section 5.
