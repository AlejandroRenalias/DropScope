# DropScope — Architecture Baseline v1

**Status:** Frozen review baseline, pre-implementation  
**Date:** 2026-08-28  
**Supersedes:** `DROPSCOPE_FINAL_PROJECT_PLAN.md`  
**Next implementation artifact:** A failing test for Milestone 1A.0  

## 1. Executive summary

DropScope is a local, multi-agent dropshipping research laboratory presented as a friendly illustrated research office. A commander agent receives a mission, decomposes it into bounded tasks, coordinates specialist agents, moderates disagreements, controls usage, and responds to an independent review process.

The first product goal is to help a beginner learn markets, identify customer problems, observe trend and advertising-saturation signals, expose failure modes, and decide what deserves further investigation. DropScope does not promise “winning products,” predict commercial success, or take business actions.

The first engineering goal is to learn agent orchestration. Milestone 1A therefore uses deterministic simulated agents and synthetic evidence. It proves scheduling, concurrency, budgets, evidence handling, review, recovery, and replay before real models or live web research are introduced.

This baseline freezes the following load-bearing decisions:

- Simulation before real agents
- Deterministic authority outside model judgement
- A pure reducer and append-only event history
- Genuine asynchronous scheduling
- Dynamic protection of the remaining mandatory pipeline
- Blind review using a separate frozen rubric
- Evidence-driven candidate selection
- Risk and eligibility as a gate
- Local-first execution
- Runtime adapters between orchestration and workers
- Strict separation between engine and interface
- TypeScript with runtime schema validation

## 2. Product statement

> DropScope is an autonomous dropshipping research war room that discovers trend-driven candidates, validates customer problems, measures advertising-saturation signals, red-teams opportunities, and produces evidence-labelled investigation priorities.

It answers:

- What should I learn about this market?
- Which customer problems have evidence?
- Which product directions deserve more investigation?
- How crowded does the observed advertising environment appear?
- What could make an opportunity fail?
- What decision-critical evidence is missing?
- What is the smallest sensible next experiment?

It does not determine:

- Which product will be profitable
- What the user should immediately sell
- Whether public trend or advertising data represents real demand
- Whether a product is compliant in every jurisdiction
- Whether a business will succeed

## 3. Goals and non-goals

### 3.1 Product goals

- Accept one research mission and make the agent organization visible.
- Support market learning, problem-first discovery, advertising-saturation analysis, and failure autopsies.
- Report every candidate that clears the gates, capped at five.
- Preserve every authoritative decision, event, source, claim, disagreement, review, revision, and usage charge.
- Produce a professional report and a complete mission replay.
- Run locally before any hosted runtime is considered.

### 3.2 Learning goals

- Learn the difference between a model, an agent, and an orchestration engine.
- Learn deterministic control around nondeterministic workers.
- Learn dependency graphs and real concurrency.
- Learn state reduction, event history, and crash recovery.
- Learn cost and usage controls.
- Learn evidence provenance and independent review.
- Learn Git, tests, databases, APIs, and local web development through a working project.

### 3.3 Non-goals

DropScope will not initially:

- Create or operate a store.
- Purchase products or samples.
- Contact customers, suppliers, or platforms.
- Generate or publish advertisements.
- Copy competitor creatives or protected material.
- Scrape logged-in services or bypass access controls.
- Make legal, tax, safety, recall, IP, or compliance determinations.
- Present investigation priority as commercial certainty.
- Require a paid model API.
- Support accounts, teams, cloud deployment, or mobile-first use.

## 4. Operating model and permissions

The first user runs DropScope locally on a Windows PC. Milestones 1A and 1B use synthetic data and require no network, model credentials, accounts, or paid API.

The system remains observation-only throughout the planned research milestones. It may eventually search approved public sources and analyze user-supplied URLs or exports. It may not autonomously spend money, publish, contact anyone, create accounts, log in to services, place orders, launch advertisements, or perform financial transactions.

Retrieved content is always untrusted input. It cannot change system instructions, grant tools, or authorize actions.

## 5. Mission types

### 5.1 Learn a Market

Example:

> Explore safe dropshipping categories globally, identify recurring customer problems, and validate the strongest directions for an English-speaking target market.

