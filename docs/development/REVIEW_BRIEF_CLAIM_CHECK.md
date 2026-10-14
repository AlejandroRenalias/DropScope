# Independent review brief: claim check

**For the user (plain words).** Claim check is the feature where you write down what an agent claimed ("the order total was 59.00") and DropScope looks in the recorded content of one step for the exact texts you listed, then says Supported, Not supported or Cannot check. Under `AGENTS.md`, work like this needs an independent review: it reads files nobody has vetted, and it decides what counts as "supported". This is the handout for that review. It says which commit to read, what the code is meant to do, what to examine and how to report. It does not say the code is right; the reviewer decides that. Same read-only setup as before, run in this folder on your machine. Nothing needs to be pushed.

---

## 1. Target

- Repository: `AlejandroRenalias/DropScope`, local checkout, branch `claude/inspiring-ritchie-8n0iay`.
- **Exact commit under review:** `e672c7c3c72b9064cf4139fe3c10a875ef54f7be`.
- Base for the diff: `38348f9` (the commit before it; the run importer, reducer, store, replay screen and budget replay are already reviewed or accepted).
- Check first: `git rev-parse HEAD` must print the SHA above. If it does not, stop and say so.
- Read-only: do not edit files, commit, push, or change settings. Do not run `npm run forensics` against the default runs folder.
- Diff to review: `git diff 38348f9 e672c7c -- src test e2e docs/development/PROGRESS.md` (about 1,300 added lines, of which roughly 40% are tests).

## 2. What was built

The user supplies a claims file (JSON). For each claim, DropScope looks in the content that a run file stored, for the step the claim names, and reports whether every text the user listed appears there. No model is involved. A run imported in the default `HASH_ONLY` mode keeps only the size and fingerprint of content, so claims about it must come out as "Cannot check", never a guess. The rules are written at the top of `src/claim-check.ts` (rules 1 to 6); the claims file format is defined by `parseClaimFile` in the same file and summarised in `docs/development/PROGRESS.md` ("Claim checking").

| Purpose | Files |
| --- | --- |
| Core: claims file reader and the verdict rules | `src/claim-check.ts` |
| Plain-language sentences, shared by the screen and the command line | `src/claim-report.ts` |
| Command line (`claims` command, `--json`) | `src/run-cli.ts` (the `claims` branch) |
| Screen panel | `src/frontend/claim-check-panel.tsx`, `src/frontend/run-replay.tsx`, `src/frontend/replay-screen.tsx` (second demo button), `src/frontend/run-replay.css` |
| Demo with content stored | `src/frontend/assets/demo-run-full.runlog.jsonl`, `test/fixtures/make-demo-run.ts` |
| Tests | `test/claim-check.test.ts`, `test/claim-report.test.ts`, `test/run-replay-model.test.ts` (drift test), `e2e/claim-check.spec.ts`, `e2e/run-replay-visual.spec.ts` |

Product source: `docs/development/PROPOSAL_AGENT_RUN_FORENSICS.md` (phase 5: "Verify user-supplied or rule-extracted claims against captured tool outputs", with the risk "No content in traces... weakens claim checking"). The user chose, on 2026-10-14, to check only against stored content (no fingerprint matching). Run-event contract: `docs/schemas/run-event-contract-v1.md`. ADR-027 keeps claim events out of scope, so no event type or file format changed.

## 3. Why independent review is required

`AGENTS.md` lists correctness-sensitive work as review-required, and this feature parses an untrusted file (the claims file), reads untrusted run content, and prints text from both. A wrong "Supported" is worse than a missing feature.

## 4. What to examine

Report only actionable findings. For each, give a concrete input or sequence, and say whether you **verified** it (ran it, or traced it to a definite result) or only **suspect** it.

