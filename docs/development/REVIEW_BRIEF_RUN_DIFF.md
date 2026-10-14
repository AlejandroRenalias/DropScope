# Independent review brief: run diff

**For the user (plain words).** Run diff is the feature where you give DropScope two saved runs of an agent and it tells you where they first differ ("run A called `search`, run B called `browse`"), and how they compare on failures, tokens and recorded content. Under `AGENTS.md`, work like this needs an independent review: it decides what counts as "the same step", it reads files nobody has vetted, and a wrong "these runs match" is worse than a missing feature. This is the handout for that review. It says which commit to read, what the code is meant to do, what to examine and how to report. It does not say the code is right; the reviewer decides that. Same read-only setup as before, run in this folder on your machine. Nothing needs to be pushed (the branch is already on GitHub as pull request 49).

---

## 1. Target

- Repository: `AlejandroRenalias/DropScope`, local checkout, branch `claude/run-diff`.
- **Exact commit under review:** `f44047f1a4609e0800a8d344893c36b25236d3d9`. (A later commit on the branch adds only this brief; do not review it.)
- Base for the diff: `9784085` (current `main`, which already contains the reviewed importer, reducer, store, replay screen, budget replay and claim check).
- Check first: `git rev-parse f44047f` must print the SHA above. If it does not, stop and say so.
- Read-only: do not edit files, commit, push, or change settings. Do not run `npm run forensics` against the default runs folder.
- Diff to review: `git diff 9784085 f44047f -- src test docs/development/PROGRESS.md docs/development/HANDOFF_NEXT_SESSION.md` (about 650 added lines, roughly half of them tests). The first two docs changes in that range (`bc7d6fb`) are only wording about a merged pull request.

## 2. What was built

`diff <run A> <run B> [--json]` reads two run files and reports where they first differ. No model, no network, no new event type, no change to the saved run format (`schemaVersion` and `IMPORTER.version` unchanged).

| Purpose | Files |
| --- | --- |
| Core: matching, comparing, totals | `src/run-diff.ts` (rules in the header comment) |
| Plain-language sentences | `src/run-diff-report.ts` |
| Command line (`diff`, `--json`) | `src/run-cli.ts` (the `diff` branch and the usage text) |
| Tests | `test/run-diff.test.ts`, `test/run-diff-cli.test.ts` |

The rules, in short:

1. Step ids are random per run, so steps are matched by **title** (kind plus tool or agent name, as built by the run model), in step-tree order, never by id.
2. The shared start and shared end of the two title lists are trimmed. The middle is lined up with a longest-common-subsequence table (deterministic on ties). If the middle table would exceed 4,000,000 cells, nothing in the middle is lined up: it is listed as removed (run A) and added (run B), and the result says `fullyAligned: false`.
3. Runs with more than 5,000 steps each are refused (`tooLarge`).
4. A matched pair is "changed" if it differs in: failed or not, input tokens, output tokens (a count the trace did not report differs from one it did), or recorded content.
5. Content is compared by fingerprint per `(channel, field, field key, ordinal)`. A withheld value keeps `{size, SHA-256}` of its canonical text; a stored value is fingerprinted the same way (`canonicalJson`, then SHA-256), so a run kept with content and one kept as fingerprints compare correctly. Only content attached to a step is compared (not content attached only to log records).
6. Time per step is not a difference. Time appears in the totals only.
7. The first difference is the first non-"same" item in the aligned list.

Product source: `docs/development/PROPOSAL_AGENT_RUN_FORENSICS.md` (phase 4, "Align two runs and show the first divergence, then divergences in cost, tool use and outcome"). Run-event contract: `docs/schemas/run-event-contract-v1.md`. The author's own account is in `docs/development/PROGRESS.md` ("Run diff"); treat it as claims to verify.

## 3. Why independent review is required

`AGENTS.md` lists correctness-sensitive work as review-required. This feature reads untrusted run files, decides "same or different", and prints text that came from them. A false "the runs match" would hide a real divergence, and a false difference would send someone chasing nothing.

## 4. What to examine

Report only actionable findings. For each, give a concrete input or sequence, and say whether you **verified** it (ran it, or traced it to a definite result) or only **suspect** it.