The mission explains market structure, discovers candidates, validates customer problems, applies the risk gate, examines advertising-saturation signals, challenges assumptions, and reports one to five investigation priorities. If no candidate clears the gates, it completes with insufficient evidence.

### 5.2 Failure Autopsy

Later accepted inputs:

- Product name or description
- Product URL
- Store URL
- Hypothetical business idea

The mission attacks problem evidence, advertising conditions, differentiation, unit economics, logistics, returns, safety, regulatory, and IP assumptions. An advocate and prosecutor construct opposing evidence-supported cases.

### 5.3 Product Investigation

This later mission combines initial opportunity research with an automatic failure autopsy. It is not part of Milestone 1A.

## 6. Research funnel

```text
Mission
  -> Required baseline research
  -> Trend-driven discovery
  -> Customer-problem validation
  -> Risk and eligibility gate
  -> Advertising-saturation analysis
  -> Candidate evidence scoring
  -> Shortlist of 0-5 candidates
  -> Advocate/prosecutor tribunal
  -> Evidence audit
  -> Blind independent review
  -> Reconciliation and one focused revision cycle if required
  -> Final report or terminal insufficient-evidence outcome
```

Trend signals generate candidates; they never prove demand. The engine may declare insufficient evidence only after required baseline work has completed and all actionable gaps or contradictions justified by policy and budget have been resolved, exhausted, or declined. It cannot terminate while authorized work capable of changing the result remains in flight.

## 7. Agent organization

### 7.1 Permanent control roles

#### Commander

- Interprets the mission.
- Creates the dependency graph and baseline plan.
- Opens actionable research gaps.
- Proposes task authorization.
- Monitors budget and concurrent work.
- Detects conflicts and duplicates.
- Moderates the tribunal.
- Responds to audits, divergence, and review.
- Revises, reassigns, stops, or finishes honestly.

Milestone 1A implements the commander as deterministic policy. Later, an LLM may propose plans and decisions, but the deterministic engine remains the only authority that can authorize tasks, spend budget, transition state, or grant tools.

#### Independent Reviewer

- Scores anonymized evidence using a separate frozen rubric.
- Produces eligibility, ranking, confidence, and missing-evidence findings before seeing commander output.
- Reconciles its result with the commander draft afterward.
- Returns accept, revise, reassign, or reject.

The reviewer is independent over interpretation and only partially independent over scope in Milestone 1A. It sees the evidence the commander commissioned. It may detect unresearched decision-critical gaps, but it does not independently launch research.

#### Evidence Auditor

- Verifies claim-to-evidence alignment.
- Enforces evidence independence rules.
- Detects source, fact, research, and annotated claim duplication.
- Tracks contradictions and tentative claims.
- Re-audits changed claims after revision.

#### Risk & Eligibility Gatekeeper

- Applies transparent product-risk policy.
- Returns `ALLOWED`, `RESTRICTED`, `MANUAL_REVIEW`, or `REJECTED`.
- Uses categorized reason codes.
- Prevents unresolved or rejected candidates from entering the main ranking.

### 7.2 Research specialists

- **Pulse:** Trend discovery and durability
- **Echo:** Customer problems and review themes
- **Radar:** Advertising-saturation signals
- **Atlas:** Geography and market context
- **Faultline:** Failure modes and assumption attacks
- **Ledger:** Unit-economics plausibility
- **Sentinel:** Supplier, shipping, product-risk, and IP indicators

### 7.3 Tribunal roles

- **Venture:** Strongest evidence-supported case for continued investigation
- **Ruin:** Strongest evidence-supported case for rejection or caution

Agent personalities are presentation only. They cannot change policy, evidence requirements, scoring, or permissions.

## 8. Canonical contracts

The authoritative contract definitions are in [`../schemas/contracts.md`](../schemas/contracts.md). Runtime validation uses Zod when TypeScript implementation begins.

The load-bearing records are:

- `EvidenceRecord`
- `SourceRecord`
- `ClaimRecord`
- `OpenGap`
- `TaskRecord`
- `TaskAttemptRecord`
- `EventEnvelope`
- `FixtureManifest`

Findings reference `evidenceIds[]`; they do not embed loosely structured evidence.

