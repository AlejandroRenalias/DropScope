# DropScope Progress

Concise running report. Update it at each stage: what was done, validation, what remains, risks. Historical Codex-era usage lives in the frozen [`USAGE_LOG.md`](USAGE_LOG.md).

## Current status (2026-10-13)

**Phase:** sprint Day 1. The Codex-to-Claude Code migration (PR #46) and the command-center UI redesign (PR #47, merge commit `60ba704`) are merged. The user chose a new direction (agent run forensics, see Decisions); the earlier Codex-runtime roadmap was withdrawn, and [`ROADMAP.md`](ROADMAP.md) is a draft for the new direction pending approval.

### Done

- Engine (Milestone 1A): scheduler, event store, reducer and recovery, budget ledger, evidence audit and scoring, tribunal, blind review, divergence detection, risk policy, synthetic fixtures.
- Research Office UI foundation (Milestone 1B) and local runtime bridge (merged as PR #45).
- Milestone 2 groundwork: subscription-worker contract, preflight, protocol fake, Google Trends pilot, Failure Autopsy and Product Investigation pilots.
- Public-release documentation drafts and MIT license (Milestone 6 groundwork).
- Migration (PR #46): agent-neutral `AGENTS.md`, `CLAUDE.md`, rewritten workflow and templates, minimal `.claude/settings.json`, temporary sprint exception.
- Command-center UI on `claude/editorial-ui` (presentation only; the engine, contracts and policies are untouched):
  - light cobalt-on-white design with one accent and one alert colour, self-hosted IBM Plex, approved brief in `docs/design/DROPSCOPE_FRONTEND_DIRECTION.md`;
  - persistent frame (top bar with live status and event counter, side rails) on all six screens;
  - Research Office constellation and inspector, Mission Replay scrubber, Final Report verdict briefing, Agent Desk provenance chain, Review Office score radar and revision path, Tribunal Room courtroom, polished first-mission panel;
  - nine reviewed `win32` visual baselines committed.

### Validation (latest, on merged `main`)

Typecheck clean; 316 unit tests; build succeeds; 29 Playwright e2e tests pass; CI green. An independent Codex gpt-6.1-sol review of the UI's accessibility and replay behaviour found 8 issues, all fixed.

### In progress

- Demand test skipped by the user on 2026-10-13 (learning project, not a main project, limited time): [`DEMAND_TEST_ONEPAGER.md`](DEMAND_TEST_ONEPAGER.md) and [`DEMAND_TEST_OUTREACH_DRAFTS.md`](DEMAND_TEST_OUTREACH_DRAFTS.md) are kept for reuse. The lesson (check demand first when the goal is a product) is in [`WORKING_PRINCIPLES.md`](WORKING_PRINCIPLES.md). Next session: see [`HANDOFF_NEXT_SESSION.md`](HANDOFF_NEXT_SESSION.md).
- ADR-027 (run-event contract and trace import boundary), now revision 3 after two reviews, still Proposed, with a companion spec in [`docs/schemas/run-event-contract-v1.md`](../schemas/run-event-contract-v1.md): [`ADR-027`](../adr/ADR-027-run-event-contract-and-trace-import-boundary.md). Needs the user's approval and an independent review (Codex gpt-6.1-sol preferred, user approval required) before any code. ADR-026 (product direction) is reserved and not drafted.
- Spike evidence is copied to `docs/development/spike-2026-10-13/` (unreviewed, not product code, not part of `src/`); no product code changed.
- Open items unchanged: Replay chronology labels, visual check of the Failure Autopsy and Product Investigation reports.

### Remaining

- Approval of the forensics proposal, then the days in [`ROADMAP.md`](ROADMAP.md): ADRs, Phase 0 spike, core, replay UI, budget replay, final gates.
- Preserved on the local backup branch only: isolated design prototypes, five policy drafts, `LEARNING.md`, the `design-taste-frontend` skill; decide their value later.
- Restore the PR template's learning-record item if the learning workflow resumes after the sprint.

### Decisions (2026-10-13)

- Superseded: the earlier roadmap (Codex as MVP runtime, ADR-026 for more guarded Codex tasks) was withdrawn the same day.
- New direction chosen by the user: agent run forensics, with dropshipping kept as the demo domain. Proposal and draft roadmap await approval: [`PROPOSAL_AGENT_RUN_FORENSICS.md`](PROPOSAL_AGENT_RUN_FORENSICS.md), [`ROADMAP.md`](ROADMAP.md). Needs ADR-026 and ADR-027 before any code.

### Phase 0 findings (2026-10-13)

- Competitors (search excerpts from vendor domains plus three public GitHub READMEs; the vendors' docs were unreachable from the container): replay, run diff and fork are already offered by Phoenix (span replay re-runs one LLM span), LangSmith/LangGraph (needs a checkpointer, re-executes), Laminar (rerun from a span, cached earlier calls) and several small open-source local tools (agent-replay, react-agent-debugger, agent-timetravel). Hallucination and groundedness checks exist as LLM judges (Langfuse, Phoenix) and as heuristics (agent-replay). No tool found that re-applies a budget policy to a recorded run, or that verifies claims deterministically against captured evidence.
- Spike: two synthetic OTLP/JSON traces (56 spans each) generated by pinned third-party OTel instrumentation (openai-v2 GenAI semconv with content; OpenLLMetry without content, parallel sub-agents) against a local stub server. A throwaway importer and reducer passed: byte-identical import, order-independence, lossless round trip, final totals equal to the trace's own, reproducible state at every step. Budget replay works on both. Claim check works mechanically only on the trace with content.
- Extra checks (user-approved): a real agent framework (OpenAI Agents SDK with its OTel instrumentation: handoff, parallel tools) and content delivered as OTLP log records both import correctly after small importer fixes; token totals now also match the stub server's own tally, not only the trace's attributes; an adversarial pass on malformed inputs found three importer defects (zero, negative and missing durations), all fixed, the rest itemized or rejected cleanly. Instrumentation versions drift (openai-v2 2.4b0 needed an older util-genai pin).
- Content reality: with content in log events or absent, claim checking is not possible without tool outputs; it worked only where both answer text and tool outputs were captured.
- Not tested: the replay UI, real production traces, streaming responses, clock skew across machines.

- Decisions on 2026-10-13 (later): the learning workflow is not resumed; a plain-language communication rule was added to `AGENTS.md`; the sprint exception is extended to 2026-10-31 and the "Terra" example in `CLAUDE.md` is corrected (the names appear in `USAGE_LOG.md`, not in the frontend direction doc). These edits to `AGENTS.md`, `CLAUDE.md` and `DEVELOPMENT_WORKFLOW.md` await independent review.

- Review of commit `29a69b7` (the `AGENTS.md`, `CLAUDE.md` and workflow edits): Codex gpt-6.1-sol, run by the user, read-only. Verdict APPROVE WITH CHANGES, 3 minor findings, all verified and fixed in the next commit: the lessons file is now explicitly advisory and cannot override approval or review rules; the proposal and roadmap no longer state the old 2026-10-20 deadline; the snapshot note in `CLAUDE.md` now says nine `win32` baselines are tracked in this checkout (a stale line from before this review). The fixes (commit `d8da737`) were pushed on 2026-10-13. A second review of those small fixes was deliberately skipped, on the lead agent's recommendation and with the user's agreement: the diff is 9 added and 7 removed lines in five documents, follows Sol's suggestions, and only makes the rules stricter or more accurate. The user can still ask for a re-check at any time.

### Review record: ADR-027

- Review 1: fresh read-only Opus subagent (fallback; Codex gpt-6.1-sol is not runnable in the cloud container: no login, OpenAI hosts blocked by network policy, no tool). Target commit `15e54c3`. Verdict REJECT: 2 blockers (derived order not a complete rule; Evidence overstated), 7 major (raw-content privacy default and run-folder location; undefined hash and verbatim retention; underspecified OTLP/JSON input; incomplete limits and parser hazards; file-path and loopback hazards; undefined persistence and recovery; undefined usage and state rules; frozen-document consistency), 3 minor. The lead agent verified the repository-specific claims (64 KiB body cap, no `Host` check, data root under the working directory, baseline section 18 envelope fields) before acting.
- Fixes: ADR-027 rewritten as revision 2 (complete ordering rule, hash-only default, explicit input grammar, limits, persistence, state definition, deliberate differences, honest Evidence); spike README gained a known-weaknesses section; this file's stale status line corrected.
- Next: one Codex gpt-6.1-sol review on the user's machine against the final SHA, after the user approves pushing that exact SHA. The reviewer's suggested agent-permission change (deny development-agent reads of the run folder) is not made and needs its own review and approval.

- Review 2: Codex gpt-6.1-sol, run by the user on their machine against `61a4139`, read-only. Verdict REJECT: 1 blocker (privacy modes left raw content in span names, status messages, trace state and event names), 14 major (LENGTH_ONLY contradicted the payloads; run identity and file naming; circular missing-end rule; remaining ordering ties; trace selection and log association; payload and note schemas; log preservation; reducer admission; usage extraction and exact totals; numeric and JSON parsing; pipeline-wide limits; filesystem boundary; atomic publication; compatibility claims). The lead agent checked the claims against the ADR text, `contracts.md` and JavaScript behavior; none was found wrong, and three were the lead agent's own errors (the circular rule, the LENGTH_ONLY contradiction, the false claim that adding a kind is compatible).
- Fixes (user-approved, revision 3): the ADR was cut to decisions and invariants, and the details moved to the companion spec; every retained string is now classified; `LENGTH_ONLY` deferred; fixed default run directory; deterministic identities; complete ordering and admission rules; exact-integer usage; bounded parsing; atomic no-replace publication; versioning rules. Revision 3 has not been independently reviewed.
- Decision: the review rounds are capped. ADR-027 stays Proposed, and no further review of it is planned until the demand test supports implementing it. The implementation, with the spec turned into tested code, gets its own review.

### Open risks

- Pivot risks (crowded market, unstable OTel GenAI conventions, traces lacking content, sensitive data in traces) are listed in the proposal; the Phase 0 spike is the first gate.
- Visual snapshots are `win32`-only, e2e needs Chrome installed, and CI does not run e2e.
- Replay chronology still shows raw event type names; Autopsy and Investigation reports were only checked through the existing e2e assertions, not visually.
- `CLAUDE.md` still mentions "Terra" in an example line; changing it needs independent review under `AGENTS.md`.
