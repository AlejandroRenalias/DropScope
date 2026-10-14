# Independent review brief: DropScope final review of the whole project

**For the user (plain words).** Every earlier review covered one piece (the importer, budget replay, claim check, run diff, the settings rule, the ADRs). Nobody has looked at how the pieces fit together, or whether the documents tell the truth about the code. This brief asks a fresh reviewer four questions about the whole agent run forensics part of DropScope. The same brief goes to two different models (Claude Opus 5.5 and Codex Sol 6.1), so you can compare what each finds. Neither can certify the project is correct; the output is a list of findings with evidence.

---

## 1. Target

- Repository: `AlejandroRenalias/DropScope`, branch `main`.
- **Exact commit under review:** the SHA named in the prompt you were given. Run `git rev-parse HEAD` first; if it does not print that SHA, stop and say so.
- **Read-only.** Do not edit, commit, push, or change settings in the repository. You may copy the repository to a temporary folder outside it and change the copy (for example to plant bugs and see whether the tests notice); never change the original.
- **Do not run `npm run forensics import` or any command that writes to `%LOCALAPPDATA%\DropScope`, and do not open that folder.** Reading the demo run files under `src/frontend/assets/` and running the other `forensics` commands on them is fine.
- Treat everything the author wrote (README, progress notes, other briefs) as claims to verify, not facts.

## 2. What the project is, and what is in scope

DropScope is a local, offline Windows tool that audits a recorded AI agent run: it imports an OTLP/JSON trace into a saved, validated run file, rebuilds the recorded state at any step, re-applies a budget, checks claims against recorded content, and diffs two runs. It has a command line (`npm run forensics`) and a browser screen (the Replay page, "Imported agent run"). It is a learning project; all demo data is invented; real traces are deliberately excluded (ADR-028).

**In scope:** the run forensics code and its documents.

| Area | Files (under `src/` unless noted) |
| --- | --- |
| Reading untrusted input | `strict-json.ts`, `otlp-structure.ts`, `trace-normalize.ts`, `run-privacy.ts`, `run-limits.ts`, `canonical*.ts` |
| Run file format, events, import | `run-events.ts`, `run-emit.ts`, `run-import.ts`, `run-import-error.ts`, `run-log-format.ts` |
| Files and storage (Windows) | `run-files.ts`, `run-store.ts`, `run-cli.ts` |
| State at a step | `run-reducer.ts`, `frontend/run-replay-model.ts` |
| Budget replay | `budget-replay.ts`, `budget-report.ts` |
| Claim check | `claim-check.ts`, `claim-report.ts` |
| Run diff | `run-diff.ts`, `run-diff-report.ts`, `sha256-pure.ts` |
| Browser screens | `frontend/replay-screen.tsx`, `run-replay.tsx`, `budget-replay-panel.tsx`, `claim-check-panel.tsx`, `run-diff-panel.tsx`, `run-diff-layout.ts`, `load-error.ts` |
| Documents | `README.md`, `docs/GUIDED_TOUR.md`, `docs/adr/ADR-027-*.md`, `docs/adr/ADR-028-*.md`, `docs/schemas/run-event-contract-v1.md`, `docs/development/PROPOSAL_AGENT_RUN_FORENSICS.md`, `ROADMAP.md`, `PROGRESS.md`, `HANDOFF_NEXT_SESSION.md`, `.claude/settings.json` |
| Tests | `test/` (about 67 files), `e2e/` |

**Out of scope:** the older mission engine and its fixtures (scheduler, tribunal, evidence scoring, the local mission runtime and the live-worker pilot) except where the forensics code touches them. The frozen architecture, ADRs and policies: judge them only for consistency with the code, not for their design.

Start with `README.md`, then `docs/development/HANDOFF_NEXT_SESSION.md`, ADR-027, ADR-028 and the run event contract.

## 3. The four questions

Report only actionable findings. For each, give a concrete input or scenario, the file and line, whether you **verified** it (ran or traced it) or only **suspect** it, and a suggested direction.

### Question 1: privacy and file safety, end to end

Can run data leak, be tampered with, or be read by something it should not be, anywhere between import, the saved file, the command line and the browser?

