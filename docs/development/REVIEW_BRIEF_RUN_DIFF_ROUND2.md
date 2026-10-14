# Independent review brief: run diff, round 2 (the repairs only)

**For the user (plain words).** Last time the reviewer rejected run diff: it could say two different recordings "match". I reproduced all six findings, fixed them, and added tests. This is the short second review. It only asks whether those six fixes really work and whether they introduced new problems. Same read-only setup as before.

---

## 1. Target

- Repository: `AlejandroRenalias/DropScope`, branch `claude/run-diff`.
- **Exact commit under review:** `ffd84091bd2a2b785a78eb38761fcc7f3f9e67ee`. (A later commit adds only documentation; do not review it.)
- Base for the diff: `f44047f` (the commit you rejected in round 1). `git diff f44047f ffd8409 -- src test`.
- Check first: `git rev-parse ffd8409` must print the SHA above. If it does not, stop and say so.
- Read-only: do not edit files, commit, push, or change settings.
- Round 1 brief for context: `docs/development/REVIEW_BRIEF_RUN_DIFF.md`. The author's record of the fixes is the section "Review record: run diff, round 1" at the end of `docs/development/PROGRESS.md`; treat it as claims to verify.

## 2. What changed (one line per round-1 finding)

1. **Titles hid different operations.** Steps are now matched by a signature of complete values: kind, label, operation name fingerprint, tool name fingerprint and agent name fingerprint (`factsByStep` in `src/run-diff.ts`). Titles are only for display.
2. **Nesting ignored.** For each matched pair, the parent must be the step matched to the other run's parent (never compared by id), else a new `PARENT` change.
3. **Repeated content overwritten.** Content is kept as a list per key in event order and the lists are compared.
4. **"Match" claimed too much.** Content on log records now counts for the step the log belongs to; status messages are compared (`STATUS_MESSAGE`); the result sentence and a new "Not compared" note state exactly what is and is not compared.
5. **`--json` cut silently.** New field `differencesOmitted`.
6. **Token note.** Reworded to "missing an input or an output token count".

## 3. What to examine

Report only actionable findings, each with a concrete input and whether you **verified** or only **suspect** it.

1. For each of the six findings: rerun your original example and say whether it is now fixed.
2. **New defects in the signature.** Does the signature now call two runs different when they are equivalent (false differences)? For example a field in the signature that varies between honest runs, an attribute order effect, a label that contains something volatile, or `operationName` in withheld versus stored form.
3. **Parent check.** Is `sameParent` right when the parent is unmatched (only in one run), when both parents are top-level, when a parent id points to a missing step, with repeated names, and with the unaligned fallback? Can it produce a `PARENT` change for a step whose parent really is equivalent, or miss one?
4. **Content and log lists.** Is attaching log content through `LogRecorded.stepId` right (a log whose step is null, two logs on one step with the same ordinal-0 body, log order)? Can list order differ between two honest imports of the same data (so equal runs look different)? Is the key still free of collisions?
5. **Wording.** Does the result sentence and the "Not compared" note now describe exactly what the code compares? Anything compared but not listed, or listed but not compared?
6. **JSON.** `differencesOmitted` correct at 999, 1,000, 1,001; text and JSON still agree.
7. **Tests.** The author ran a mutation check (10 planted bugs, 9 caught). The survivor, dropping the operation fingerprint from the signature, is believed equivalent because the label already contains the operation. Verify that claim, and say which other planted bugs would survive.

## 4. How to run the checks

```bash
npm run typecheck
npx vitest run test/run-diff.test.ts test/run-diff-cli.test.ts
npm test
```

Last known author result: typecheck clean; build succeeds; 702 unit tests pass with 3 skipped.

## 5. Report format

1. **Verdict:** `APPROVE`, `APPROVE WITH CHANGES` or `REJECT`, with the SHA you reviewed.
2. **Findings**, most severe first: severity, file and line, what is wrong, a concrete failing scenario, verified or suspected, suggested direction.
3. **Round-1 findings:** fixed or not, one line each.
4. **Test gaps** that matter.
5. **What you could not check**, and why.

No praise, no summary of the code, no style changes.

## 6. Prompt to paste into Codex

> You are an independent read-only reviewer. In this repository, first run `git rev-parse ffd8409` and stop if it does not print `ffd84091bd2a2b785a78eb38761fcc7f3f9e67ee`. Then read `docs/development/REVIEW_BRIEF_RUN_DIFF_ROUND2.md` and review exactly that commit as it describes. Do not edit, commit or push anything. Answer in the report format of section 5.