`EvidenceRecord` includes `independenceGroupId`, signed `strength`, and `claimId`. Reliability is fixture-declared in 1A. These fields support source-independence counting, evidence thresholds, duplicate detection, and focused re-audit.

## 9. Frozen evidence policy

The numeric policy is defined in [`../policies/evidence-policy.yaml`](../policies/evidence-policy.yaml) and must be frozen before Fixtures B and C are authored.

Initial values:

- `minimumCustomerProblemEvidenceScore: 65`
- `minimumEvidenceQualityScore: 70`
- `minimumIndependentGroupsForNonTentativeDecisiveClaim: 2`

Fixture failure is corrected by changing fixture data, never by tuning thresholds. A threshold or formula change requires a superseding ADR and invalidates fixture outcome expectations until the policy is frozen again.

## 10. Candidate eligibility and reporting

DropScope ranks investigation priority, not predicted profitability.

### 10.1 Eligibility gates

A main-ranking candidate must:

- Have gate outcome `ALLOWED`.
- Meet the customer-problem evidence threshold.
- Meet the evidence-quality threshold.
- Have no unresolved blocking contradiction.
- Have no decision-critical missing-evidence divergence that policy says blocks publication.
- Label a decisive claim with fewer than two independent groups as tentative.

### 10.2 Gate consequences

- **ALLOWED:** May enter the main ranking at any position.
- **RESTRICTED:** Continues through research and appears clearly marked in the report, but is held out of the main eligible ranking.
- **MANUAL_REVIEW:** Remains unresolved, is reported separately, and cannot enter the main ranking in 1A.
- **REJECTED:** Cannot enter the ranking and remains visible in history with reason codes.

Reason categories:

- `SAFETY`
- `REGULATORY`
- `INTELLECTUAL_PROPERTY`
- `POLICY`
- `INSUFFICIENT_INFORMATION`

Recall status and IP indicators remain human-review flags in later live research; DropScope does not determine them.

### 10.3 Candidate count

- Report every `ALLOWED` candidate that clears the evidence gates.
- Cap the main ranking at five.
- One or more clearing candidates produces a normal completed report, optionally labelled low-yield.
- Zero clearing candidates produces `COMPLETED_INSUFFICIENT_EVIDENCE`.
- Thresholds are never weakened to fill a list.

## 11. Commander and gap policy

The frozen commander policy is in [`../policies/commander-policy.yaml`](../policies/commander-policy.yaml).

Two earlier epistemic clauses are removed. Deterministic code does not guess whether research “could matter.” Instead it operates on an explicit `OpenGap` register.

A task is admissible only when:

- It belongs to the required baseline plan; or
- Its `researchKey` resolves an open actionable gap.

Every gap declares affected candidates, affected decision types, severity, origin, and status. A gap may be opened by baseline planning, evidence audit, blind review, divergence, failure, or contradiction detection.

Additional task rules:

- Dependencies must be complete.
- No active or completed task may cover the same research key.
- Sufficient discretionary budget must remain after protecting the mandatory pipeline.
- The mission must be nonterminal.
- The task must be permitted by tool and action policy.

Milestone 1A allows one transient retry per task, one recovery restart per mission, and one focused revision cycle.

## 12. Separate reviewer policy

The reviewer rubric is defined and frozen separately in [`../policies/reviewer-rubric.yaml`](../policies/reviewer-rubric.yaml).

Commander and reviewer may share contracts, evidence, claims, sources, and risk results. They may not share scoring implementation. The reviewer never receives commander scores, ranking, eligibility decisions, tribunal verdict, presentation order, or agent identity during blind review.

The commander optimizes investigation priority. The reviewer emphasizes evidential defensibility:

- Source independence: 30%
- Decision-critical coverage: 25%
- Contradiction handling: 20%
- Claim-to-evidence alignment: 15%
- Uncertainty calibration: 10%

The reviewer freezes its result before reconciliation. Tuning its rubric to make fixtures agree is prohibited.

### 12.1 Divergence types

- Eligibility divergence
- Top-candidate divergence
- Rank-position divergence of two or more positions
- Material confidence divergence
- `MissingEvidenceDivergenceDetected`

