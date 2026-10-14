# DropScope Architecture Overview

> **Note.** This page describes the original mission replay. DropScope now centers on agent run forensics: start with the [README](../README.md) and the [guided tour](GUIDED_TOUR.md).

DropScope is a local-first research-workflow learning project. It uses fixed synthetic missions to make scheduling, evidence gates, reviews, budgets, recovery, and replay observable before those ideas are trusted around real research or workers.

## One Source of Truth

An append-only JSONL event history is authoritative. The reducer reconstructs the mission state from that history, and the browser renders that reconstructed state. The browser does not write events directly or decide a ranking, budget outcome, or safety gate.

```text
Browser interface
  -> loopback runtime API
    -> orchestration engine
      -> policies, scheduler, budget, review workflow
      -> append-only JSONL event store

JSONL event history
  -> pure reducer
    -> browser projections, mission replay, and final report
```

This separation makes a saved mission replayable and keeps the same decision history visible after a browser refresh.

## Core Components

| Component | Responsibility |
| --- | --- |
| Contracts | Strict runtime schemas for commands, events, and replay-safe data. |
| Orchestration engine | Authorizes tasks, observes dependencies, schedules attempts, applies retry/recovery rules, and owns the budget ledger. |
| Policies | Apply evidence, risk, eligibility, ranking, audit, tribunal, and blind-review rules deterministically. |
| JSONL event store | Persists one ordered event stream per local mission. |
| Local runtime | Exposes a loopback-only API for launching and reading fixed missions. |
| Browser interface | Projects replayed mission state as the Research Office, Agent Desk, Final Report, and Mission Replay views. |
| Runtime adapters | Keep simulated, recorded, and separately guarded external boundaries outside the authoritative engine. |

## Mission Flow

1. A fixed fixture declares its tasks, dependencies, budget, seed, and candidate inputs.
2. The engine authorizes and schedules dependency-ready task attempts.
3. Each authoritative change becomes a validated event in the JSONL history.
4. The reducer replays those events into mission state.
5. Risk, evidence, eligibility, tribunal, audit, and blind-review policies produce a report and terminal outcome.
6. The browser reads that replayed history; it can reload the last locally saved mission without inventing state.

Tasks may overlap only when their dependencies allow it. A retry is a new attempt with its own persisted lifecycle, and replay never re-rolls timing or outcomes.

## Deterministic by Design

The fixed fixtures use seeded simulated timing and outcomes. This lets the project compare capacity and virtual staffing plans while holding evidence and policy inputs constant. Repeated runs should agree on the logical outcome, budget totals, gate decisions, ranking, reviewer verdict, and replayed state.

The local evaluator (`npm.cmd run evaluate` on Windows) reports these experiments separately. Its virtual-staffing rows are simulations over fixed traces, not measurements of real workers or people.

## Local and Safety Boundaries

- The normal runtime listens only on `127.0.0.1` and stores local mission histories under a Git-ignored data directory.
- Standard fixed fixtures use synthetic or recorded local data. They do not require a model account, API key, or paid API.
- A manual Google Trends comparison import is bounded, local, and unscored context; it does not alter rankings, gates, or recommendations.
- Any live-worker pilot is separately guarded. It is not part of normal startup, fixture evaluation, or unattended operation.
- DropScope does not autonomously place orders, spend money, publish content, create accounts, or contact people.

## What This Is Not

DropScope does not promise profitable products or commercial outcomes. It is not a hosted service, an ecommerce automation system, or an unattended web-research bot. External inputs remain untrusted, and any new network source, worker capability, decision policy, or publication workflow requires an explicit, bounded change.

## Verify Locally

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run test:e2e
```

For setup and local startup instructions, see [the installation guide](INSTALLATION.md).
