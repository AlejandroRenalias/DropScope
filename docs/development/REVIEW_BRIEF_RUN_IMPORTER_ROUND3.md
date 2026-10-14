# Independent review brief, round 3: fixes to the findings of round 2

**For the user (plain words).** Codex's second review found 10 of 11 original issues fixed, and three new ones. All three are now addressed in commit `0102388`. This is a short check of just those changes. Same read-only setup; nothing needs to be pushed.

---

## 1. Target

- Repository: `AlejandroRenalias/DropScope`, local checkout, branch `claude/inspiring-ritchie-8n0iay`.
- **Exact commit under review:** `0102388ce5b78614fb77771f285891cdfdabd294`.
- Previously reviewed commit: `32743bd35539fa6a2cd6ad130409bea782991725`.
- Check first: `git rev-parse HEAD` must print the SHA above. If it does not, stop and say so.
- Read-only: do not edit, commit, push or change settings. Do not run `npm run forensics` against the default folder.
- Delta: `git diff 32743bd 0102388 -- src test docs/schemas` (about 280 added and 60 removed lines). Earlier code is unchanged and may be re-read.

## 2. Scope

1. **Verify each of your three round-2 findings** (section 3) is fixed. Re-run your original inputs where you can. Report `fixed`, `partly fixed` or `not fixed` with evidence.
2. **Find regressions and new defects** introduced by this delta, in the same eight areas as the first brief (`docs/development/REVIEW_BRIEF_RUN_IMPORTER.md`, section 4).
3. **Check the changed spec text** against the code.

## 3. Your round-2 findings and where the change is

| # | Your finding | Where to look |
| --- | --- | --- |
| 1 | Blocker: shared resource data multiplies memory and work (100,000-element resource under 30 scopes) | `src/otlp-structure.ts` (`readResource`, `readContext`, `WorkBudget`, `Structure.convert`), `src/trace-normalize.ts` (`resourceKeyOf`, `contextKeyOf`), `src/run-emit.ts` (`resourceCache`, `resourceOf`), `src/run-import.ts` (one shared work budget) |
| 2 | Major: the byte counter underestimates the saved output (327 logs of 1,024 attributes accepted, then rejected at serialization) | `src/run-emit.ts` (`accountBytes`, `account`, `EVENT_ENVELOPE_BYTES`, header accounting, `maxOutputBytes` option) |
| 3 | Major: the format changed without a new schema version | `src/run-events.ts` (`RUN_EVENT_SCHEMA_VERSION` is now 2), `src/run-reducer.ts` (`UNSUPPORTED_SCHEMA_VERSION`), spec sections 5, 3.6 and 13 |

Your other round-2 points and what was done:

- Spec versus ADR on recursion: the code was changed instead of the text. Tagged values are now validated by an explicit stack (`isTaggedValue` in `src/run-events.ts`), and the spec says no stage recurses. Decide whether anything else still recurses over untrusted structure, including zod's own object parsing and the native `JSON.parse` of a persisted line (which runs only after the strict parser has verified its depth, at most 256).
- Test gaps: resource arrays across many scopes, estimate versus real size near the limit (through the `maxOutputBytes` hook), maximum permitted nesting (57 levels accepted, 58 refused), and an explicit version-1 rejection. Tests are in the last `describe` blocks of `test/review-fixes.test.ts`, `test/run-events.test.ts` and `test/run-reducer.test.ts`.
- Your environment could not load the PowerShell permission command. The check now reads access rules through .NET (`Directory.GetAccessControl`) in `src/run-files.ts`. Say whether that works where you run it.

## 4. Facts about decisions and changes (verify, do not assume)

User decisions after your report:

- Bump to schema version 2. Version 1 is treated as a never-released draft: it is rejected with a clear reason, not read.

Changes beyond your findings (judge them):

- The context identity is now the SHA-256 of `{resource hash, scope, unknownCount}`; the resource is hashed once per resource object. Context ids (`c0`, `c1`, ...) are assigned in the order of those hashes.
- A work budget of 4,000,000 built values is shared by both input files (`DEFAULT_WORK_UNITS`).
- `IMPORTER.version` is now `"3"`. `artifactId` now also includes `schemaVersion`.
- The secret-pattern counts are taken once per resource, not once per context.
- Accounting uses a 96-byte envelope bound per event (the real envelope is at most 87 bytes) and 80 bytes per context.

Known residual limits stated by the author: Windows file attributes are still read from the path just before the open; stale temporary files use a ten-minute threshold. Still deferred: `LENGTH_ONLY` mode, a sanitized export, and the `.claude/settings.json` rule that denies development agents read access to the runs folder.

## 5. How to run the checks

```bash
npm run typecheck
npx vitest run test/run-events.test.ts test/strict-json.test.ts test/otlp-structure.test.ts test/trace-normalize.test.ts test/run-emit.test.ts test/run-reducer.test.ts test/run-files.test.ts test/run-store.test.ts test/run-cli.test.ts test/review-fixes.test.ts
```

Last known author result: typecheck clean, 545 tests passing in the full suite, 2 skipped. One unrelated existing mission test (`test/evaluation-baseline.test.ts`) once exceeded its 5-second limit under load and passed on rerun; ignore it unless you can show a link to this change. Report environmental failures separately.

## 6. Report format

1. **Verdict:** `APPROVE`, `APPROVE WITH CHANGES` or `REJECT`, with the SHA you reviewed.
2. **Status of each of the three round-2 findings.**
3. **New findings**, most severe first: severity (`blocker`, `major`, `minor`), file and line, what is wrong, a concrete failing scenario, verified or suspected, and a suggested direction.
4. **Spec deviations** in the changed code or text.
5. **Test gaps** that matter.
6. **What you could not check**, and why.

No praise, no summary of the code, no style changes.
