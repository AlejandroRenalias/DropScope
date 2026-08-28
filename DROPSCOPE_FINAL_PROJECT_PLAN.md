# DropScope — Final Project Plan

**Document status:** Final review candidate  
**Project stage:** Pre-implementation  
**Primary platform:** Local Windows web application  
**Repository plan:** Build privately/local-first, then publish as a public GitHub repository after security and documentation review

## 1. Executive summary

DropScope is a local, multi-agent dropshipping research laboratory presented as a friendly illustrated research office. A commander agent receives a mission, divides it into bounded tasks, coordinates specialist agents, moderates disagreements, controls research usage, and responds to an independent review process.

The first product focus is not automatic store creation or a promise to find “winning products.” DropScope helps a beginner learn markets, identify customer problems, examine trend and advertising-saturation signals, expose failure modes, and decide what deserves further investigation.

The project is also a learning environment for agent orchestration. Its first implementation uses deterministic simulated agents and synthetic data so concurrency, budgets, review loops, recovery, and evidence handling can be tested without model costs or unverifiable web research. Real local Codex agents and public-web tools are introduced only after the orchestration engine is proven.

The system is observation-only during the planned milestones. It cannot spend money, publish content, contact suppliers, create stores, purchase products, or launch advertisements.

## 2. Product statement

> DropScope is an autonomous dropshipping research war room that discovers trend-driven candidates, validates customer problems, measures advertising-saturation signals, red-teams opportunities, and produces evidence-labelled investigation priorities.

DropScope answers:

- What should I learn about this market?
- Which customer problems appear worth investigating?
- Which product directions have enough evidence to continue?
- How crowded does the advertising environment appear?
- What could cause this idea to fail?
- What evidence is missing?
- What is the smallest sensible next experiment?

It does **not** answer with certainty:

- Which product will be profitable
- What product the user should immediately sell
- Whether public trend or advertising data represents real demand
- Whether a supplier or product is legally compliant in every jurisdiction
- Whether a business will succeed

## 3. Project goals

### Product goals

- Let a user submit one research mission and watch an agent organization execute it.
- Support market learning, problem-first discovery, advertising-saturation research, and failure autopsies.
- Produce between zero and five evidence-supported product directions.
- Preserve every decision, event, source, claim, disagreement, review, revision, and usage charge.
- Provide a professional report and a complete mission replay.
- Operate locally before any hosted or public runtime is considered.

### Learning goals

- Understand the difference between an LLM, an agent, and an orchestration engine.
- Learn deterministic control around nondeterministic workers.
- Learn task decomposition, dependencies, and genuine concurrency.
- Learn event-driven architecture and state reconstruction.
- Learn usage budgeting and cost-quality tradeoffs.
- Learn evidence provenance, review independence, and failure recovery.
- Gain practical experience with Git, tests, databases, APIs, and a local web application without studying a programming language in isolation first.

## 4. Non-goals

DropScope will not initially:

- Create or operate a dropshipping store.
- Purchase samples or inventory.
- Contact customers, suppliers, or platforms.
- Generate or publish advertisements.
- Copy competitor creatives, listings, or protected material.
- Scrape logged-in services or bypass access controls.
- Make legal, tax, safety, or compliance determinations.
- Present research priority as commercial certainty.
- Place trades or provide financial-market recommendations.
- Support multiple users, cloud accounts, or team collaboration.
- Optimize for mobile before the desktop experience is stable.

## 5. Intended user and operating model

The first user is a beginner working locally on a Windows PC with ChatGPT Plus and limited budget. The application should allow experimentation without requiring the user to understand TypeScript or agent frameworks before starting.

The first version is single-user and local-only:

- No account system
- No remote database
- No public deployment
- No external actions
- No paid model API requirement
- Synthetic fixtures included in the repository

## 6. Core mission types

### 6.1 Learn a Market

Example:

> Explore several safe dropshipping categories globally, identify recurring customer problems, and validate the strongest directions for an English-speaking target market.

Expected work:

- Explain relevant dropshipping models.
- Map customer groups and recurring problems.
- Discover trend-driven candidates.
- Apply the product-safety gate.
- Examine advertising-saturation signals.
- Identify likely operational and economic weaknesses.
- Return zero to five investigation priorities.

### 6.2 Failure Autopsy

Accepted inputs will eventually include:

- Product name or description
- Product URL
- Store URL
- Hypothetical business idea

