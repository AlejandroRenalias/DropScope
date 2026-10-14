# Independent review brief, round 4: one targeted fix

**For the user (plain words).** Codex's third review confirmed all earlier fixes and found one new problem: a count of secret-like text depended on the order of the input. That is fixed in commit `a843664`. This is a very small check of only that change. Same read-only setup; nothing needs to be pushed.

---

## 1. Target

- Repository: `AlejandroRenalias/DropScope`, local checkout, branch `claude/inspiring-ritchie-8n0iay`.
- **Exact commit under review:** `a84366415f1b81b58c969477f8126d4cf4c6f3b9`.
- Previously reviewed commit: `0102388ce5b78614fb77771f285891cdfdabd294`.
- Check first: `git rev-parse HEAD` must print the SHA above. If it does not, stop and say so.
- Read-only: do not edit, commit, push or change settings. Do not run `npm run forensics` against the default folder.
- Delta: `git diff 0102388 a843664 -- src test docs/schemas` (about 80 added and 10 removed lines, of which about 15 are source).

## 2. Scope

1. **Verify your round-3 finding is fixed** (section 3). Re-run your example (resource groups A,B versus B,A) and check that the counts and the whole history agree apart from the input hashes and the artifact id.
2. **Look for regressions and new defects** caused by this delta, with the same eight areas as the first brief (`docs/development/REVIEW_BRIEF_RUN_IMPORTER.md`, section 4). The change touches determinism and the secret-pattern scanner.
3. **Check the spec text that changed** against the code: section 3.4 (context key recipe), section 6.6 (when the scanner counts), section 10 (work budget), section 13.

## 3. Your round-3 finding and where the change is

| Your finding | Where to look |
| --- | --- |
| Major: secret-pattern counts depend on input order (resource reuse keyed by object identity, context deduplication keeps the first occurrence) | `src/run-emit.ts` (`resourceCache`, `resourceOf`, keyed by `resourceKey`), `src/trace-normalize.ts` (`resourceKey` on each normalized context) |

Your spec points and the test gaps:

- Section 3.4 now gives the exact recipe: the context key is the SHA-256 of the canonical serialization of `{"resource": R, "scope": S, "unknownCount": U}`, with R the SHA-256 of the resource's canonical serialization.
- Section 10 records the 4,000,000 built-value work limit.
- Section 13 now says "a new schema version".
- Section 6.6 now says the scanner counts once per distinct resource content (by hash) and once per distinct context's own content.
- Tests: the last `describe` block of `test/review-fixes.test.ts` has your example, 40 reorderings in both modes (groups, scopes, spans, equal-content distinct objects, duplicates, planted secrets) and a test that pins the key recipe and the context id order. They fail on the previous commit and pass on this one.

## 4. Facts about decisions and changes (verify, do not assume)

- `IMPORTER.version` is now `"4"` because the saved output can change (secret-pattern counts for some inputs).
- The scanner now counts a resource's content once per distinct content, where earlier versions counted it once per context (round 1) or once per shared object (round 2). Judge whether the new definition is sound and complete.
- Nothing else changed in the source.

Known residual limits stated by the author: Windows file attributes are still read from the path just before the open; stale temporary files use a ten-minute threshold. Still deferred: `LENGTH_ONLY` mode, a sanitized export, and the `.claude/settings.json` rule that denies development agents read access to the runs folder.

## 5. How to run the checks

```bash
npm run typecheck
npx vitest run test/run-events.test.ts test/strict-json.test.ts test/otlp-structure.test.ts test/trace-normalize.test.ts test/run-emit.test.ts test/run-reducer.test.ts test/run-files.test.ts test/run-store.test.ts test/run-cli.test.ts test/review-fixes.test.ts
```

Last known author result: typecheck clean, 549 tests passing in the full suite, 2 skipped. Report environmental failures separately.

## 6. Report format

1. **Verdict:** `APPROVE`, `APPROVE WITH CHANGES` or `REJECT`, with the SHA you reviewed.
2. **Status of your round-3 finding:** `fixed`, `partly fixed` or `not fixed`, with evidence.
3. **New findings**, most severe first: severity (`blocker`, `major`, `minor`), file and line, what is wrong, a concrete failing scenario, verified or suspected, and a suggested direction.
4. **Spec deviations** in the changed code or text.
5. **Test gaps** that matter.
6. **What you could not check**, and why.

No praise, no summary of the code, no style changes.
