# Independent review brief: run importer, reducer and run store

**For the user (plain words).** This is the handout for the independent reviewer (Codex). It says exactly which version of the code to read (commit `110e4bc`), what the code is supposed to do, which parts are risky, and how to report back. It does not say the code is good; the reviewer decides that. You run Codex yourself on your machine, in this same folder, read-only. Nothing needs to be pushed for this review.

---

## 1. Target

- Repository: `AlejandroRenalias/DropScope`, local checkout, branch `claude/inspiring-ritchie-8n0iay`.
- **Exact commit under review:** `110e4bcaab99b0be10709d33d073ade93550dcc4`.
- Base for the diff: `1c14d09` (documents only; no product code before it for this feature).
- Check first: `git rev-parse HEAD` must print the SHA above. If it does not, stop and say so.
- You are **read-only**: do not edit files, commit, push, or change settings. Writing under the operating system temp folder by running tests is fine. Do **not** run `npm run forensics` against the default folder (it creates `%LOCALAPPDATA%\DropScope\runs`).

## 2. What was built

A local, offline tool that imports an OpenTelemetry (OTLP/JSON) trace of an AI agent run, turns it into a deterministic run-event history, saves it as a file, and can rebuild the recorded state at any step. Default privacy mode `HASH_ONLY` must keep no prompt or other content in the saved file, only length and SHA-256.

Authoritative documents (read these first):

