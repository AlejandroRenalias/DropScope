# DropScope Milestone 0 Contracts

**Status:** Architecture Baseline v1  
**Implementation form:** These contracts become Zod schemas in Milestone 1A.1.

## 1. Shared conventions

- IDs are stable non-empty strings.
- Dates are ISO 8601 strings in serialized events.
- Scores are integers from 0 through 100 unless a field says otherwise.
- Enumerations reject unknown values unless schema-version migration explicitly permits them.
- Fixture annotations are allowed only in the simulated runtime and never become live-source inference silently.

## 2. EventEnvelope

```text
EventEnvelope
  schemaVersion: positive integer
  sequenceNumber: non-negative integer
  missionId: string
  eventId: string
  eventType: EventType
  timestamp: ISO 8601 string (informational only)
  correlationId: string
  causationId: string | null
  payload: event-specific validated object
```

Invariants:

- `sequenceNumber` is authoritative ordering.
- Timestamps never influence reduction or policy.
- An event is immutable after durable append.
- Event payload is validated before append.

## 3. MissionCreated payload

```text
MissionCreatedPayload
  missionSeed: string
  missionType: LEARN_MARKET | FAILURE_AUTOPSY | PRODUCT_INVESTIGATION
  objective: string
  targetGeographies: string[]
  totalBudget: positive integer
  policyVersions:
    commander: string
    evidence: string
    reviewer: string
    riskGate: string
    tribunal: string
```

## 4. SourceRecord

```text
SourceRecord
  sourceId: string
  sourceType: fixture-defined enum in 1A
  title: string
  canonicalLocation: string
  publisherOrOrigin: string
  observedAt: ISO 8601 string
  capturedAt: ISO 8601 string
  geography: string | null
  fixtureAnnotation: object | null
```

## 5. ClaimRecord

```text
ClaimRecord
  claimId: string
  candidateId: string
  claimTopic: string
  text: string
  decisive: boolean
  tentative: boolean
  confidenceClass: LOW | MEDIUM | HIGH
  evidenceIds: string[]
  status: PROPOSED | AUDITED | CHALLENGED | ACCEPTED | REJECTED | UNRESOLVED
```

## 6. EvidenceRecord

```text
EvidenceRecord
  evidenceId: string
  sourceId: string
  independenceGroupId: string
  factId: string
  candidateId: string
  claimId: string
  claimTopic: string
  content: string
  sourceType: string
  geography: string | null
  observedAt: ISO 8601 string
  capturedAt: ISO 8601 string
  reliabilityClass: HIGH | MEDIUM | LOW | UNKNOWN
  direction: SUPPORTS | OPPOSES | NEUTRAL
  strength: integer from -5 through 5
  fixtureAnnotation: object | null
```

Invariants:

- `SUPPORTS` requires positive strength.
- `OPPOSES` requires negative strength.
- `NEUTRAL` requires zero strength.
- `claimId` resolves to a `ClaimRecord` with the same candidate and topic.
- `sourceId` resolves to a `SourceRecord`.
- Reliability is declared by fixtures in 1A.
- Independence counting uses distinct `independenceGroupId` values, not raw source count.

## 7. Finding

```text
Finding
  findingId: string
  missionId: string
  taskId: string
  attemptId: string
  candidateId: string
  claimIds: string[]
  evidenceIds: string[]
  contradictionIds: string[]
  assumptions: string[]
  unansweredQuestions: string[]
  suggestedNextAction: string | null
```

Findings reference canonical evidence. They never embed substitute evidence prose as authoritative data.

## 8. OpenGap

```text
OpenGap
  gapId: string
  missionId: string
  researchKey: string
  description: string
  affectedCandidateIds: string[]
  affectedDecisionTypes:
    ELIGIBILITY | RANKING | CONFIDENCE | SAFETY_OR_RISK |
    BLOCKING_REVIEW | CONTRADICTION
  severity: LOW | MEDIUM | HIGH | BLOCKING
  openedBy:
    BASELINE_PLAN | EVIDENCE_AUDITOR | BLIND_REVIEWER |
    DIVERGENCE_DETECTOR | FAILURE_HANDLER | CONTRADICTION_DETECTOR
  openedByReferenceId: string
  status: OPEN | REOPENED | RESOLVING | RESOLVED | EXHAUSTED | DECLINED
  resolutionTaskIds: string[]
  resolutionNote: string | null
```

Task admission requires either baseline-plan membership or a research key matching an actionable gap.

## 9. TaskRecord

```text
TaskRecord
  taskId: string
  missionId: string
  researchKey: string
  objective: string
  baselineRequired: boolean
  gapId: string | null
  dependencyTaskIds: string[]
  compatibleWorkerRoles: string[]
  assignedWorkerRole: string | null
  costPerAttempt: non-negative integer
  state: TaskState
  attemptIds: string[]
```

## 10. TaskAttemptRecord

```text
TaskAttemptRecord
  attemptId: string
  taskId: string
  attemptNumber: positive integer
  assignedWorkerRole: string
  idempotencyKey: string
  derivedRandomSeed: string
  persistedRandomInputs: object
  state: AttemptState
  budgetState: RESERVED | COMMITTED | SPENT
  startedAt: ISO 8601 string | null
  finishedAt: ISO 8601 string | null
  failureClass: TRANSIENT | PERMANENT | INTERRUPTION | null
```