Expected work:

- Identify weak or temporary problem evidence.
- Examine advertising crowding.
- Find undifferentiated supplier products.
- Challenge unit-economics assumptions.
- Identify shipping, return, safety, and intellectual-property risks.
- Conduct an advocate-versus-prosecutor tribunal.
- Report what evidence would change the conclusion.

### 6.3 Product Investigation

This later mission combines initial opportunity research with an automatic failure autopsy. It is not part of Milestone 1A.

## 7. Research funnel

The default Learn a Market mission follows this funnel:

```text
Mission
  -> Trend-driven discovery
  -> Customer-problem validation
  -> Safety and eligibility gate
  -> Advertising-saturation analysis
  -> Candidate evidence scoring
  -> Shortlist of 0-5 directions
  -> Advocate/prosecutor tribunal
  -> Evidence audit
  -> Blind independent review
  -> Reconciliation and revision
  -> Final report or insufficient-evidence outcome
```

Trend signals are discovery inputs, not proof of demand. Customer-problem evidence and evidence quality are gates that candidates must survive.

## 8. Agent organization

### 8.1 Permanent control roles

#### Commander

Responsibilities:

- Interpret the mission.
- Create the dependency-aware research plan.
- Assign bounded tasks.
- Authorize tasks through the deterministic control policy.
- Monitor committed and remaining usage.
- Detect missing, conflicting, or duplicated work.
- Moderate the tribunal.
- Respond to audits and reviews.
- Revise, reassign, stop, or finish with insufficient evidence.

The commander can eventually be LLM-assisted, but it can never bypass deterministic budget, safety, permission, or state-transition rules.

#### Independent Reviewer

Responsibilities:

- Independently score anonymized claim-and-evidence packets.
- Produce its own candidate eligibility decisions and ranking before seeing the commander’s draft.
- Compare its result with the draft during reconciliation.
- Return accept, revise, reassign, or reject.
- Provide exact blocking defects and revision requests.

#### Evidence Auditor

Responsibilities:

- Verify claim-to-source alignment.
- Identify unsupported decisive claims.
- Detect source and fact duplication.
- Track contradictions.
- Require uncertainty labels when evidence is weak.
- Re-audit every claim changed during revision.

#### Safety Gatekeeper

Responsibilities:

- Apply a transparent product-risk policy.
- Return allowed, restricted, manual review, or rejected.
- Provide reason codes and evidence requirements.
- Prevent rejected candidates from being ranked.

### 8.2 Research specialists

- **Pulse:** Trend discovery and durability
- **Echo:** Customer problems and review themes
- **Radar:** Advertising-saturation signals
- **Atlas:** Geography and market context
- **Faultline:** Failure modes and assumption attacks
- **Ledger:** Unit-economics plausibility
- **Sentinel:** Supplier, shipping, product-safety, and intellectual-property risk

### 8.3 Tribunal roles

- **Venture:** Constructs the strongest evidence-supported case for continued investigation.
- **Ruin:** Constructs the strongest evidence-supported case for rejection or caution.

Personalities make agents recognizable in the interface, but never change evidence requirements or permissions.

## 9. Structured agent communication

Agents do not exchange unrestricted prose as the authoritative state. Every important output must use a validated structured message.

### Task assignment

- Task ID
- Objective
- Research key
- Dependencies
- Boundaries
- Available evidence
- Expected output schema
- Usage allocation
- Completion criteria

### Finding

- Candidate ID
- Canonical claim topic
- Claim
- Evidence references
- Confidence
- Assumptions
- Contradictions
- Unanswered questions
- Suggested next action

### Challenge

- Claim being challenged
- Reason
- Counterevidence
- Severity
- Proposed resolution

### Review feedback

- Verdict
- Rubric scores
- Blocking defects
- Non-blocking observations
- Claims requiring correction
- Required revision scope

### Commander decision

- Decision type
- Reason
- Authorized tasks
- Budget effect
- Remaining unresolved issues

## 10. Deterministic commander policy

Milestone 1A uses a written rule set, not an LLM commander. Later LLM proposals must pass through the same rules.

### A task may be launched only when

- All dependencies are complete.
- The dependency graph is acyclic.
- No active or completed task already covers the same research key.
- The result could change eligibility, ranking, confidence, or a blocking review decision.
- Sufficient discretionary budget remains after protecting the quality reserve.
- The mission is not terminal.
- The task is permitted by the mission’s tool and action policy.