1. **Verdict correctness.** Can any claims file plus run produce SUPPORTED when the listed texts are not all in the recorded field of a matching step? Look at: how content is joined per step and field, content attached through log records, content for the same field split over several items, matching steps by tool name versus step id, `atEvent` boundaries (inclusive, items before and after it, steps whose content is partly before and partly after), case folding with `toLowerCase`, texts containing newlines or the joining character, empty or very short texts, and values that are not text (numbers, booleans, lists, key-value lists, bytes).
2. **No guessing.** Can a claim be answered NOT_SUPPORTED or SUPPORTED when some matching step could not be read (withheld, never recorded, late)? Check the precedence between the outcomes (too much work, withheld, no content, late, missing) in `checkClaims`, including runs with mixed steps and a `FULL` run whose content is absent for some steps. Is a `FULL`-mode file that contains withheld values, or the reverse, handled by the reducer before this code sees it?
3. **What "searched" means.** Only leaf values are searched (not field names), bytes values are skipped, and all content of one step and field is joined with a newline. Are there inputs where that creates a false match across item boundaries, or hides a true one? Is it worded honestly to the user?
4. **The claims file.** Strictness and error handling in `parseClaimFile`: unknown fields, duplicate field names, type checks, number handling for `atEvent`, limits (size, depth, claim and text counts), BOM, invalid UTF-8, lone surrogates, `__proto__` and similar keys (the strict parser returns Maps), and whether any message echoes file content other than the restricted claim id. A typo must never weaken a claim.
5. **Output safety.** Terminal output: `escapeForTerminal` is applied to every line in the text report, but check the `--json` path, the error path, and every place a tool name, step title, claim text or quoted text reaches output. Screen: the panel renders everything through React text; check for any raw HTML path. Check that `tidyName` and the model's own `tidy` leave no control or bidirectional characters.
6. **Performance and limits.** The search is bounded by a total of 10^9 searched characters (`CLAIM_LIMITS.maxScannedCharacters`), counted per text searched. Is the accounting sound (the cache of joined text, lower-cased copies, claims with many matching steps, 1,000,000-event runs, 8 MiB strings)? Can a claims file or a run make the page or the command hang, or use unbounded memory? The panel recomputes on every keystroke: is that acceptable?
7. **Consistency.** The screen, the command line text and `--json` must agree. Check shared code paths, the "Go to event" target for each verdict, and that the closest-candidate logic reports a step that actually relates to the sentence shown.
8. **Wording and overclaiming.** Does every sentence in `src/claim-report.ts`, the panel and the demo stay true? In particular: "Supported" must not read as "true", the caveats must be accurate and complete, and no sentence may suggest a model, a fingerprint check, or anything the code does not do.
9. **Tests.** Tests that pass for the wrong reason, and missing adversarial cases. The author ran a mutation check (five planted bugs, each caught); judge whether the important rules are really pinned, especially rules 4 and 5 at the top of `src/claim-check.ts`.

## 5. Decisions made in the build (verify, do not assume)

These are the author's decisions, not spec text. Judge them:

- All content recorded for one step and one field is joined (in event order, with a newline) before searching, so the listed texts may be spread over several items.
- Content that arrives through a log record counts for the step that log record belongs to.
- A tool is matched by its recorded tool name (an allowlisted attribute, so it is available even when content is withheld); a step can be named by id with an explicit field.
- A claim is SUPPORTED if at least one matching step supports it; if any matching step cannot be read and none supports the claim, the verdict is CANNOT_CHECK rather than NOT_SUPPORTED.
- `atEvent`: only content recorded at or before that event counts; if a step's content was recorded only after it, the reason is TOO_LATE even if that content is withheld (its existence is known).
- A step with an error status can still support a claim; the sentence says so ("treat this evidence with care").
- Text matching is exact substring, case sensitive by default, with no Unicode normalisation.
- Unknown fields in the claims file are errors; a claims file is limited to 100 claims, 5 texts per claim, 500 characters per text and 1 MiB.
- The panel's example claims and the second demo run (content stored) are synthetic; the original demo (content withheld) and its visual baselines are unchanged.
- The command exits with 0 whenever the check ran, even if some claims are not supported (so a script must read the report or `--json`).

Known limits stated by the author: it cannot tell whether a supported claim is true, cannot see the model's hidden context, and does not extract claims by itself.

Out of scope: the importer, reducer, store and budget replay (already reviewed), the mission engine, visual design, and the deferred items (`LENGTH_ONLY` mode, sanitized export, the `.claude/settings.json` rule for the runs folder).

## 6. How to run the checks

Node 24 matches CI. From the repository root:

```bash
npm run typecheck
npx vitest run test/claim-check.test.ts test/claim-report.test.ts test/run-replay-model.test.ts
npx playwright test e2e/claim-check.spec.ts e2e/run-replay-visual.spec.ts
```

The end-to-end tests need Chrome and may need to run outside a restricted sandbox; report an environmental failure separately from a code defect. Last known author result: typecheck clean; 647 unit tests passing with 2 skipped; 56 earlier end-to-end tests plus 8 new ones passing. The author's own claims are in `docs/development/PROGRESS.md`; treat them as claims to verify.

## 7. Report format

1. **Verdict:** `APPROVE`, `APPROVE WITH CHANGES` or `REJECT`, with the SHA you reviewed.
2. **Findings**, most severe first. For each: severity (`blocker`, `major`, `minor`), file and line, what is wrong, a concrete failing scenario, verified or suspected, and a suggested direction (not a patch).
3. **Judgement of the decisions** in section 5: any you consider wrong or misleading.
4. **Test gaps** that matter.
5. **What you could not check**, and why.

No praise, no summary of the code, no style changes.
