# Limitations and Responsible Use

DropScope is a local-first software-engineering learning project with two parts. The main part is **agent run forensics**: a local, offline tool that imports a recorded AI agent run (an OTLP/JSON trace), saves a validated run file, and then shows what the run recorded at any step, re-applies a spending limit, checks claims against the recorded content, and compares two runs. The older part is an event-sourced research workflow (the "mission replay") built on deterministic fixtures, replayable mission histories, and explicitly guarded boundaries. The [README](../README.md) describes the first part.

## What DropScope Is Not

- It is not market research, commercial advice, legal advice, safety certification, or financial advice.
- It does not predict demand, profitability, product safety, regulatory status, supplier performance, or customer outcomes.
- It is not an ecommerce automation system, a hosted service, or an unattended web-research bot.
- A fixture outcome or holdout result is a test of software behavior, not evidence that a product should be sold.

## What the Run Forensics Answers Do and Do Not Mean

- DropScope reports what a recording says. It cannot see inside the agent, and it does not tell you whether the agent was right.
- "Supported" in the claim check means the text you listed appears in the recording. It does not mean the claim is true.
- Budget replay is a what-if: it re-applies a limit you type to the numbers the run recorded. It does not control or stop any agent.
- "Differ" in the run diff means the recordings differ in what is compared (the README and the command list what is not compared). It does not say which run is right.
- It has been tested on invented demo runs and on a few traces produced by instrumented libraries against a local stub server. **No real production trace has been analyzed.** Do not rely on it for audits, incident reports, compliance or legal evidence.
- It runs on Windows only. Other operating systems are refused.
- The forensics code makes no model calls and no explicit network requests; this is true by inspection of the code, and no automated test enforces it. One known exception: Windows can access a file on a mapped network drive before DropScope refuses it. The commands start the built-in Windows tools PowerShell and `icacls` to read file properties and lock the runs folder.

## Use Fixtures Responsibly

The normal fixtures are fixed synthetic or recorded learning inputs. Use them to understand scheduling, budgets, risk gates, review, recovery, and replay. Do not present their candidate names, rankings, scores, timelines, or reports as real market findings.

Changing a fixture is a controlled software test. It does not validate a new market, change frozen policy, or grant an external capability. See the [synthetic fixture catalog](SYNTHETIC_FIXTURES.md) and [holdout fixture result](HOLDOUT_RESULT.md) for their precise scope.

## External and Live Boundaries

- Normal startup, fixture runs, and evaluation make no Google request and start no live worker.
- The Google Trends comparison is a user-selected local CSV import for fixed terms. DropScope does not contact Google or retain the raw CSV; the normalized timeline is unscored context only and cannot change a score, ranking, gate, or recommendation.
- A Google Trends capture or live-worker pilot is separately guarded and requires explicit user action. Do not use either as a background process, a substitute for independent research, or permission to spend money or share data.
- Any new source, worker ability, data collection, scoring policy, publication workflow, or paid service needs a separately approved, bounded change.

## Data and Privacy

Saved run files are written to `%LOCALAPPDATA%\DropScope\runs`, outside the repository. By default a run file keeps no prompts or answers, only their size and a fingerprint; a run imported with `--full` keeps the text. Fingerprints of predictable text can be guessed, so treat every run file as private: do not share it or commit it. **Do not import real agent traces into this project**: real traces can hold personal data and secrets, and the project has no real access boundary for them ([ADR-028](adr/ADR-028-real-trace-admission-needs-a-real-boundary.md)). All traces in the repository are invented.

Local mission histories are stored under `.dropscope-data/` and are Git-ignored. Treat them as local project data: review them before copying or sharing, and delete them only when you intentionally want to discard those histories.

Do not place credentials, tokens, private keys, personal data, or confidential research in fixtures, source files, screenshots, or commits. The repository's ignore rules reduce accidental staging risk, but they do not remove data that has already entered Git history.

## Human Decision Responsibility

Use independent, current, lawful research and appropriate professional review before making commercial, legal, safety, regulatory, financial, or operational decisions. You remain responsible for any action taken from information shown by DropScope.

Before sharing the repository, follow the [public release readiness checklist](PUBLIC_RELEASE_CHECKLIST.md). Publication, licensing, remote access, and any Git-history decision remain explicit owner choices.
