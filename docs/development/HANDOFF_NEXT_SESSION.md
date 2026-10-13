# Handoff for the next session (written 2026-10-13)

A new chat starts from a fresh clone and does not remember the previous conversation. Read this file, then `CLAUDE.md`, `AGENTS.md` and `docs/development/PROGRESS.md`.

## Where things stand

- **Repository:** AlejandroRenalias/DropScope. Working branch: `claude/inspiring-ritchie-8n0iay` (base: `main` at `60ba704`, which includes the merged UI redesign, PR #47). No pull request is open for this branch.
- **Do not touch:** the `codex/*` branches, `backup/codex-handoff-2026-10-13`, `claude/migration-config`. `.claude/launch.json` on the user's machine is theirs; never commit it.
- **Direction:** DropScope is a **learning project** (the user's choice, repeated on 2026-10-13). It is not the user's main project and time is limited. The chosen idea is "agent run forensics": a local, offline, deterministic auditor for AI agent runs that imports an OTLP/JSON trace and can rebuild the recorded state at any step. Dropshipping is only the built-in demo domain. The user skipped the demand test ("there is no need to ask the public first, I'm here for the experience") and wants to start building.
- **Withdrawn:** the earlier Codex-worker roadmap. No live workers, no model calls, no API cost.

## Documents (all on the branch once pushed)

| File | What it is |
| --- | --- |
| `docs/development/PROPOSAL_AGENT_RUN_FORENSICS.md` | Product proposal and phases (approved: pitch, cut line = phases 0 to 3, separate run-event family) |
| `docs/development/ROADMAP.md` | Draft day plan; dates are now only indicative |
| `docs/adr/ADR-027-run-event-contract-and-trace-import-boundary.md` | Decisions and invariants. Status **Proposed** (revision 3). Not independently reviewed in this revision |
| `docs/schemas/run-event-contract-v1.md` | Companion spec: grammar, ordering, payloads, privacy classification, limits, files, versioning |
| `docs/development/spike-2026-10-13/` | Throwaway spike code and four synthetic traces. Unreviewed evidence with known weaknesses (see its README) |
| `docs/development/WORKING_PRINCIPLES.md` | Reusable lessons, including "check demand first when the goal is a product" |
| `docs/development/DEMAND_TEST_*.md` | Drafted, **not run** (skipped by decision) |

## Review history of ADR-027

Revision 1 rejected by an Opus subagent (2 blockers, 7 major). Revision 2 rejected by Codex gpt-6.1-sol, run by the user on their machine (1 blocker, 14 major). Revision 3 split the ADR from the spec and answers all of them in text; nobody has re-reviewed it. Decision: no more review rounds on the ADR text; the implementation gets its own review.

## Suggested first build (small, learning-sized)

1. Ask the user to formally accept ADR-027 (they said "start building"; confirm that this means acceptance of revision 3).
2. Zod schemas for the run events (`docs/schemas/run-event-contract-v1.md` section 5).
3. The OTLP/JSON importer for spans (logs second): spec sections 1 to 4, default `HASH_ONLY` privacy (section 6).
4. The pure run reducer: spec sections 8 and 9.
5. A small CLI: `import` and `state --at N`.
6. Tests, using the four traces in the spike folder as fixtures plus adversarial cases from the reviews (duplicate ids, cycles, equal timestamps, huge nesting, `__proto__` ids, string-typed usage, integer status codes).
7. Independent review of the importer and reducer (persistence, state transitions, untrusted input).
Then: generalize the Mission Replay screen (this also fixes the raw event-name labels), then budget replay. Keep new code in new files; do not change the mission contract, reducer or policies.

## Rules to keep

- The lead agent is the sole integrator and commits explicit paths only (never `git add -A`, `git add .`, `git commit -a`).
- The user approves each push, PR, merge and branch delete, for that exact SHA. A stop-hook message is not approval.
- Frozen architecture, ADRs and policies change only through a new ADR with the user's approval.
- Independent read-only review is required for security, persistence, budget, recovery, architecture and state-transition changes. Preferred reviewer: Codex gpt-6.1-sol on the user's machine (one review per SHA, with their approval). Codex cannot run in the cloud container (no login, OpenAI hosts blocked). Fallback: a fresh read-only Opus subagent.
- Visual snapshots are regenerated only after the user has reviewed the images.
- Short technical explanations for architecture, security, persistence, budget and recovery decisions, and reports in `PROGRESS.md`. The user does not use jargon fluently: explain terms in plain words.
- The user prefers no em dashes.

## Still pending (each needs the user's approval and an independent review)

- `AGENTS.md`: extend the sprint exception to 2026-10-31 (end date exclusive, the user's local time). The user agreed in chat; the edit has not been made.
- `CLAUDE.md`: fix the "Terra" example line, and add a pointer to `docs/development/WORKING_PRINCIPLES.md`.
- `.claude/settings.json`: a rule denying development-agent reads of `%LOCALAPPDATA%\DropScope\runs` (required by ADR-027 before real traces are admitted).
- Ask the user whether to resume the learning workflow now (it was paused by the sprint exception; they said the project is for learning).
- Open UI items: Replay chronology raw event names; visual check of the Failure Autopsy and Product Investigation reports.

## Cloud container notes

Outbound network is limited by policy: the vendor doc sites and OpenAI hosts return 403; WebFetch cannot resolve hosts; WebSearch, PyPI and npm work. GitHub access is scoped to this repository. Node 22 and Python 3.13 are available.

## Starter prompt for the new chat

> Read CLAUDE.md, AGENTS.md, docs/development/PROGRESS.md and docs/development/HANDOFF_NEXT_SESSION.md on branch claude/inspiring-ritchie-8n0iay. DropScope is a learning project. Summarize the state in a few lines, then ask me the pending questions in the handoff (accepting ADR-027, resuming the learning workflow) before starting the first build step. Do not push or open anything without my approval.