### Additional research is justified when

- A decisive claim lacks the required evidence.
- Material contradictions remain unresolved.
- The reviewer reports a blocking gap.
- A borderline safety decision lacks required information.
- Resolving the gap is expected to affect the result.

### Failure handling

- Retry one transient failure when budget allows.
- Reassign once when another compatible specialist exists.
- Do not retry permanent or policy failures.
- Record unresolved gaps when recovery is impossible or not worth its cost.
- Never hide failure by fabricating a result.

### Revision acceptance

A revision is accepted only when:

- Blocking issues are resolved or explicitly acknowledged.
- Changed claims pass focused re-audit.
- The focused reviewer accepts the revision.
- Candidate count and ranking remain evidence-driven.

### Terminal conditions

- Report accepted
- Fewer than three viable directions after a market-learning mission
- Quality reserve cannot complete the required pipeline
- Maximum revision count reached
- Policy violation prevents continuation
- Human declines a required budget increase
- Unrecoverable engine failure

## 11. Candidate eligibility and ranking

DropScope ranks **investigation priority**, not predicted profitability.

### Eligibility gates

A candidate must:

- Not be rejected by the safety gate.
- Meet the minimum customer-problem evidence threshold.
- Meet the minimum evidence-quality threshold.
- Have no unresolved blocking contradiction.
- Label decisive claims supported by only one source as tentative.

### Research-priority dimensions

- Customer-problem strength
- Evidence quality
- Trend durability
- Advertising headroom
- Operational feasibility
- Failure resilience

The initial deterministic weighting is configurable and visible:

| Dimension | Weight |
|---|---:|
| Customer-problem strength | 30% |
| Evidence quality | 20% |
| Trend durability | 15% |
| Advertising headroom | 15% |
| Operational feasibility | 10% |
| Failure resilience | 10% |

Safety is a gate, not a positive scoring opportunity. A low composite score must not conceal a serious safety concern.

### Candidate count

- Target: three to five viable directions
- Maximum: five
- Fewer than three: `completed_insufficient_evidence`
- The system never weakens thresholds to fill a list

## 12. Advertising-saturation scope

The first saturation feature is explicitly an **advertising-saturation signal**, not total market saturation.

Possible evidence:

- Observed number of advertisements
- Advertisement age and apparent longevity
- Repetition of the same product
- Repetition of hooks and creative patterns
- Number of advertisers using similar material
- Regional variation
- Recent directional change

Later, separate modules may examine seller saturation, price competition, and product sameness. These must not be silently merged into the advertising score.

## 13. Safety policy

The default policy favors simple, low-risk, non-electrical products.

Candidates are evaluated using declared attributes such as:

- Intended age group
- Ingestion or food contact
- Skin or eye contact
- Health or medical claims
- Electrical or battery components
- Heat, flame, sharpness, pressure, or protective function
- Required certifications or warnings
- Known recalls
- Intellectual-property indicators
- Target jurisdiction

Default restricted or rejected categories include:

- Food and supplements
- Cosmetics
- Medical claims and medical devices
- Children’s safety products
- Protective equipment
- Batteries and higher-risk electronics
- Products involving flame or extreme heat
- Products with obvious trademark, counterfeit, or copyright concerns

The gate returns reason codes. It is a research filter, not legal advice or certification.

## 14. Review architecture

### Phase 1: Blind evidence assessment

The reviewer receives:

- Anonymized candidate IDs
- Claims
- Evidence
- Confidence labels
- Safety results

It does not receive:

- Commander ranking
- Tribunal verdict
- Candidate presentation order
- Agent personalities
- Commander’s preferred conclusion

The reviewer commits its own eligibility decisions, scores, ranking, and missing-evidence list.

### Phase 2: Reconciliation review

The reviewer then receives the draft report. The engine compares:

- Top candidate
- Candidate eligibility
- Rank positions
- Confidence assessments

A divergence event is created when:

- Top candidates differ.
- Eligibility differs.
- A candidate differs by two or more rank positions.
- Confidence differs materially on a decisive claim.

The commander must resolve the divergence, record it as unresolved, or request additional budget. It cannot silently discard the independent ranking.

## 15. Usage-budget model

Milestone 1A uses provider-independent research units.

Default budget: **120 units**.

