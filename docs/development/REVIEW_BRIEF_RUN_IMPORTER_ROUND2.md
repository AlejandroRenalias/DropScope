# Independent review brief, round 2: fixes to the run importer, reducer and store

**For the user (plain words).** Codex rejected the first version (commit `110e4bc`). The fixes are now in commit `32743bd`. This handout asks Codex to check two things: that each of its own findings is really fixed, and that the fixes did not break or open something new. It is the same read-only setup as before. Nothing needs to be pushed.

---

## 1. Target

- Repository: `AlejandroRenalias/DropScope`, local checkout, branch `claude/inspiring-ritchie-8n0iay`.
- **Exact commit under review:** `32743bd35539fa6a2cd6ad130409bea782991725`.
- Previously reviewed commit: `110e4bcaab99b0be10709d33d073ade93550dcc4`.
- Check first: `git rev-parse HEAD` must print the SHA above. If it does not, stop and say so.
- You are **read-only**: do not edit files, commit, push, or change settings. Do **not** run `npm run forensics` against the default folder.
- Delta to review: `git diff 110e4bc 32743bd -- src test docs/schemas` (about 770 added and 120 removed lines). The rest of the code is unchanged since your first review; you may re-read any of it.

## 2. Scope of this round

1. **Verify each of your 11 findings** (listed in section 3) is fixed, by reading the change and, where you originally had a failing input, running it again against this commit. Report each as `fixed`, `partly fixed` or `not fixed`, with evidence.
2. **Find regressions and new defects** introduced by the delta, using the same eight areas as the first brief (`docs/development/REVIEW_BRIEF_RUN_IMPORTER.md`, section 4). Pay most attention to code that is new or rewritten.
3. **Check the spec text** that changed (`docs/schemas/run-event-contract-v1.md`) against the code.

Out of scope: anything not touched by the delta unless a changed line makes it wrong; frontend; style.

## 3. Your findings from round 1 and where the change is

Quoted from your report, with the files that now address them. Do not assume the fix is right.

| # | Your finding | Where to look |
| --- | --- | --- |
| 1 | Blocker: folder-permission check can fail open (empty access list accepted) | `src/run-files.ts` (`evaluateFolderAcl`, the `powershell` helper) |
| 2 | Blocker: stack overflow with many logs on one span | `src/run-emit.ts` (assembly loops, `make`, `account`) |
| 3 | Blocker: pipeline-wide memory and work limits missing | `src/run-import.ts`, `src/strict-json.ts` (`parseStrictJsonCounted`), `src/trace-normalize.ts` (context hashing), `src/run-emit.ts`, `src/run-store.ts` (`serializeRunLog`), `src/run-reducer.ts` (checkpoints) |
| 4 | Major: folder replaced by a junction between check and open | `src/run-files.ts` (`canonicalLocation`, `readInputFile`) |
| 5 | Major: privacy admission accepts content in unchecked fields; FULL relabelling | `src/run-reducer.ts` (`checkLabel`, `checkNoWithheld`), `src/run-events.ts` (note schemas, `contextIdSchema`), `src/run-privacy.ts` (`deriveLabel`) |
| 6 | Major: valid FULL imports cannot be read back | `src/run-store.ts` (`RUN_LOG_LINE_LIMITS`) |
| 7 | Major: resource and scope fields discarded and absent from duplicate identity | `src/otlp-structure.ts` (`readContext`), `src/run-events.ts`, `src/run-emit.ts`, `src/trace-normalize.ts` |
| 8 | Major: unknown log fields lose content and fingerprint | `src/otlp-structure.ts`, `src/run-events.ts` (`LogRecorded.unknownFields`), `src/run-emit.ts` |
| 9 | Minor: withheld-attribute byte count includes event names | `src/run-emit.ts` (`attributeList`) |
| 10 | Minor: unknown decimals bypass the 20-digit rule | `src/otlp-structure.ts` (`rawStep`) |
| 11 | Minor: all-zero link ids accepted | `src/otlp-structure.ts` (`readSpan`) |

Your other points: stale temporary files, POSIX behavior, the synced-root warning, note-detail keys beyond section 7, recursive schema validation, and the seven test gaps. Regression tests for the findings are in `test/review-fixes.test.ts`.

## 4. Facts about decisions and changes (verify, do not assume)

Decisions the user made after your report:

- Add the missing fields to the event format (`unknownFields` on log records, span events, resource and scope; `droppedAttributesCount` on resource and scope).
- On non-Windows platforms the importer refuses to run (`E_PLATFORM`, `UNSUPPORTED_PLATFORM`).

Changes beyond your findings (judge them):

- `IMPORTER.version` is now `"2"` because the saved format changed. `schemaVersion` stays `1` (nothing was released with the earlier shape).
- Span and log duplicate identity now uses the SHA-256 of the context serialization, not the full context. Context ids are assigned in the order of those hashes.
- Replay checkpoint spacing is `max(256, ceil(events / 64))`.
- Note schemas are per code; `UNKNOWN_FIELD` has four allowed detail shapes.
- Link unknown properties are kept inside the link's tagged list under `unknownFields`; status unknown properties inside the span's unknown list under the key `status`.
- The path check was first written to require that the real location equal the typed path. That rejected this machine's own default folder, because the Claude desktop app runs in a packaged sandbox that redirects `%LOCALAPPDATA%`. It now compares the real location with itself over time (before the open, after the open, after the read) and re-walks the components once after the first reading.
- Recursion in schema validation remains; it is bounded by the parser depth limit (256 for persisted logs, 64 for input).

Known residual limits stated by the author: Windows file attributes are still read from the path just before the open; Node cannot read them from the handle. The stale temporary file threshold is ten minutes.

Still deferred and out of scope: `LENGTH_ONLY` mode, a sanitized export, and the `.claude/settings.json` rule that denies development agents read access to the runs folder.

## 5. How to run the checks

```bash
npm run typecheck
npx vitest run test/run-events.test.ts test/strict-json.test.ts test/otlp-structure.test.ts test/trace-normalize.test.ts test/run-emit.test.ts test/run-reducer.test.ts test/run-files.test.ts test/run-store.test.ts test/run-cli.test.ts test/review-fixes.test.ts
```

Last known author result: typecheck clean, 528 tests passing in the full suite with 2 skipped. Some tests call Windows PowerShell and `icacls`, and create folders under the temp directory. If your sandbox blocks them, report that as environmental, as you did before.

## 6. Report format

1. **Verdict:** `APPROVE`, `APPROVE WITH CHANGES` or `REJECT`, with the SHA you reviewed.
2. **Status of each of the 11 findings:** `fixed`, `partly fixed` or `not fixed`, with evidence.
3. **New findings**, most severe first: severity (`blocker`, `major`, `minor`), file and line, what is wrong, a concrete failing scenario, verified or suspected, and a suggested direction.
4. **Spec deviations** in the changed code or text.
5. **Test gaps** that matter.
6. **What you could not check**, and why.

No praise, no summary of the code, no style changes.
