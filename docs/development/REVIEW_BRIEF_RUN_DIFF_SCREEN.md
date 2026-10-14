# Independent review brief: run diff screen (browser-safe fingerprints and report helpers)

**For the user (plain words).** The run diff only worked on the command line. This change puts it on the Replay screen. To do that, the fingerprint code in the diff (`run-diff.ts`) could not use Node-only tools any more, so I swapped them for a small hand-written SHA-256 (the fingerprint function) that runs in a browser. `run-diff.ts` took four review rounds before, so any change to it gets a fresh independent review. The screen itself is presentation and is not what you are asked to judge; the fingerprint code and the shared wording are. Same read-only setup as before.

---

## 1. Target

- Repository: `AlejandroRenalias/DropScope`, branch `claude/run-diff-screen`.
- **Exact commit under review:** `7b1d0763f11fcc2eae02ca9be5ee9fbf5666a42a`. (A later commit adds only documentation, this brief and one line-ending rule in `.gitattributes`.)
- Check first: `git rev-parse 7b1d076` must print the SHA above, else stop and say so.
- Diff: `git diff f5083b7 7b1d076 -- src test` (the base is `origin/main` at `f5083b7`).
- Read-only: do not edit files, commit, push, or change settings. Do not run `npm run forensics` against the default runs folder or open any saved-run location.
- Treat the author's account below as claims to verify.

## 2. What changed

1. **`src/sha256-pure.ts` (new).** SHA-256 over bytes, no Node modules. `sha256HexPure(text)` hashes the UTF-8 bytes of a string.
2. **`src/run-diff.ts`, three lines only.** It imported `sha256Hex` from `canonical.js` (Node `createHash`) and used `Buffer.byteLength`. It now imports `canonicalJson` from `canonical-json.js` and `sha256HexPure`, and measures length with `new TextEncoder().encode(text).length`. The fingerprint string format (`<byte length>:<hex>`) must stay exactly the same, because a withheld value stores the same format when a run is imported, and the diff compares the two.
3. **`src/run-diff-report.ts`.** `changeText` is now exported. `diffVerdictLine` and `diffCountsLine` are new exported helpers; `diffReportLines` (the command line) is rebuilt from them. Its output must be byte-for-byte what it was.
4. **A third demo run** (`demo-run-variant.runlog.jsonl`, its source trace, `test/fixtures/make-demo-run.ts` now builds two traces). The existing two demo files must be unchanged by the refactor of the generator.
5. **The screen** (`src/frontend/run-diff-panel.tsx`, `load-error.ts`, small wiring in `replay-screen.tsx` and `run-replay.tsx`, CSS). It calls `diffRuns` and the report helpers in the browser.
6. Tests: `test/sha256-pure.test.ts`, additions to `test/run-diff.test.ts` and `test/run-replay-model.test.ts`, `e2e/run-diff.spec.ts` with two new picture baselines, and one existing picture (`run-replay`) updated because the page grew by the new card.

## 3. What to examine (report only actionable findings; say verified or suspected)

1. **Is `sha256-pure.ts` correct?** It must equal Node's SHA-256 for every input. Look at padding at every length (especially 55, 56, 63, 64, 65 bytes and multiples of 64), the 64-bit length field, 32-bit arithmetic (signed versus unsigned shifts, `| 0`), the round constants, and very large inputs (string content can be up to 8 MiB per the spec limits). Is the length computation safe for sizes near 2^31? Does it ever change its input?
2. **Is the fingerprint format identical?** Compare the old and new expression in `src/run-diff.ts` for strings with non-ASCII text, lone surrogates (`TextEncoder` replaces them with U+FFFD, `Buffer.byteLength` counts them as 3 bytes: is that the same?), and the empty string. A mismatch would make a run kept with content look different from the same run kept as fingerprints only. Is there any input the importer can produce where old and new differ?
3. **Does `run-diff.ts` now run in a browser?** It must import no Node module, directly or through `canonical-json.js`, `run-replay-model.js` or `run-events.js`. Check the import graph the screen pulls in (`vite build` succeeds, but also look for Node globals such as `Buffer`, `process`, `node:` imports in that graph).
4. **Is the command line output unchanged?** `diffReportLines` was rebuilt from helpers. Look for any change in text, blank lines, ordering, or the too-large and identical cases.
5. **Do the screen and the command say the same thing?** The screen shows its own shorter row text (`shortChange` in `run-diff-panel.tsx`) next to the shared verdict and counts lines. Does any short phrase say something the diff result does not support (for example a wrong direction A versus B in the status change, or a token figure shown the wrong way round)? Check `STATUS` (a is "failed" or "succeeded"), the token arrows, and rows for steps present in only one run.
6. **Is the demo variant honest?** It is synthetic, invented content. Check that the generator refactor kept the old demo outputs identical (the drift tests) and that the variant differs from the demo only as described (the second refund attempt times out, final answer and its token counts differ).
7. **Display limits.** The screen draws at most 300 rows and folds runs of 2 or more matching steps. Can a difference be hidden without the screen saying so? (For example rows beyond the cap, or a difference inside a folded group; the folded groups contain only matching steps.)
8. **Untrusted input in the screen.** Titles and names come from run files. Are they only ever rendered as text, never as markup or in attributes that run? Is the 128 MiB file check enforced before reading? Are error messages free of file content?
9. **Tests.** The author planted six bugs in `sha256-pure.ts` (a rotation constant, a shift amount, the padding size, the length byte order, the end marker byte, a round constant); all six were caught. Name any other bug in the fingerprint, the report helpers or the folding logic that the tests would miss.

## 4. How to run the checks

```bash
npm run typecheck
npx vitest run test/sha256-pure.test.ts test/run-diff.test.ts test/run-diff-cli.test.ts test/run-replay-model.test.ts
npm test
```

`npm run test:e2e` needs Chrome and Windows picture baselines; it is not required for this review.

Last known author result: typecheck clean; build succeeds; 724 unit tests pass with 3 skipped; 67 end-to-end tests pass.

## 5. Report format

1. **Verdict:** `APPROVE`, `APPROVE WITH CHANGES` or `REJECT`, with the SHA you reviewed.
2. **Findings**, most severe first: severity, file and line, what is wrong, a concrete failing input, verified or suspected, suggested direction.
3. **Test gaps** that matter.
4. **What you could not check**, and why.

No praise, no summary of the code, no style changes.

## 6. Prompt to paste into Codex

> You are an independent read-only reviewer. In this repository, first run `git rev-parse 7b1d076` and stop if it does not print `7b1d0763f11fcc2eae02ca9be5ee9fbf5666a42a`. Then read `docs/development/REVIEW_BRIEF_RUN_DIFF_SCREEN.md` and review exactly that commit as it describes. Do not edit, commit or push anything, and do not run `npm run forensics`. Answer in the report format of section 5.
