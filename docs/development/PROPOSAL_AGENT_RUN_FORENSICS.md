# Proposal: DropScope as agent run forensics

Status: historical. This was a draft for the user's approval (2026-10-13); it was approved and phases 0 to 3 are built (see `HANDOFF_NEXT_SESSION.md` and `PROGRESS.md`). The text below is the original proposal and is not updated: for example, the run file has no run-level status (`RunEnded` carries only `eventCount`), so the `RunEnded (status)` mapping below was not built. The frozen plan, architecture baseline, ADRs and policies are unchanged until the ADRs in section (e) are approved. This proposal withdraws the earlier approved roadmap (Codex as MVP runtime, "ADR-026 for more guarded Codex tasks"); that roadmap was never pushed.

## (a) Product definition

**Pitch:** DropScope replays an AI agent run to the exact state at any step, re-applies a budget to it, checks each claim against the evidence the run captured, and diffs it against another run, all offline with no model calls.

**Not another observability dashboard.** Tools such as LangSmith, Langfuse and Arize Phoenix record runs and chart them. DropScope answers forensic questions after the fact: what did the agent know, spend and assert at step N, would a given budget have stopped it, is this claim supported by what the run actually fetched, and where did two runs diverge. Everything is deterministic and reproducible from a file, so an answer can be checked by someone else.

**User:** a developer or reviewer doing a post-incident or pre-release review of agent runs (cost overruns, unsupported answers, regressions between two versions).

**Honesty rule:** the reconstructed state is the state *as recorded in the trace*, not the model's hidden context. If a trace lacks prompt or tool-output content, DropScope says so instead of inferring.

**Dropshipping** stays only as the built-in demo domain (the synthetic fixtures are a free, offline demo corpus).

## (b) Plan, cut line and estimate

Estimates are working days including review and approval waits, for one lead agent. They are guesses to be corrected by the Phase 0 spike.

| Phase | Work | Estimate |
| --- | --- | --- |
| 0. Spike and go/no-go | Check what competitors already do (no cost). Import one real trace and replay it faithfully (see (f)). Draft the two ADRs. | 1 to 1.5 d |
| 1. Core | Canonical run-event model, OTLP importer, JSONL run store, pure run reducer ("state at step N"), CLI `import` / `state --at`. | 2 d |
| 2. Replay UI | Generalize the Mission Replay screen to imported runs: step tree, scrubber, state-at-step panel, readable labels (closes the raw-event-name item). | 1.5 d |
| 3. Budget replay | User-supplied budget policy re-applied to the run: the first step where it would have been exceeded, and the counterfactual remainder. | 1 d |
| **Cut line (MVP)** | Phases 0 to 3. | **6 to 7 d** |
| 4. Run diff | Align two runs and show the first divergence, then divergences in cost, tool use and outcome. | 2 d |
| 5. Claim check | Verify user-supplied or rule-extracted claims against captured tool outputs. Only if Phase 0 shows real traces carry content. | 1.5 d |
| 6. Release prep | Demo corpus, docs and positioning, final gates. | 1 d |
| **Full v1** | Phases 0 to 6. | **10 to 11 d** |

The MVP fit the original sprint window (which ended at 00:00 on 2026-10-20) only with no slip, so on 2026-10-13 the user extended the sprint exception to 2026-10-31 and will re-decide when the MVP is reached (see `AGENTS.md`). Full v1 may still run past that date. Expiry changes little in practice: every gate stays, the learning workflow stays paused unless the user resumes it, and the plain-language communication rule and the progress reports in `PROGRESS.md` continue regardless.

## (c) First trace format and mapping

**Recommendation:** an OTLP/JSON file using the OpenTelemetry GenAI semantic conventions, behind an importer interface so other formats (a framework-native log) are added as adapters later. It is vendor-neutral, and the major tools can ingest or export OpenTelemetry, though I have not verified each tool's export path.

