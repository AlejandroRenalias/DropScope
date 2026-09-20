# Limitations and Responsible Use

DropScope is a local-first software-engineering learning project. It demonstrates an event-sourced research workflow using deterministic fixtures, replayable mission histories, and explicitly guarded boundaries.

## What DropScope Is Not

- It is not market research, commercial advice, legal advice, safety certification, or financial advice.
- It does not predict demand, profitability, product safety, regulatory status, supplier performance, or customer outcomes.
- It is not an ecommerce automation system, a hosted service, or an unattended web-research bot.
- A fixture outcome or holdout result is a test of software behavior, not evidence that a product should be sold.

## Use Fixtures Responsibly

The normal fixtures are fixed synthetic or recorded learning inputs. Use them to understand scheduling, budgets, risk gates, review, recovery, and replay. Do not present their candidate names, rankings, scores, timelines, or reports as real market findings.

Changing a fixture is a controlled software test. It does not validate a new market, change frozen policy, or grant an external capability. See the [synthetic fixture catalog](SYNTHETIC_FIXTURES.md) and [holdout fixture result](HOLDOUT_RESULT.md) for their precise scope.

## External and Live Boundaries

- Normal startup, fixture runs, and evaluation make no Google request and start no live worker.
- The Google Trends comparison is a user-selected local CSV import for fixed terms. DropScope does not contact Google or retain the raw CSV; the normalized timeline is unscored context only and cannot change a score, ranking, gate, or recommendation.
- A Google Trends capture or live-worker pilot is separately guarded and requires explicit user action. Do not use either as a background process, a substitute for independent research, or permission to spend money or share data.
- Any new source, worker ability, data collection, scoring policy, publication workflow, or paid service needs a separately approved, bounded change.

## Data and Privacy

Local mission histories are stored under `.dropscope-data/` and are Git-ignored. Treat them as local project data: review them before copying or sharing, and delete them only when you intentionally want to discard those histories.

Do not place credentials, tokens, private keys, personal data, or confidential research in fixtures, source files, screenshots, or commits. The repository's ignore rules reduce accidental staging risk, but they do not remove data that has already entered Git history.

## Human Decision Responsibility

Use independent, current, lawful research and appropriate professional review before making commercial, legal, safety, regulatory, financial, or operational decisions. You remain responsible for any action taken from information shown by DropScope.

Before sharing the repository, follow the [public release readiness checklist](PUBLIC_RELEASE_CHECKLIST.md). Publication, licensing, remote access, and any Git-history decision remain explicit owner choices.