Missing-evidence divergence fires when the blind reviewer identifies a decision-critical gap, no completed or active task covers its research key, and the gap affects eligibility, ranking, confidence, or a blocking decision. Policy may block publication until the gap is resolved, exhausted, or explicitly left unresolved.

## 13. Determinism model

### 13.1 Randomness

- `missionSeed` is persisted in `MissionCreated`.
- Every task attempt derives an independent random stream from `(missionSeed, taskId, attemptNumber)`.
- Concurrent tasks never read a global random generator.
- Every random value that affects execution is persisted in the event that consumed it.
- Replay reads history and never re-rolls.

### 13.2 Reducer purity

The reducer is exactly:

```text
newState = reduce(oldState, event)
```

It may not access clocks, randomness, files, environment variables, network, models, workers, or other mutable state. `sequenceNumber` is authoritative ordering. Timestamps are informational and never affect behavior.

### 13.3 Same logical outcome

Seeded runs may differ in:

- Wall-clock timestamps
- Real durations
- Interleaving of events from concurrent independent tasks

They must agree on:

- Terminal mission state
- Candidate eligibility set
- Final ranking
- Final confidence classes
- Budget ledger totals
- Gate decisions and reason codes
- Retry and reassignment decisions
- Divergence event set
- Unresolved gap set
- Reviewer verdict

## 14. State machines

The authoritative tables are in [`../state-machines.md`](../state-machines.md).

Task lifecycle is authoritative. Mission phase is a projection for display and reporting; it never gates task execution.

Terminal mission states are authoritative:

- `COMPLETED`
- `COMPLETED_INSUFFICIENT_EVIDENCE`
- `BLOCKED_POLICY`
- `BLOCKED_BUDGET`
- `FAILED_UNRECOVERABLE`

Illegal transitions do not mutate authoritative state. The command handler appends `TransitionRejected` with the attempted transition and reason.

## 15. Tasks, attempts, retry, and recovery

Task and attempt are separate objects. Every attempt has an ID such as `echo-problem-validation-04:a2`.

- Retry creates a new attempt under the same task.
- Recovery creates a new attempt; the interrupted attempt remains permanently `INTERRUPTED`.
- Interruption does not consume the transient-worker retry allowance.
- Permanent worker failure is never retried with the same worker. It may be reassigned to a compatible worker when policy permits; otherwise an unresolved gap is recorded.
- Recovery restarts are capped at one per mission in 1A.

Completion submissions carry `attemptId` and an idempotency key. A completion is authoritative only if its attempt is currently `RUNNING`. A late or repeated completion produces `StaleCompletionIgnored` and creates no duplicate finding, usage charge, or terminal event.

## 16. Genuine asynchronous scheduling

- Tasks form an acyclic dependency graph.
- Up to three dependency-independent specialists may be `RUNNING` simultaneously.
- The scheduler continues admitting eligible work while other tasks are in flight.
- Dependent tasks cannot start before predecessor completion events.
- Completion events may arrive out of order.
- Partial failure does not pause unrelated work.
- Seeded latency and failure belong to each attempt’s independent random stream.
- Measured execution intervals must demonstrate actual overlap across multiple seeds.

## 17. Budget model

Default mission budget: **120 research units**.

### 17.1 Ledger states

- **Available:** Unallocated budget.
- **Reserved:** Budget authorized for work that has not started.
- **Committed:** Work started; usage is assumed consumed.
- **Spent:** Finalized historical usage.

At all times:

```text
available = total - reserved - committed - spent
```

`protectedMandatoryBudget` is computed from current authoritative state rather than fixed. It equals mandatory authorized-but-unstarted reservations plus the cost of mandatory pipeline work not yet reserved. Before optional work is reserved:

```text
spent + committed + reserved + optionalCost
  + remainingMandatoryUnreservedCost <= totalBudget
```

Equivalent policy views may expose:

```text
protectedBudget = reservedMandatory + remainingMandatoryUnreservedCost
```

The protected amount falls as mandatory stages complete. If initial review creates a mandatory focused revision, its revision, re-audit, and re-review costs become protected immediately.

### 17.2 Costs

