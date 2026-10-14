# Independent review brief: run diff, round 3 (the round 2 repairs only)

**For the user (plain words).** Round 2 found three problems and some weak tests. I fixed them and added tests. This is the short third review, only about those fixes. This is also the last allowed attempt on this feature without coming back to you. Same read-only setup as before.

---

## 1. Target

- Repository: `AlejandroRenalias/DropScope`, branch `claude/run-diff`.
- **Exact commit under review:** `87ebe49e47bf963678090732508cd637df26ce03`. (A later commit adds only documentation.)
- Diff: `git diff ffd8409 87ebe49 -- src test`. Check first: `git rev-parse 87ebe49` must print the SHA above, else stop and say so.
- Read-only: do not edit files, commit, push, or change settings.
- Context: `REVIEW_BRIEF_RUN_DIFF.md`, `REVIEW_BRIEF_RUN_DIFF_ROUND2.md`, and the end of `docs/development/PROGRESS.md` ("Review record: run diff, round 2"). Treat the author's account as claims to verify.

## 2. What changed (one line per round-2 finding)

1. **Log content lost record boundaries.** Content from log records is now kept as one entry per record holding everything that record carried (field, key, ordinal, fingerprint), compared as an ordered list. An attribute moving from one record to another is now a `CONTENT` change with the field name "log records".
2. **Unproven parent change in the large-run fallback.** When the runs were too different to line up in full (`fullyAligned: false`), a parent that sits in the un-lined part has no partner. Such steps are no longer reported as `PARENT`; they are counted in `unverifiedNesting` (result, `--json`, and a note in the report). When the runs line up in full, behaviour is unchanged.
3. **The "Not compared" note contradicted the comparison.** Matching text now says it uses kind, operation, model name, tool and agent name. The not-compared note now lists: step time, step events, log record times and severities, log records that carry no content, attributes that are neither a matching name nor recorded content, and content of log records with no step.
4. **Tests.** New tests aim at the five mutations you found surviving (operation fingerprint, agent name, label, sorting repeated content, dropping repeated identical content), log boundaries, the fallback parent, and the aligned case.

## 3. What to examine

Report only actionable findings, each with a concrete input and whether you **verified** or only **suspect** it.

1. For each of the three findings: rerun your original example and say whether it is fixed.
2. **Log records.** Can two honest imports of the same data produce different record order or item order (so equal runs look different)? Are logs with no content, logs whose step is missing, and two logs on one step handled as the note says? Is anything compared that is not listed, or listed but not compared?
3. **Unverified nesting.** Is the rule `!fullyAligned && (parent unmatched on either side)` right? Can it hide a real nesting change (miss), or still call an equivalent parent changed? Check parents inside the trimmed prefix or suffix, a parent that is top-level on one side only, and counting (`unverifiedNesting` counts steps, not parents).
4. **Wording.** Do the matching sentence and the not-compared note now describe the code exactly? Does the result sentence ("match step for step in ...") still hold?
5. **Tests.** The author reran a mutation check with 19 planted bugs; 17 are caught, 2 survive. The author believes both survivors are equivalent: (a) sorting items inside one log record (the key already carries the ordinal, so only a hand-reordered file could differ and it means the same recorded content), and (b) removing `kind` from the signature (the label always begins with the kind). Verify both claims, and name any other planted bug you can find that the tests miss. Note that in round 2 the author wrongly called the operation-fingerprint survivor equivalent; it is now caught by a test.

## 4. How to run the checks

```bash
npm run typecheck
npx vitest run test/run-diff.test.ts test/run-diff-cli.test.ts
npm test
```

Last known author result: typecheck clean; build succeeds; 710 unit tests pass with 3 skipped.

## 5. Report format

1. **Verdict:** `APPROVE`, `APPROVE WITH CHANGES` or `REJECT`, with the SHA you reviewed.
2. **Findings**, most severe first: severity, file and line, what is wrong, a concrete failing scenario, verified or suspected, suggested direction.
3. **Round-2 findings:** fixed or not, one line each.
4. **Test gaps** that matter.
5. **What you could not check**, and why.

No praise, no summary of the code, no style changes.

## 6. Prompt to paste into Codex

> You are an independent read-only reviewer. In this repository, first run `git rev-parse 87ebe49` and stop if it does not print `87ebe49e47bf963678090732508cd637df26ce03`. Then read `docs/development/REVIEW_BRIEF_RUN_DIFF_ROUND3.md` and review exactly that commit as it describes. Do not edit, commit or push anything. Answer in the report format of section 5.