**Caveats found in research** ([Dash0 explainer](https://www.dash0.com/knowledge/opentelemetry-genai-semantic-conventions-explained), [Greptime](https://www.greptime.com/blogs/2026-05-09-opentelemetry-genai-semantic-conventions)): the GenAI conventions are still "Development" status (one secondary source claims otherwise; check the official repository), moved to their own repository in June 2026, and recently changed agent spans (`invoke_agent`). Prompt and completion content is opt-in, so many real traces will lack it. The importer must therefore pin a convention version, ignore unknown attributes safely, and report what a trace lacked.

**Alternative for the spike:** this session's own Claude Code transcript exists locally (`~/.claude/projects/`). It is real, free and content-rich, but undocumented and vendor-specific, so it would be a second adapter, not the canonical format.

**Mapping** (a new run-event family; the existing `MissionEvent` union is mission-specific and closed, so imported runs do not go into it):

| Trace element | Run event |
| --- | --- |
| Trace / root span | `RunStarted`, `RunEnded` (status) |
| Any span | `StepStarted`, `StepEnded` (id, parent, kind `LLM_CALL` / `TOOL_CALL` / `AGENT` / `OTHER` with the original operation name, status, error) |
| `gen_ai.usage.*` attributes | `UsageRecorded` (tokens; cost only if present or from a user price table, never silent) |
| Tool arguments and results, if captured | `ContentRecorded` (field, channel, length and hash; the content itself only in an explicit full mode) |
| Not in traces: claims | `ClaimAsserted`, from a user-supplied annotation file or deterministic rules, never an LLM in the MVP |
| Importer notes | `ImportNote` (dropped or unknown attributes, missing content) so loss is itemized |

Spans are intervals, so the importer derives one total order from start and end times with deterministic tie-breaking and stores it as the authoritative `sequenceNumber`. That order is labelled *derived*; concurrent spans and clock skew make it an approximation, and the UI says so.

## (d) What stays, changes or goes unused

**Stays:** the append-only JSONL store with truncation recovery (`src/event-store.ts`), sequence-authoritative pure reducers, strict Zod contracts, prefix replay (the UI already projects `history.slice(0, n)`), the loopback runtime server, the command-center frame and design system, the scrubber and its accessibility work, the e2e harness, and the evaluation harness style.

**Changes:** new run-event contracts and run reducer next to the mission ones (mission reducer untouched); the budget ledger rules generalized from reserve-before-work to charge-after-the-fact; evidence audit generalized from fixture annotations to claims tied to captured outputs (Phase 5); the Replay screen, Agent Desk and Final Report generalized to runs; the runtime server gains a local import endpoint; `humanizeType` becomes the readable label source.

**Unused but kept (not deleted, not extended):** scheduler and commander, risk policy, tribunal, blind review, divergence detection, candidate ranking, the Codex subscription-worker stack (ADR-012 to ADR-020), the Google Trends source (ADR-021, ADR-022). Review Office and Tribunal Room remain for the demo domain only. Deleting dormant code is a later decision.

## (e) ADRs required

Both are architecture changes needing your approval, and independent read-only review (Codex gpt-6.1-sol preferred, Opus fallback, one review per SHA, your approval each time).

1. **ADR-026: Product pivot to agent run forensics.** Supersedes the frozen plan's purpose and milestone sequence (Milestones 2 to 6 as written, including Codex as the planned worker runtime). Retains: observation-only, local-only, event-sourced, JSONL authoritative, pure reducer, sequence authority, no network. States dropshipping is a demo domain. The plan file itself stays as history.
2. **ADR-027: Run-event contract and trace import boundary.** Defines the run-event family, the importer interface, the derived-order rule, the lossless-or-itemized import rule, the content and privacy rules (local only, secret scan on import, real traces never committed, only synthetic or redacted traces in fixtures), and what "state at step N" means (cumulative usage, open and closed steps, evidence available, claims asserted, budget remaining).

Also needed later: `CLAUDE.md` and the public-release docs say "dropshipping research lab", so they need updating. `CLAUDE.md` changes need independent review, so the pending "Terra" line fix goes into that same change.

## (f) What to validate first

Phase 0 gate, zero API cost, about a day. With one real trace of 50 or more spans that includes LLM and tool spans (ideally a retry or failure):

1. Import is lossless or itemized: every dropped or unrecognized item appears as an `ImportNote`.
2. Determinism: importing twice gives a byte-identical run log, and replaying to step N twice gives identical state.
3. Fidelity: the final reconstructed totals (token sums, span count, final status) match the trace's own data.
4. Content: does the trace carry tool outputs and prompts? The answer decides whether Phase 5 stays in v1.
5. The real trace scrubs usefully in the existing replay UI with readable labels.
6. A short competitor check: do Phoenix, Langfuse or LangSmith already offer state-at-step, budget replay or run diff? My search was inconclusive.

Go/no-go: if 1 to 3 fail because of the format rather than our bugs, or the competitor check shows the four strengths already exist, stop and bring you the options (hybrid with due-diligence, or another trace format). Two implementation attempts maximum, per the workflow.

**Needs from you:** one real trace, or approval to use this session's Claude Code transcript.

## (g) Risks

- **Crowded market.** If it ends up a viewer, it loses. The differentiators must be provable: determinism, offline use, re-applied budgets and claim verification.
- **Unstable format.** The OTel GenAI conventions are in Development and changing. Mitigation: version pinning and an adapter boundary.
- **No content in traces.** Content capture is opt-in, which weakens claim checking and state reconstruction. Phase 5 is the part most likely to be cut.
- **Sensitive data.** Traces can contain prompts, secrets and personal data. Local-only handling, an import-time secret scan, and a gitignored import directory are ADR-027 requirements.
- **Ordering fidelity.** Concurrent spans and clock skew make the replay order derived, not true.
- **Overclaiming.** "Exact state" is state as recorded. Budget "enforcement" is counterfactual (the tool never controls the agent), so the UI must say "would have stopped", not "stopped".
- **Dormant code.** Roughly two thirds of the engine goes unused at first, adding maintenance weight and confusing the repo story until the docs are updated.
- **Review overhead.** Two ADRs plus reviews of the importer and reducer and of the budget change are required gates. They are the likeliest cause of slip.
- **Test gaps.** CI does not run e2e and visual baselines are win32-only, so UI regressions can slip past CI.