- `docs/adr/ADR-027-run-event-contract-and-trace-import-boundary.md` (accepted by the user, revision 3)
- `docs/schemas/run-event-contract-v1.md` (companion spec; amended several times with the user's approval, see section 5)
- `AGENTS.md` (review and approval rules)

Pipeline, in order, with the spec sections each file implements:

| Stage | Files | Spec |
| --- | --- | --- |
| Event schemas | `src/run-events.ts` | 3, 5, 12 |
| Strict JSON parser | `src/strict-json.ts`, `src/run-import-error.ts` | 1.1, 1.2, 10 |
| OTLP structure check | `src/otlp-structure.ts` | 1.3 to 1.7, phase 2 |
| Canonical form and hashing | `src/canonical.ts` | 3.2, 3.4 |
| Normalization (trace selection, duplicates, parents, times) | `src/trace-normalize.ts` | phases 3 to 6, 4 |
| Privacy tables | `src/run-privacy.ts` | 6.2 |
| Classification, ordering, event emission | `src/run-emit.ts`, `src/run-import.ts` | 4 to 8, phase 7 |
| Reducer and admission | `src/run-reducer.ts` | 8, 9 |
| Safe file access, runs folder | `src/run-files.ts` | 11.1, 11.2 |
| Run-file format, atomic publication | `src/run-store.ts` | 11.3 to 11.5 |
| Command line | `src/run-cli.ts` | 11.6 |
| Tests | `test/run-events`, `strict-json`, `otlp-structure`, `trace-normalize`, `run-emit`, `run-reducer`, `run-files`, `run-store`, `run-cli` | all |

Diff to review: `git diff 1c14d09 110e4bc -- src test package.json .gitattributes docs/schemas` (about 4,300 added lines of source and tests).

## 3. Why independent review is required

`AGENTS.md` requires it for security, persistence, recovery, state-transition and architecture work. This change handles untrusted input, writes files, and defines a state machine.

## 4. What to examine

Report only actionable findings. For each, give a concrete input or sequence that shows the problem where possible, and say whether you **verified** it (ran it, or traced the code to a definite result) or only **suspect** it.

1. **Untrusted input.** Can any input crash the process, hang it, use unbounded memory, or exceed the limits in spec section 10 without failing closed? Look for recursion over input structure, quadratic behavior, regular-expression backtracking, unbounded string or array growth, integer and number handling (exactness above 2^53, negative zero, uint64 and int64 bounds), prototype-pollution paths (`__proto__`, `constructor`).
2. **Privacy.** In `HASH_ONLY` mode, can any content (span names, status messages, event names, trace state, link data, unknown fields, attribute keys or values, resource and scope data, schema URLs, log bodies and attributes, severity text, event names, error messages, notes) reach the saved file or terminal output in readable form? Check the classification in `src/run-emit.ts` and `src/run-privacy.ts` against spec section 6, and the re-check in the reducer. Look for any string that is retained without being classified, and any path where a note detail or error message includes input text.
3. **Determinism and identity.** Does permuting spans or log records within an input leave the emitted history unchanged (except where the spec says the input hash and `artifactId` change)? Are ordering rules (spec 4) complete and total? Are there ties that fall back to input position?
4. **State transitions.** Does `validateRunHistory` enforce every rule in spec section 9? Can a history that violates the spec be accepted, or a valid importer output be rejected? Is `stateAt(n)` correct for every n, including checkpoint boundaries?
5. **Persistence.** In `src/run-store.ts`: atomicity, no overwrite, behavior on crash at each step, the temporary-file handling, race with a second importer, idempotent reuse, validation of what is on disk, file naming and identity.
6. **Filesystem boundary.** In `src/run-files.ts`: path, link, junction, device, stream, network, cloud-placeholder and size rules; ordering of checks (including time-of-check to time-of-use); the Windows and POSIX implementations; the owner-only folder (`icacls`, `Get-Acl`); command execution (arguments, environment, absolute paths).
7. **Spec conformance.** List every place where the code and the spec disagree, whether or not it is listed in section 5 below.
8. **Tests.** Tests that pass for the wrong reason, missing adversarial cases, and spec rules with no test.

## 5. Facts about decisions already made (verify, do not assume)

Spec amendments approved by the user during the build:

1. `E_SYNTAX` added to the error codes (malformed JSON, BOM, trailing bytes, duplicate key, wrong JSON type).
2. A log record `body` of exactly `{}` is treated as "no body" (real instrumentation writes it). All other AnyValue rules stay strict.
3. Unknown properties on envelope objects (request, resource group, scope group, resource, scope, span event, link, status) are counted, not stored. A JSON `null` inside a kept unknown property fails closed.
4. Log body is recorded as `ContentRecorded` with field `gen_ai.other`, key `log.body`, ordinal 0; log attributes moved to content use their attribute ordinal plus one. `WITHHELD_ATTRIBUTE` meaning and the schema URL that is compared are defined in the spec table.

Choices made in code that the spec does not state (judge them):

- Context ids are `c0`, `c1`, ... assigned after sorting canonical contexts by content.
- Some note details carry an extra `scope` or `role` key; `UNKNOWN_FIELD` for logs carries `logOrdinal`.
- Stale temporary files are removed only when older than 10 minutes.
- The reducer also re-checks HASH_ONLY privacy on read, which goes beyond spec section 9.
- Link data is treated as content as a whole.
- `ImportError` carries a fixed `reason` label (importer-chosen, never input text).
- On non-Windows platforms the file-attribute check returns "none" and the folder check uses the mode bits.

Deferred by decision (out of scope for this review): `LENGTH_ONLY` mode, a sanitized export for sharing, and the `.claude/settings.json` rule that denies development agents read access to the runs folder.

## 6. Out of scope

The frontend, the mission engine and its policies, formatting and style, and any change to frozen architecture documents.

## 7. How to run the checks

Node 24 matches CI. From the repository root:

```bash
npm run typecheck
npx vitest run test/run-events.test.ts test/strict-json.test.ts test/otlp-structure.test.ts test/trace-normalize.test.ts test/run-emit.test.ts test/run-reducer.test.ts test/run-files.test.ts test/run-store.test.ts test/run-cli.test.ts
```

Some tests call Windows PowerShell and `icacls` and create folders under the temp directory. Report an environmental failure separately from a code defect. The author's own claims about results are in `docs/development/PROGRESS.md`; treat them as claims to verify.

## 8. Report format

1. **Verdict:** `APPROVE`, `APPROVE WITH CHANGES` or `REJECT`, with the SHA you reviewed.
2. **Findings**, most severe first. For each: severity (`blocker`, `major`, `minor`), file and line, what is wrong, a concrete failing scenario, verified or suspected, and a suggested direction (not a patch).
3. **Spec deviations** found (section 4, item 7).
4. **Test gaps** (section 4, item 8).
5. **What you could not check**, and why.

Do not include praise or a summary of the code. Do not propose style changes.