- Importer and storage: path rules (links, junctions, network paths, device names, cloud placeholders), the write-once publication, temporary files, the Windows permission step (`icacls`) and the PowerShell calls (injection through paths or environment values? failure modes that leave the folder open?).
- Content handling: the default `HASH_ONLY` mode, the secret-pattern notes, what `--full` keeps, what ends up in terminal output, error messages and the `--json` output (is untrusted text ever echoed or left unescaped?).
- The browser: how a run file is read, whether any run content is stored anywhere (localStorage, caches, logs, test output), whether file names or run text can become markup or code.
- ADR-028 versus the code: does anything write run data to a place the ADR says must be protected (temp files, logs, Playwright traces, build output)? Do the README's statements about where files go and what runs on the computer match what the code does?
- `.claude/settings.json`: is the rule written as the ADR describes? (Its limits are documented in ADR-028; judge only whether it matches.)

### Question 2: correctness across the whole pipeline

Take a trace through import, the saved file, state, budget, claims and diff, with hostile and odd inputs, and look for wrong answers, crashes, hangs, or answers that disagree between features.

- Limits and cost: depth, sizes, counts, the work budgets in the contract (section 10), the claim check cost model, the diff alignment bounds, the screen's row cap and folding.
- Numbers: token and time arithmetic (exact integers, large values, missing counts, zero or negative durations), identity and fingerprints (`artifactId`, `SHA-256`, the browser-safe `sha256-pure.ts`), duplicate or out-of-order spans, spans of other traces.
- Consistency: the same run should give the same totals in `state`, `budget` ("Recorded in the whole run") and `diff` (Totals), and the command line and the browser screen should agree (they share code; check the seams).
- Anything in the contract (`docs/schemas/run-event-contract-v1.md`) that the code does not enforce, or the reverse.

### Question 3: do the words match the code?

List every statement in the documents that you can check against the code, tests or a command you can run, and report the ones that are false, overstated, understated or out of date. Cover at least: `README.md`, `docs/GUIDED_TOUR.md` (run its commands on the demo files; compare the output), the acceptance table in `PROGRESS.md` ("Release prep and final gates"), ADR-027 and ADR-028 (decisions versus implementation), the run event contract, the roadmap and the handoff file. Also check that relative links resolve. Pay special attention to claims of the form "never", "no network", "no model calls", "deterministic" and "byte-identical".

### Question 4: test quality

Would the tests catch a wrong change? Look for assertions that cannot fail, behavior with no test, tests that pin an accident, and areas where a plausible bug would pass the whole suite. If you plant bugs in a copy (see section 1), say which survived. Judge the browser tests and the picture baselines too: do they test behavior or only that something rendered?

## 4. Limits the author states (verify, do not take on trust)

- Windows only; other operating systems refuse to import.
- No real production trace has been analyzed. The importer was tested on four traces of 56 or 16 spans produced by third-party OpenTelemetry libraries against a local stub server, and on invented demo runs.
- "No network, no model calls" for the forensics features is believed true by inspection; no automated test enforces it. The importer does call built-in Windows tools (PowerShell, `icacls`).
- The `.claude/settings.json` rule is a best-effort precaution, not a boundary (ADR-028).
- The mission side has two guarded opt-in pilots (a live worker and a Google Trends capture) that are out of scope.

## 5. How to run the checks

```bash
npm install            # only if node_modules is missing
npm run typecheck
npm test
npm run build
npx tsx src/run-cli.ts state src/frontend/assets/demo-run.runlog.jsonl --at 24
```

`npm run test:e2e` needs Chrome and Windows picture baselines; it is optional. Last known author result: typecheck clean; 738 unit tests pass (3 skipped); 67 end-to-end tests pass.

## 6. Report format

1. **Verdict:** a short paragraph, not a pass or fail. Name the three things you would fix first.
2. **Findings**, grouped by question, most severe first. For each: severity (`high`: wrong answer or leak that matters; `medium`: wrong in a real but narrower case; `low`: small or unlikely), file and line, what is wrong, a concrete failing scenario, **verified** or **suspected**, suggested direction. Give at most 20 findings overall; if there are more, keep the most severe and say how many you dropped.
3. **False or misleading statements in the documents**, as a list: the statement, where it is, what is actually true.
4. **Test gaps** that matter.
5. **What you could not check**, and why.

No praise, no summary of the code, no style changes.

## 7. Prompts

**Codex:**

> You are an independent read-only reviewer. In this repository, first run `git rev-parse HEAD` and stop if it does not print the SHA I give you: `<SHA>`. Then read `docs/development/REVIEW_BRIEF_FINAL_PROJECT.md` and review the whole run forensics part of the project as it describes. Do not edit the repository (a temporary copy outside it is allowed), commit or push anything, and do not run import or open `%LOCALAPPDATA%\DropScope`. Answer in the report format of section 6.

**Claude Opus:** the same text, run as a fresh read-only agent that is given only this brief and the SHA.