Attempt ID format example: `echo-problem-validation-04:a2`.

## 10.1 WorkerExecutionRecorded payload

```text
WorkerExecutionRecordedPayload
  attemptId: string
  mode: RECORDED_DRY_RUN
  providerUsageStatus: NOT_APPLICABLE
```

The event is accepted only once for a running attempt immediately before the recorded local adapter is invoked. It records execution provenance, not provider billing. Histories without the event remain replayable with provenance not recorded.

## 11. BudgetLedger

```text
BudgetLedger
  total: integer
  available: integer
  reserved: integer
  committed: integer
  spent: integer
  remainingMandatoryUnreservedCost: integer
```

Invariants:

```text
available = total - reserved - committed - spent
all values >= 0
spent + committed + reserved + remainingMandatoryUnreservedCost <= total
```

## 12. RiskGateDecision

```text
RiskGateDecision
  decisionId: string
  candidateId: string
  outcome: ALLOWED | RESTRICTED | MANUAL_REVIEW | REJECTED
  reasons:
    - category: SAFETY | REGULATORY | INTELLECTUAL_PROPERTY |
                POLICY | INSUFFICIENT_INFORMATION
      code: string
      explanation: string
      evidenceIds: string[]
  decidedByPolicyVersion: string
```

## 13. BlindReviewResult

```text
BlindReviewResult
  reviewId: string
  candidateAssessments:
    - anonymizedCandidateId: string
      reviewerScore: integer 0..100
      reviewerEligible: boolean
      confidenceClass: LOW | MEDIUM | HIGH
      dimensionScores: object
      blockingDefects: string[]
      missingResearchKeys: string[]
  ranking: string[]
  verdict: ACCEPT | REVISE | REASSIGN | REJECT
```

The blind result is persisted before commander output is supplied for reconciliation.

## 14. TribunalCompleted payload

```text
TribunalCompletedPayload
  tribunalId: string
  candidateId: string
  recommendation: CONTINUE_RESEARCH | CAUTION | STOP
  ventureClaimIds: string[]
  ruinClaimIds: string[]
  reasons:
    - code: string
      explanation: string
      claimIds: string[]
      evidenceIds: string[]
      riskDecisionId: string | null
      riskReasonCodes: string[]
  decidedByPolicyVersion: string
```

The payload is a recorded deterministic tribunal result only. Its policy version must equal `MissionCreated.policyVersions.tribunal`; it creates no authorization, state transition, eligibility, ranking, gap, revision, or report action. Legacy schema-version-1 `MissionCreated` histories without `policyVersions` remain replayable but cannot record tribunal output.

## 15. DivergenceRecord

```text
DivergenceRecord
  divergenceId: string
  type:
    ELIGIBILITY_DIVERGENCE | TOP_CANDIDATE_DIVERGENCE |
    RANK_POSITION_DIVERGENCE | CONFIDENCE_DIVERGENCE |
    MISSING_EVIDENCE_DIVERGENCE
  candidateIds: string[]
  researchKey: string | null
  blocking: boolean
  status: OPEN | RESOLVED | UNRESOLVED_ACCEPTED
  resolutionNote: string | null
```

`AuditCompleted` records `{ auditId, findings }`; `BlindReviewCompleted` records the strict `BlindReviewResult`; and the two divergence events record strict `DivergenceRecord[]`. These results are replayed as evidence of completed quality stages only and create no authorization, ranking, eligibility, gap, revision, or report action.

## 16. FixtureManifest

```text
FixtureManifest
  fixtureSchemaVersion: positive integer
  fixtureId: string
  description: string
  missionInput: MissionCreatedPayload minus generated IDs
  candidates: CandidateFixture[]
  sources: SourceRecord[]
  claims: ClaimRecord[]
  evidence: EvidenceRecord[]
  workerBehaviors: WorkerBehaviorFixture[]
  latencyProfiles: LatencyProfileFixture[]
  riskAttributes: RiskAttributeFixture[]
```

Fixtures do not contain expected orchestration commands. Test expectations live in test code and may assert terminal states, candidate sets, reason codes, or divergence types. No fixture ID or expected result enters engine logic.

## 17. Required event types for 1A

```text
MissionCreated
PlanCreated
GapOpened
GapStatusChanged
BudgetReserved
BudgetCommitted
UsageSpent
TaskCreated
TaskWaitingDependencies
TaskAuthorized
TaskStarted
WorkerExecutionRecorded
TaskCompleted
TaskFailedTransient
TaskFailedPermanent
TaskInterrupted
TaskCancelled
TaskRejectedPolicy
TransitionRejected
FindingSubmitted
StaleCompletionIgnored
ClaimChallenged
RiskGateDecided
TribunalCompleted
AuditCompleted
BlindReviewCompleted
RankingDivergenceDetected
MissingEvidenceDivergenceDetected
RevisionRequested
FocusedReauditCompleted
FocusedRereviewCompleted
ReportPublished
RecoveryStarted
MissionTerminated
```

## 18. Runtime-validation rule

Every command, event, fixture, worker result, finding, evidence record, and review result is validated by Zod at the boundary. Invalid worker output produces a structured validation failure. It does not become an authoritative finding.