| Activity | Units |
|---|---:|
| Planning | 2 |
| Specialist task | 10 |
| Tribunal round | 12 |
| Initial evidence audit | 8 |
| Blind and reconciliation review | 8 |
| Focused revision | 8 |
| Focused re-audit | 4 |
| Focused re-review | 6 |
| Final report assembly | 2 |

A representative worst-case required path is:

- Planning: 2
- Four specialists: 40
- One failed-task retry: 10
- Tribunal: 12
- Initial audit: 8
- Initial review: 8
- Focused revision: 8
- Focused re-audit: 4
- Focused re-review: 6
- Final report: 2
- **Total: 100 units**

The remaining 20 units are contingency, not an invitation to spend automatically.

### Quality reserve

A hard 28-unit reserve protects:

- Initial audit: 8
- Initial review: 8
- Focused re-audit: 4
- Focused re-review: 6
- Final report: 2

Optional research cannot spend this reserve. Revision work uses discretionary budget. When real runtimes are introduced, research units will be accompanied by actual calls, tokens, elapsed time, and estimated monetary cost where available.

## 16. Genuine concurrency and scheduling

The engine uses a real asynchronous scheduler rather than interleaved fake activity.

Requirements:

- Tasks form a validated dependency graph.
- Up to three independent specialists may run concurrently.
- A mission may use at most four research specialists in Milestone 1A.
- Synthetic latency and failure are controlled by a reproducible random seed.
- Completion events may arrive out of order.
- A failure does not pause unrelated work.
- Budget is committed when a task starts.
- Already committed usage is not automatically refunded on cancellation or interruption.
- Dependent work cannot start until prerequisites have valid completion events.

## 17. Event log as the source of truth

Every authoritative change is an immutable mission event written to append-only JSONL.

Example events:

```text
MissionCreated
PlanCreated
BudgetReserved
TaskScheduled
TaskStarted
FindingSubmitted
ClaimChallenged
TaskFailed
TaskInterrupted
TaskRetried
CandidateRestricted
CandidateRejected
TribunalCompleted
AuditCompleted
BlindReviewCompleted
RankingDivergenceDetected
RevisionRequested
FocusedReviewCompleted
ReportPublished
MissionCompleted
```

Each event contains:

- Schema version
- Sequence number
- Mission ID
- Event ID
- Event type
- Timestamp
- Correlation ID
- Causation ID
- Structured payload

Current state is derived by replaying events through a pure deterministic reducer. Snapshots may be added later only as a performance optimization.

### Recovery

If the process closes with work in flight:

1. Events reconstruct the last confirmed state.
2. Tasks without a terminal event become interrupted.
3. Committed usage remains consumed.
4. The commander applies its ordinary retry or reassignment rules.
5. Recovery appends new events rather than rewriting history.

## 18. Duplicate-research policy

Milestone 1A recognizes:

- **Source duplicate:** Same normalized URL or source identifier
- **Fact duplicate:** Same canonical fixture fact ID
- **Research duplicate:** Same candidate, question, geography, and time window
- **Claim duplicate:** Same canonical claim topic with substantially overlapping evidence

Synthetic fixtures include explicit canonical annotations. Live semantic detection is postponed until real research is introduced; the simulation must not pretend to solve semantic duplication through brittle string matching.

## 19. Synthetic fixture datasets

The same engine, commander rules, budget policy, and event schemas must process every fixture without code changes.

### Fixture A: Mixed Opportunity Market

- Several safe categories
- Eight initial candidates
- One unsafe candidate
- One transient worker failure
- Duplicate evidence
- One misleading trend spike
- One attractive candidate with weak economics
- Enough evidence for three to five viable directions
- First report deliberately contains a blocking defect

Expected result: completed report after focused revision and focused re-review.

### Fixture B: Evidence Drought

- Several superficially interesting candidates
- Weak problem evidence
- Contradictory findings
- Poor source diversity
- Fewer than three viable directions

Expected result: `completed_insufficient_evidence` without padding the shortlist.

### Fixture C: Safety Ambiguity

- Two clearly unsafe candidates
- One borderline candidate
- Several safe candidates
- Conflicting safety information

Expected result:

- Two policy-based rejections
- One manual-review or restricted outcome
- Safe candidates continue

## 20. Technical architecture

### Architectural boundaries