| Activity | Units |
|---|---:|
| Planning | 2 |
| Specialist attempt | 10 |
| Tribunal | 12 |
| Initial audit | 8 |
| Blind/reconciliation review | 8 |
| Focused revision | 8 |
| Focused re-audit | 4 |
| Focused re-review | 6 |
| Final report | 2 |

### 17.3 Worst-case required 1A path

- Planning: 2
- Four successful specialist attempts: 40
- One transient failed attempt: 10
- One interrupted attempt followed by mission-level recovery restart: 10 additional units; the successful restarted attempt is already included among the four successful attempts
- Tribunal: 12
- Initial audit: 8
- Initial review: 8
- Focused revision: 8
- Focused re-audit: 4
- Focused re-review: 6
- Final report: 2
- **Total: 110 units**

The remaining 10 units are contingency.

### 17.4 Interruption charging decision

Interrupted work is charged in Milestone 1A even though no model ran. This intentionally overcharges simulation so accounting semantics match Milestone 2, where interrupted model work may have consumed tokens. The tradeoff is recorded as an architectural decision. A mission-level recovery cap prevents repeated process crashes from consuming the whole budget through per-task restarts.

## 18. Event log and persistence guarantees

Every authoritative change is an immutable event in append-only JSONL.

Each event includes schema version, sequence number, mission ID, event ID, event type, timestamp, correlation ID, causation ID, and structured payload.

Guarantees:

- One authoritative writer per mission.
- Strictly increasing sequence numbers.
- An event is persisted only after the complete serialized line and newline are durably written.
- Recovery may discard only a demonstrably truncated final line.
- A malformed record anywhere else is a hard failure.
- Ordinary recovery appends and never rewrites history.
- Discarding a truncated final line is the single recovery truncation exception.
- Recovery appends `RecoveryStarted` describing detected tasks and any truncated-line disposition.
- Checksums are optional in 1A.

Prefix replay is required: replaying every event-history prefix must reconstruct the recorded state after that event.

## 19. Duplicate policy

- **Source duplicate:** Same normalized URL or source ID
- **Fact duplicate:** Same canonical fixture fact ID
- **Research duplicate:** Same candidate, research question, geography, and time window
- **Claim duplicate:** Same canonical claim topic with substantially overlapping canonical evidence

Fixtures provide explicit canonical annotations. Semantic duplicate detection, embeddings, and vector databases are outside 1A.

## 20. Synthetic fixtures

The same engine, policy, scoring, audit, review, eligibility, and report code processes every fixture.

### Fixture A — Mixed Opportunity Market

- Multiple categories and eight candidates
- One rejected candidate
- One transient worker failure
- Duplicate evidence
- Misleading trend spike
- Weak unit economics
- A decisive claim missing its required evidence relation
- A defensible commander/reviewer ranking divergence
- One focused revision cycle

The blocking report defect must emerge generically from evidence. No component knows the fixture’s intended story.

### Fixture B — Evidence Drought

- Superficially interesting candidates
- Weak problem evidence
- Contradictory findings
- Poor independence
- Zero candidates clear all gates

Expected terminal state: `COMPLETED_INSUFFICIENT_EVIDENCE`.

### Fixture C — Risk Ambiguity

- Two clearly rejected candidates
- One restricted or manual-review candidate
- Several allowed candidates
- Conflicting risk information
- One permanent worker failure

Permanent failure is reassigned only when policy permits; otherwise it leaves an unresolved gap.

### Small terminal scenarios

Focused tests cover maximum revisions reached and a declined budget increase. These may be compact scenarios rather than full market fixtures.

### Holdout Fixture D

Fixture D is authored only after A, B, C, engine behavior, thresholds, commander policy, and reviewer rubric are frozen. It is not used during design or tuning.

If D requires policy or orchestration changes, generalization was weaker than the original suite suggested. The result, including failure, remains a public learning artifact.

## 21. Technical architecture

```text
CLI / later Web UI
  -> Application services
    -> Orchestration engine
      -> Pure reducer
      -> Task/attempt state machines
      -> Dependency scheduler
      -> Budget ledger
      -> Commander policy
      -> Evidence and risk policies
      -> Blind review workflow
    -> Runtime adapters
      -> Simulated worker adapter
      -> Local Codex adapter (later)
      -> Optional API adapter (later)
    -> Persistence adapters
      -> JSONL event store
      -> Optional SQLite read projections (1B)
```