1. **Matching correctness.** Can two steps that are different things get the same title (so they are matched and reported "same"), or the same thing get different titles? Look at how the run model builds the title (`stepTitle`, `tidy`, truncation, the allowlisted tool and agent name attributes, a step with no tool name, an unrecognised operation) and whether anything that matters (for example a different `label`, a different parent, a different depth) is lost. Is matching by title in tree order an honest basis for the sentence "the runs match step for step"?
2. **Alignment.** Is the trim-then-LCS logic right at the edges: empty runs, one empty run, a middle that is empty on one side only, all steps equal, prefix and suffix overlapping (for example A = `x x`, B = `x`), repeated titles, the tie rule, and `i`/`j` bookkeeping after trimming? Does the `Uint16Array` table overflow for any input allowed by the cell limit? Is the cell limit enough to bound time and memory, and does the fallback still find the right first difference?
3. **What counts as a difference.** The compared set is: failed status, input tokens, output tokens, content fingerprints. Is anything that should matter missing (for example step kind change with the same title, parent or nesting changes, step order across siblings, number of log records, import notes, `statusMessage`, step events, content attached to log records only)? Is anything compared that should not be? Check that the report never claims more than was compared.
4. **Content fingerprints.** Is the claim "a withheld value and a stored value compare equal exactly when they are the same value" true? Look at `fingerprintOf` against how `src/run-emit.ts` builds withheld fields (`canonicalJson`, byte length, SHA-256), at `fieldKey` handling, ordinals, steps with content in one run and none in the other, and what happens when content is recorded twice for the same key. Could two different values collide in the map key (`channel|field|key|ordinal` with `|` inside a field key)?
5. **Totals and summary.** Check `totalsOf`: token sums with missing counts, `stepsMissingTokens` (counts model calls only; is that what the note says?), duration from the earliest start to the latest effective end, steps that fail, and the "tools that differ" table. Are the numbers consistent with the budget replay's view of the same run?
6. **Output safety.** The text report goes through `escapeForTerminal` line by line, and `--json` through `jsonForTerminal`. Check every place a step title, tool name or id reaches output, including error paths, the first-difference lines and the tool table. Could a crafted tool name forge a line, clear the screen, or break the JSON? Do error messages ever repeat file content?
7. **Performance and limits.** Check the bounds: 5,000 steps per run, 4,000,000 table cells, up to 1,000 differences in `--json`, report lists capped at 25. Can a pair of run files make the command hang or use unbounded memory (many steps with huge content values, 1,000,000 events, thousands of distinct content keys per step, very long titles)? `contentByStep` builds a map for every step before any limit is checked: is that fine?
8. **Consistency of the two outputs.** The text report and `--json` should agree on the first difference, counts and totals. Check shared code paths and that "replacement" wording in the report (a run of steps only in A followed by a run only in B, paired in order) never misstates the data.
9. **Wording and overclaiming.** Does every sentence in `src/run-diff-report.ts` and the usage text stay true? In particular "the runs match step for step in structure, outcome, token counts and recorded content", "first differ at step N of the aligned list", and the notes. Is "run A / run B" always the order the user typed?
10. **Tests.** Tests that pass for the wrong reason, and missing adversarial cases. The author did **not** run a mutation check on this feature; judge whether the important rules (trimming, tie rule, fallback, content comparison across modes, escaping) are really pinned, and say which planted bugs would survive.

## 5. Decisions made in the build (verify, do not assume)

These are the author's decisions, not spec text. Judge them:

- Matching is by displayed title and tree order, not by operation name, parent path or attributes.
- A step present only in one run, or whose title differs, is reported as "only in A / only in B"; adjacent runs of these are read as replacements in the report only.
- Time per step is not a difference; token counts are exact and any difference counts.
- Content attached only to log records is not compared.
- Runs above 5,000 steps are refused rather than compared in part.
- The command exits 0 whenever the comparison ran, even if the runs differ (a script must read the report or `--json`).
- `--json` lists at most 1,000 differences and says nothing when it truncates (check this; if it is a defect, say so).
- Two runs of different content modes may be compared.
- No screen was built.

Known limits stated by the author: it says that the recordings differ, not which one is right; it does not explain why they differ; it matches by name, so two different steps that share a name look the same.

Out of scope: the importer, reducer, store, budget replay and claim check (already reviewed), the mission engine, visual design, a screen for the diff (not built), and the deferred items (`LENGTH_ONLY` mode, sanitized export, the `.claude/settings.json` rule for the runs folder).

## 6. How to run the checks

Node 24 matches CI. From the repository root:

```bash
npm run typecheck
npx vitest run test/run-diff.test.ts test/run-diff-cli.test.ts
npm test
```

No end-to-end tests were added or needed (no screen changed). Last known author result: typecheck clean; build succeeds; 690 unit tests passing with 3 skipped (the skipped ones are Linux-only). Report an environmental failure separately from a code defect.

## 7. Report format

1. **Verdict:** `APPROVE`, `APPROVE WITH CHANGES` or `REJECT`, with the SHA you reviewed.
2. **Findings**, most severe first. For each: severity (`blocker`, `major`, `minor`), file and line, what is wrong, a concrete failing scenario, verified or suspected, and a suggested direction (not a patch).
3. **Judgement of the decisions** in section 5: any you consider wrong or misleading.
4. **Test gaps** that matter, including surviving planted bugs.
5. **What you could not check**, and why.

No praise, no summary of the code, no style changes.

## 8. Prompt to paste into Codex

> You are an independent read-only reviewer. In this repository, first run `git rev-parse f44047f` and stop if it does not print `f44047f1a4609e0800a8d344893c36b25236d3d9`. Then read `docs/development/REVIEW_BRIEF_RUN_DIFF.md` and review exactly that commit as it describes. Do not edit, commit or push anything. Answer in the report format of section 7.