```text
CLI / Web UI
    -> Application services
        -> Orchestration engine
            -> Commander policy
            -> Scheduler
            -> Budget ledger
            -> Review workflow
            -> Event reducer
        -> Agent runtime adapters
            -> Simulated adapter
            -> Local Codex adapter (later)
            -> API adapter (optional later)
        -> Persistence adapters
            -> JSONL event store
            -> Read-model projection store (later)
```

The orchestration engine must not import interface or model-provider code.

### Proposed stack

- **Language:** TypeScript
- **Runtime:** A supported Node.js LTS release selected at implementation time; Node’s official guidance recommends production applications use supported LTS lines ([Node releases](https://nodejs.org/en/about/previous-releases)).
- **Milestone 1A tests:** Vitest, which supports asynchronous testing and parallelism ([Vitest guide](https://vitest.dev/guide/)).
- **Milestone 1B interface:** React with TypeScript and Vite ([Vite guide](https://vite.dev/guide/), [React TypeScript guide](https://react.dev/learn/typescript)).
- **End-to-end interface tests:** Playwright after the interface exists ([Playwright documentation](https://playwright.dev/docs/intro)).
- **Authoritative persistence:** Append-only JSONL event files.
- **Read projections:** SQLite may be introduced in Milestone 1B for fast queries; it will never replace the event log as mission history.
- **Real local agents:** Codex SDK adapter explored in Milestone 2 ([Codex SDK documentation](https://learn.chatgpt.com/docs/codex-sdk)).

Library versions will be pinned only when implementation begins. Replaceable web or server libraries are not architectural commitments.

### Proposed repository layout

```text
dropscope/
  apps/
    cli/
    web/
  packages/
    contracts/
    engine/
    policies/
    runtime-simulated/
    runtime-codex/
    event-store-jsonl/
  fixtures/
    mixed-opportunity-market/
    evidence-drought/
    safety-ambiguity/
  tests/
    acceptance/
    recovery/
  docs/
    adr/
    limitations.md
    reviewer-notes.md
  examples/
    mission-replays/
```

## 21. Interface plan

Milestone 1B presents a friendly illustrated research office with professional information design.

### Primary surfaces

#### Mission Lobby

- Create or load a mission
- Choose fixture or mission type
- Configure geography and budget
- Open completed missions

#### Research Office

- Commander’s office
- Specialist desks
- Task dependency board
- Agent states
- Usage meter
- Failures and approval alerts
- Live event feed

#### Agent Desk

- Role and bounded instructions
- Current task
- Evidence and claims
- Confidence and contradictions
- Usage
- Failure and revision history

#### Tribunal Room

- Advocate case
- Prosecutor case
- Commander questions
- Point-by-point challenges
- Unresolved disputes

#### Review Office

- Blind reviewer ranking
- Commander ranking
- Divergence indicators
- Blocking feedback
- Revision response

#### Final Report

- Zero to five investigation priorities
- Customer problem
- Supporting and opposing evidence
- Advertising-saturation signal
- Failure modes
- Safety status
- Confidence
- Missing research
- Reviewer verdict
- Suggested next experiment

#### Mission Replay

- Chronological event history
- Filters for task, agent, budget, review, and failure events
- State reconstruction at any event position

### Interface phasing

- **1B.1:** Mission Lobby, Research Office, replay, and report
- **1B.2:** Agent Desk, Tribunal Room, and Review Office

## 22. Permissions, privacy, and security

### Milestones 1A–1B

- Synthetic data only
- No model credentials
- No network access required
- No external actions
- No personal data

### Later live-research permissions

The default permitted actions will be read-only:

- Search approved public sources
- Open user-supplied public URLs
- Analyze user-uploaded exports
- Use free official APIs when permitted

The following always require explicit approval and are outside the planned autonomous scope:

- Spending money
- Purchasing products
- Publishing
- Contacting people or companies
- Creating accounts
- Logging into third-party services
- Launching advertisements
- Performing financial transactions

Retrieved web content is untrusted input. It cannot alter system instructions, grant tools, or trigger commands. Secrets must remain outside the repository, with `.env.example` documenting only variable names.

## 23. Ground-truth and product limitations

Synthetic fixtures provide known expected outcomes for orchestration tests. They do not validate dropshipping predictions.

Real-world public data is incomplete and noisy. A report can be:

- Internally consistent
- Properly cited
- Independently reviewed
- Explicit about uncertainty

and still be commercially wrong.

DropScope therefore evaluates research process and investigation priority—not business correctness. No output should justify spending money without separate real-world validation.

## 24. Evaluation strategy

### Engine correctness

- Deterministic state reconstruction
- Policy enforcement
- Budget conservation
- Dependency correctness
- Failure and interruption recovery
- Fixture-independent behavior

### Research-process quality

- Claim-to-source alignment
- Source independence
- Contradiction handling
- Reviewer-ranking divergence
- Uncertainty labeling
- Duplicate-work avoidance

### Efficiency experiments

Later milestones compare configurations on identical missions:

- Two versus four specialists
- Sequential versus concurrent work
- One versus two review rounds
- Low versus higher reasoning effort
- Deterministic versus LLM-assisted planning

Measurements:

- Completion outcome
- Rubric scores
- Usage
- Wall-clock time
- Failure rate
- Ranking stability
- Number of blocking defects

## 25. Milestones and gates

### Milestone 0: Review and foundation

Deliverables:

- Approved final plan
- Repository initialized locally
- Initial Architecture Decision Records
- Fixture schema
- Event schema
- Commander policy table

Gate: No application code until reviewer concerns affecting architecture are resolved.

### Milestone 1A: Simulated orchestration engine

Deliverables:

- CLI runner
- Three fixtures
- Genuine async scheduler
- Deterministic commander
- Budget ledger
- Safety policy
- Evidence audit
- Blind review and reconciliation
- JSONL event store
- Reducer and recovery
- Automated acceptance tests

Gate: All Milestone 1A acceptance criteria pass across all fixtures.

### Milestone 1B: Research Office interface

Deliverables:

- Friendly illustrated office
- Live mission visualization
- Agent details
- Tribunal and review views
- Final report
- Event replay
- End-to-end interface tests

Gate: The interface displays derived state only and cannot bypass engine policies.

### Milestone 2: Local Codex workers

Deliverables:

- Runtime adapter interface
- One specialist replaced with a local Codex worker
- Structured-output validation
- Usage observations on the user’s Plus plan
- Gradual replacement of simulated specialists
- LLM commander proposals behind deterministic authorization

Gate: Real workers can fail without corrupting state or bypassing permissions and budgets.

### Milestone 3: Controlled public-web research

Deliverables:

- Public-source tools
- User-supplied URL support
- Source capture and citation provenance
- Prompt-injection defenses
- Live duplicate-detection experiments

Gate: Every decisive live claim is traceable to captured evidence.

### Milestone 4: Full mission modes

Deliverables:

- Learn a Market
- Failure Autopsy
- Product Investigation
- Product and store URL inputs
- Geography-specific validation

Gate: Mission modes share one engine rather than separate scripted workflows.

### Milestone 5: Evaluation and usage optimization

Deliverables:

- Repeatable evaluation missions
- Agent-count experiments
- Cost and latency comparisons
- Quality-versus-usage report
- Recommended default configuration

### Milestone 6: Public repository release

Deliverables:

- Secret and privacy audit
- Installation guide
- Architecture overview
- Synthetic fixtures
- Example mission replays
- Limitations and responsible-use document
- Selected open-source license

## 26. Milestone 1A acceptance criteria

Milestone 1A is complete only when:

1. All three fixtures run through the same engine without code changes.
2. Swapping a dataset changes the outcome without editing orchestration code.
3. Fixture B reaches `completed_insufficient_evidence`.
4. Fixture C produces policy-based safety decisions and reasons.
5. Independent tasks genuinely overlap in execution time.
6. Completion events may arrive out of order without breaking dependencies.
7. Partial failure does not stop unrelated work.
8. In-flight usage is committed and accounted for correctly.
9. A transient failure is retried or reassigned according to the written policy.
10. Exact source, fact, research-key, and annotated claim duplicates are detected.
11. The blind reviewer commits a ranking before seeing the draft.
12. Material rank divergence produces an immutable event.
13. Changed claims are re-audited and the revision is re-reviewed.
14. Optional research cannot spend the quality reserve.
15. Event replay reconstructs the same final state.
16. Interrupted missions recover without rewriting history.
17. Results contain zero to five supported directions rather than a forced five.
18. No fixture-specific candidate name appears in orchestration or policy code.
19. The CLI exposes the final outcome, budget ledger, and complete event history.
20. Re-running a seeded fixture produces the same logical outcome.

## 27. Milestone 1B acceptance criteria

Milestone 1B is complete only when:

- The interface renders state derived from events.
- Reloading preserves and reconstructs the mission.
- Concurrent work is visually distinguishable from sequential work.
- Failed, retried, interrupted, and rejected tasks remain visible.
- Commander and reviewer rankings can be compared.
- Budget reserve and committed usage are visible.
- A user can replay the mission from the first to final event.
- The final report never displays a rejected candidate as eligible.
- End-to-end tests cover mission launch, failure, review, revision, reload, and replay.

## 28. Key risks and mitigations

| Risk | Mitigation |
|---|---|
| The simulation becomes scripted playback | Three fixtures, explicit policies, shared engine, and fixture-independence tests |
| Reviewer simply agrees with the draft | Blind independent ranking followed by reconciliation |
| Concurrency is cosmetic | Genuine async scheduling, seeded latency, overlap tests, and in-flight accounting |
| UI consumes the project before the engine works | Split Milestone 1A and 1B |
| Research appears more accurate than it is | Prominent ground-truth limitation and investigation-priority language |
| Agents waste usage | Research keys, duplicate policy, reserve, agent caps, and stop rules |
| Real agents bypass control | Deterministic authorization around every task, tool, and state transition |
| Event sourcing becomes overengineered | JSONL plus a pure reducer; no distributed infrastructure |
| Learning documentation becomes stale | Short ADRs written only for implemented decisions |
| Public repository exposes credentials | Local-first development, secret audit, `.env.example`, and no committed credentials |

## 29. Architecture Decision Records to create

- ADR-001: Simulation before real agents
- ADR-002: Event log as authoritative state
- ADR-003: Blind review before reconciliation
- ADR-004: Usage commitment at task start
- ADR-005: Deterministic authorization around LLM proposals
- ADR-006: Split engine and interface milestones
- ADR-007: Evidence-driven candidate count
- ADR-008: Safety as a gate rather than a weighted benefit

ADRs are created when implementation begins and updated only through superseding decisions.

## 30. Development process using agents

Development itself will demonstrate the orchestration pattern:

- The primary coding agent acts as implementation commander.
- Bounded subagents may handle engine design, fixture design, tests, interface work, or independent review.
- Parallel work is used only when file ownership and dependencies are clear.
- The implementation commander integrates results and runs the shared acceptance suite.
- A separate review pass examines correctness, scope, and unintended fixture coupling.

The user remains involved at milestone demonstrations and decisions that change scope, cost, permissions, or public behavior.

## 31. Public-release contents

The eventual GitHub repository should demonstrate both the product and the learning process:

- Working local application
- Synthetic fixtures
- Example event logs and reports
- Architecture diagram
- ADRs
- Acceptance tests
- Usage experiment results
- Responsible-use and limitations statement
- Clear installation and demonstration instructions

## 32. Deferred, non-blocking decisions

These decisions do not block Milestone 1A:

- First real-world niche or market
- Exact illustration style and agent portraits
- Public repository license
- Exact local HTTP framework
- Whether SQLite projections are necessary in 1B
- Which public data integrations enter Milestone 3
- Whether an API-backed runtime is ever needed

## 33. Definition of project success

DropScope succeeds as a learning project when:

- The same orchestrator handles materially different missions.
- Failures and disagreement are visible and recoverable.
- Budgets and permissions are enforced outside model judgment.
- Independent review can disagree meaningfully with the commander.
- The user can replay and understand every important decision.
- Real agents can replace simulated workers without redesigning the engine.
- The system communicates uncertainty honestly.
- The public repository teaches other builders how the system works.

Commercial success prediction is deliberately not part of this definition.

## 34. Reviewer questions

The final reviewer is asked to focus on:

1. Does Milestone 1A prove general orchestration rather than fixture-specific scripting?
2. Is the deterministic commander policy sufficiently explicit and testable?
3. Are budget reservation and worst-case arithmetic sound?
4. Is the blind-review design genuinely independent enough?
5. Are interruption, cancellation, and in-flight usage semantics coherent?
6. Is event sourcing appropriately small for this project?
7. Do the fixtures exercise meaningfully different outcomes?
8. Are product-safety and external-action boundaries appropriate?
9. Is Milestone 1A still too broad for a first implementation?
10. Which acceptance criterion is easiest to satisfy superficially without proving the intended behavior?