The orchestration engine imports no UI or model-provider code.

### 21.1 Stack

- TypeScript as the primary language
- A supported Node.js LTS runtime chosen at implementation time
- Zod for runtime validation of events, commands, fixtures, evidence, and worker results
- Vitest for engine and asynchronous tests
- React, TypeScript, and Vite for the 1B interface
- Playwright for interface acceptance tests
- JSONL as authoritative mission history
- Optional SQLite projections for 1B queries
- Codex SDK adapter explored in Milestone 2

No generated code may merge without a test the user wrote or can independently verify failing before the change and passing afterward.

## 22. Milestone 1A vertical slices

### 1A.0 — Walking skeleton

Mission created → trivial task scheduled → budget committed → task executed → result persisted → events reduced → mission finished.

Then terminate the process mid-flight and prove restart, reconstruction, interruption, recovery policy, and completion.

**Gate:** No commander scoring, tribunal, audit, review, or product logic until 1A.0 survives recovery.

### 1A.1 — Contracts and state

- Zod contracts
- Events
- Pure reducer
- Task/attempt lifecycle
- Mission projection and terminal states

### 1A.2 — Scheduler

- Dependency graph
- Genuine concurrency
- Task attempts
- Independent seeded randomness

### 1A.3 — Budget and authorization

- Four ledger states
- Computed mandatory protection
- Commander authorization
- Gap register

### 1A.4 — Research domain

- Candidates
- Sources, claims, and evidence
- Thresholds
- Risk and eligibility gate

### 1A.5 — Quality pipeline

- Tribunal
- Evidence audit
- Blind reviewer
- Divergence events

### 1A.6 — Revision and resilience

- Focused revision
- Re-audit and re-review
- Transient and permanent failure
- Interruption
- Stale completion handling
- Recovery cap

### 1A.7 — Fixtures and acceptance

- Fixtures A, B, and C
- Terminal micro-scenarios
- Full acceptance suite
- Freeze engine and policies
- Author and run holdout D afterward

## 23. Later milestones

### Milestone 1B — Research Office interface

Friendly illustrated office, mission lobby, task board, agent desks, tribunal, review comparison, budget display, report, and event replay. UI state is always derived from engine events and cannot bypass policy.

### Milestone 2 — Local Codex workers

Introduce a runtime adapter one specialist at a time. Validate structured output with Zod. Observe Plus-plan usage. LLM commander proposals remain behind deterministic authorization.

### Milestone 3 — Controlled public-web research

Add approved public sources, user-supplied URLs, source capture, citation provenance, prompt-injection defenses, and live duplicate experiments. Recall and IP remain human-review flags.

### Milestone 4 — Full mission modes

Add Learn a Market, Failure Autopsy, Product Investigation, URL inputs, and geography-specific validation through one shared engine.

### Milestone 5 — Evaluation and usage optimization

Experiment with agent count, concurrency, review cycles, reasoning effort, and LLM-assisted planning. More than one revision cycle belongs here.

### Milestone 6 — Public release

Secret audit, installation guide, architecture overview, fixtures, holdout result, example replays, limitations, responsible-use document, and open-source license.

## 24. Milestone 1A acceptance criteria

