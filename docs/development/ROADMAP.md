# DropScope Seven-Day Roadmap and MVP Definition

Status: the direction in [`PROPOSAL_AGENT_RUN_FORENSICS.md`](PROPOSAL_AGENT_RUN_FORENSICS.md) is approved; the demand test was skipped on 2026-10-13 (learning project, limited time), so building proceeds directly. The day-by-day dates below are indicative only; see `HANDOFF_NEXT_SESSION.md` for the current first-build slice. It replaces the earlier roadmap (Codex as MVP runtime), which was never pushed. Window: 2026-10-13 to 2026-10-19; the sprint exception ends at 00:00 on 2026-10-20 (the user's local time) unless the user extends it. This is a development plan only. It does not amend the frozen plan, any ADR or any policy; the product direction takes effect only through the ADRs named below. Progress is recorded in [`PROGRESS.md`](PROGRESS.md).

## MVP definition

DropScope is a local, offline tool for agent run forensics. Given one real agent trace (OTLP/JSON, OpenTelemetry GenAI conventions), it:

1. imports the trace into a deterministic run event log, with every dropped or unrecognized item itemized;
2. replays the run to the exact recorded state at any step, shown in the replay UI with readable event labels;
3. re-applies a user-supplied budget policy and reports the first step where it would have been exceeded, labelled as counterfactual.

It makes no model calls, no network requests and no live worker runs. Dropshipping fixtures are the built-in demo domain. Run diff and claim-versus-evidence checking are v1 (after the cut line).

## Days

Dates assume approval today. Each gate below is a stop: no later work starts until it passes.

| Day | Work | Gate |
| --- | --- | --- |
| 1 (10-13) | User approves the proposal. Competitor check. Draft ADR-026 and ADR-027. Obtain one real trace. | User approves both ADRs before any code. Independent review of the ADRs (architecture). |
| 2 (10-14) | Phase 0 spike: import one real trace, check determinism and fidelity, check for content. | Go/no-go per the proposal's section (f). |
| 3 to 4 (10-15, 10-16) | Core: run-event contracts, OTLP importer, JSONL run store, run reducer, CLI `import` and `state --at`. | Independent review of the importer and reducer (persistence, correctness-sensitive), on the exact SHA. |
| 5 (10-17) | Replay UI for imported runs with readable labels. Visual check of the demo-domain reports (Failure Autopsy, Product Investigation). | User reviews screenshots before any baseline is regenerated. |
| 6 (10-18) | Budget replay. | Independent review (budget accounting) on the exact SHA. |
| 7 (10-19) | Final gates on the exact SHA, demo with the real trace, PROGRESS report. Slip buffer. | Typecheck, unit tests, build, e2e, CI green. |

If the work slips, cut in this order: demo-domain visual checks, then the budget replay's counterfactual detail. Never cut a review, a gate or the determinism checks.

## MVP acceptance criteria

1. A real trace of 50 or more spans imports with zero silent loss; `ImportNote` events list everything not mapped.
2. Importing the same file twice gives a byte-identical run log; replay to step N is identical across runs.
3. Final reconstructed totals match the trace's own totals (tokens, span count, final status).
4. The UI shows state at any step and says the order is derived; labels are readable (no raw event type names).
5. Budget replay names the first breach step and is labelled counterfactual.
6. No network access, model call or live worker is reachable from import, replay or budget replay.
7. Real traces are never committed; fixtures are synthetic or redacted.
8. Typecheck, unit tests, build and e2e pass on the exact final SHA, and CI is green.

## After the cut line (v1, about 3 to 4 more days)

Run diff, then claim check (only if real traces carry content), then release prep. Running past 2026-10-20 needs a decision on extending the sprint exception; the engineering gates apply either way.

## Other open items

- Replay chronology raw event names: fixed in Day 5.
- Failure Autopsy and Product Investigation visual check: Day 5; demo domain only, so first to cut.
- `CLAUDE.md` "Terra" line: fixed in the later `CLAUDE.md` update that the pivot requires, which needs independent review.
- Updating `CLAUDE.md`, the README-level docs and the public-release documents to the new direction: after ADR-026 is approved.

## Stop and escalation rules

- Product, architecture, permission and scope decisions stop for user approval; ADRs are approved before their implementation.
- Each workstream has at most two implementation attempts.
- Pushes, PRs, merges, branch deletion and every independent review need the user's explicit approval at the time. Real traces are handled locally only.

## Standing constraints

- The lead agent is the sole integrator and commits explicit paths only.
- Frozen architecture, ADRs and policies change only through a new ADR with user approval.
- Short technical explanations accompany architecture, security, persistence, budget and recovery decisions, and `PROGRESS.md` carries the reports.