1. A, B, and C use the same engine without code changes.
2. Swapping fixture data changes outcomes without editing orchestration code.
3. Fixture B reaches `COMPLETED_INSUFFICIENT_EVIDENCE` only after relevant authorized work finishes.
4. Fixture C produces policy-based gate outcomes and reason codes.
5. At least two dependency-independent tasks occupy `RUNNING` simultaneously; the scheduler admits eligible work while tasks are in flight; dependent tasks never start early; measured intervals show overlap across multiple seeds.
6. Completion events may arrive out of order without breaking dependencies.
7. Partial failure does not pause unrelated work.
8. In-flight usage is committed and accounted for.
9. Transient failure is retried or reassigned according to policy.
10. Source, fact, research-key, and annotated claim duplicates are detected.
11. Blind reviewer output is committed before reconciliation.
12. Defensible policy differences produce divergence events without fixture-specific logic.
13. Changed claims are re-audited and re-reviewed.
14. Optional work cannot consume the computed mandatory protection.
15. Replaying every event-history prefix reconstructs the recorded state after that event.
16. Interrupted missions recover without rewriting ordinary history.
17. Reports contain one to five allowed candidates, or insufficient evidence when zero clear the gates.
18. No fixture ID, fixture candidate ID, or expected fixture outcome appears in orchestration, scheduling, policy, scoring, auditing, review, eligibility, or report code.
19. CLI output exposes final state, ledger, unresolved gaps, and event history.
20. Seeded runs satisfy the defined logical-outcome equivalence.
21. Illegal task and mission transitions are rejected without mutating authoritative state.
22. Identical event sequences reduce identically without clock, randomness, network, filesystem, or runtime access.
23. Each attempt draws randomness only from mission seed, task ID, and attempt number.
24. Every authoritative event preserves the budget invariant.
25. All four gate outcomes have tested ranking and report behavior.
26. Re-delivered or stale completion produces `StaleCompletionIgnored` and no duplicated finding, charge, or terminal event.
27. Blind ranking consumes no commander scoring, ranking, eligibility, tribunal, presentation-order, or identity input.
28. Unresearched decision-critical evidence creates missing-evidence divergence and blocks publication when policy requires.
29. Permanent worker failure is not retried with the same worker, is reassigned when allowed, and otherwise creates an unresolved gap.
30. Interruption does not consume transient retry allowance; recovery restarts are capped per mission.
31. A demonstrably truncated final JSONL line is handled and disclosed in `RecoveryStarted`; malformed earlier history fails hard.

### Holdout criterion added after Fixture D exists

32. Frozen engine and policies process previously unseen Fixture D without changes; any failure or required change is recorded rather than hidden.

## 25. Deliberately excluded from Milestone 1A

- Postgres
- Redis
- Message brokers
- Docker orchestration
- Kubernetes
- Cloud deployment
- Authentication
- Multi-user support
- Vector databases
- Embeddings
- Semantic duplicate detection
- Live web research
- Real LLM agents
- Supplier or advertising integrations
- Distributed event-sourcing infrastructure

JSONL, a pure reducer, an async scheduler, a simulated runtime, and a local CLI are sufficient.

## 26. Ground-truth limitation

Synthetic fixtures validate orchestration behavior, not commerce predictions. Later live reports may be coherent, cited, reviewed, and still commercially wrong because public trend, advertising, pricing, and supplier data are incomplete and noisy.

DropScope evaluates evidence handling and investigation priority. It must not be trusted as a reason to spend money without separate customer research, supplier samples, compliance review, and controlled validation.

## 27. Development process using agents

Development may use a primary coding agent as implementation commander and bounded subagents for independent tasks such as contract review, fixture design, scheduler tests, or interface work. Parallel implementation is permitted only when ownership and dependencies are clear. All work is integrated through the shared acceptance suite and an independent review pass.

The user participates at milestone demonstrations and any decision that changes scope, permissions, cost, public behavior, or frozen policies.

## 28. Baseline artifacts

Architecture Baseline v1 consists of:

- This document
- [`../policies/commander-policy.yaml`](../policies/commander-policy.yaml)
- [`../policies/evidence-policy.yaml`](../policies/evidence-policy.yaml)
- [`../policies/reviewer-rubric.yaml`](../policies/reviewer-rubric.yaml)
- [`../schemas/contracts.md`](../schemas/contracts.md)
- [`../state-machines.md`](../state-machines.md)
- [`../adr/ADR-009-typescript-primary-language.md`](../adr/ADR-009-typescript-primary-language.md)
- [`../adr/ADR-010-charge-interrupted-attempts.md`](../adr/ADR-010-charge-interrupted-attempts.md)
- [`FREEZE_CHECKLIST.md`](FREEZE_CHECKLIST.md)

## 29. Freeze rule

The architecture is frozen when the baseline checklist passes. Future changes to load-bearing semantics require a superseding ADR. Fixture outcomes may not be used to tune thresholds or reviewer weights.

After freeze, review stops. The next artifact is a failing test for 1A.0, followed by the smallest implementation that makes it pass.
