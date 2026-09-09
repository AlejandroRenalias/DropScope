import type { MissionEvent } from "../contracts.js";
import { replay, type MissionStatus, type TaskStatus } from "../reducer.js";
import { evaluateTribunal, type TribunalResult } from "../tribunal-policy.js";
import type { BlindReviewResult } from "../research-domain.js";
import { loadFixture, type FixtureCandidateEvaluation } from "../fixture-model.js";
import { evaluateRiskGate } from "../risk-policy.js";
import { determineCandidateEligibility } from "../candidate-eligibility.js";
import { buildCandidateReport, type CandidateReport } from "../report.js";

export type OfficeScenario = "RUNNING" | "BLOCKED" | "COMPLETED";
export type AgentState = "WORKING" | "WAITING" | "BLOCKED" | "COMPLETED";
export interface AgentDeskRecord { id: string; role: string; state: AgentState; task: string; detail: string; evidence: string; usage: { units: number; status: string }; }
export interface DecisionViews { agentDesk: AgentDeskRecord[]; tribunalRoom: { result: TribunalResult; recordedAtSequence: number } | null; reviewOffice: { result: BlindReviewResult; recordedAtSequence: number; blockingFeedback: string[]; divergences: string[]; revisionResponse: string | null } | null; }
export interface OfficeProjection { sourceLabel: string; mission: { name: string; phase: string; status: OfficeScenario }; ledger: { total: number; reserved: number; committed: number; spent: number; available: number }; agents: AgentDeskRecord[]; tasks: Array<{ label: string; state: AgentState; dependencies: string }>; events: Array<{ sequence: number; type: string; detail: string }>; decisionViews: DecisionViews; }
export type ReplayEventCategory = "task" | "agent" | "budget" | "review" | "failure";
export interface ReplayEventRecord { sequence: number; type: string; category: ReplayEventCategory; detail: string; }
export interface FinalReportProjection { sourceLabel: string; fixtureId: string; outcome: CandidateReport["outcome"]; priorities: Array<FixtureCandidateEvaluation & { researchPriorityScore: number }>; heldOut: CandidateReport["heldOut"]; reviewerVerdict: string; customerProblemEvidence: number; evidenceQuality: number; advertisingSaturation: number; operationalRisk: number; failureRisk: number; safetyGate: string; evidenceSummary: { supporting: string[]; opposing: string[] }; nextStep: string; }
const missionId = "crosscurrent-workspace-market";
const sourceLabel = "Static demo history replayed through the existing MissionState reducer. It is not live engine data.";
const timestamp = (n: number) => `2026-01-01T00:00:${String(n).padStart(2, "0")}.000Z`;
function event<T extends MissionEvent["type"]>(n: number, type: T, payload: Extract<MissionEvent, { type: T }>["payload"]): Extract<MissionEvent, { type: T }> { return { schemaVersion: 1, sequenceNumber: n, missionId, eventId: `office-${n}`, timestamp: timestamp(n), type, payload } as Extract<MissionEvent, { type: T }>; }
const authorize = (n: number, taskId: string, objective: string, cost: number, researchKey: string, dependencies: string[] = []) => event(n, "TaskAuthorized", { taskId, objective, cost, workClass: "MANDATORY", researchKey, authorizationReason: "MANDATORY_BASELINE", dependencies });
const schedule = (n: number, taskId: string, attemptId: string, objective: string, cost: number, researchKey: string, workerRole: string, dependencies: string[] = []) => event(n, "TaskScheduled", { taskId, attemptId, objective, cost, workClass: "MANDATORY", researchKey, workerRole, dependencies });
const reserve = (n: number, attemptId: string, cost: number) => event(n, "BudgetReserved", { attemptId, cost });
const start = (n: number, attemptId: string) => event(n, "TaskStarted", { attemptId, simulatedDelayMs: 1 });
const finding = (n: number, attemptId: string, text: string) => event(n, "FindingSubmitted", { attemptId, finding: text });
const created = event(1, "MissionCreated", { totalBudget: 140, missionSeed: 7, policyVersions: { tribunal: "tribunal-policy-v1" } });
const workspace = { id: "workspace-scan", objective: "Map cross-current workspace demand.", cost: 25, key: "workspace-market", role: "MARKET_RESEARCHER" };
const workflow = { id: "workflow-interviews", objective: "Compare recurring workflow problems.", cost: 30, key: "workflow-evidence", role: "EVIDENCE_RESEARCHER" };
const supplier = { id: "supplier-check", objective: "Check operational feasibility.", cost: 20, key: "supplier-feasibility", role: "OPERATIONS_RESEARCHER" };
const risk = { id: "crosscurrent-risk-review", objective: "Review conflicting risk signals.", cost: 25, key: "crosscurrent-risk", role: "RISK_RESEARCHER" };
export const officeHistories: Record<OfficeScenario, MissionEvent[]> = {
  RUNNING: [created, authorize(2, workspace.id, workspace.objective, workspace.cost, workspace.key), schedule(3, workspace.id, "workspace:a1", workspace.objective, workspace.cost, workspace.key, workspace.role), reserve(4, "workspace:a1", workspace.cost), start(5, "workspace:a1"), finding(6, "workspace:a1", "Workspace demand mapped."), authorize(7, workflow.id, workflow.objective, workflow.cost, workflow.key, [workspace.id]), authorize(8, supplier.id, supplier.objective, supplier.cost, supplier.key, [workspace.id]), schedule(9, workflow.id, "workflow:a1", workflow.objective, workflow.cost, workflow.key, workflow.role, [workspace.id]), reserve(10, "workflow:a1", workflow.cost), start(11, "workflow:a1"), schedule(12, supplier.id, "supplier:a1", supplier.objective, supplier.cost, supplier.key, supplier.role, [workspace.id]), reserve(13, "supplier:a1", supplier.cost), start(14, "supplier:a1")],
  BLOCKED: [created, authorize(2, workspace.id, workspace.objective, workspace.cost, workspace.key), schedule(3, workspace.id, "workspace:b1", workspace.objective, workspace.cost, workspace.key, workspace.role), reserve(4, "workspace:b1", workspace.cost), start(5, "workspace:b1"), finding(6, "workspace:b1", "Workspace demand mapped."), authorize(7, workflow.id, workflow.objective, workflow.cost, workflow.key, [workspace.id]), authorize(8, supplier.id, supplier.objective, supplier.cost, supplier.key, [workspace.id]), schedule(9, workflow.id, "workflow:b1", workflow.objective, workflow.cost, workflow.key, workflow.role, [workspace.id]), reserve(10, "workflow:b1", workflow.cost), start(11, "workflow:b1"), finding(12, "workflow:b1", "Workflow evidence submitted."), schedule(13, supplier.id, "supplier:b1", supplier.objective, supplier.cost, supplier.key, supplier.role, [workspace.id]), reserve(14, "supplier:b1", supplier.cost), start(15, "supplier:b1"), finding(16, "supplier:b1", "Supplier feasibility checked."), authorize(17, risk.id, risk.objective, risk.cost, risk.key, [workflow.id, supplier.id]), schedule(18, risk.id, "risk:b1", risk.objective, risk.cost, risk.key, risk.role, [workflow.id, supplier.id]), reserve(19, "risk:b1", risk.cost), start(20, "risk:b1"), event(21, "TaskInterrupted", { attemptId: "risk:b1", reason: "Safety evidence requires policy review." }), event(22, "GapOpened", { gapId: "safety-gap", researchKey: risk.key, affectedDecisionType: "SAFETY_OR_RISK", reason: "Safety evidence remains unresolved." }), event(23, "MissionTerminated", { status: "BLOCKED_POLICY", reason: "Safety evidence requires policy review." })],
  COMPLETED: [created, authorize(2, workspace.id, workspace.objective, workspace.cost, workspace.key), schedule(3, workspace.id, "workspace:c1", workspace.objective, workspace.cost, workspace.key, workspace.role), reserve(4, "workspace:c1", workspace.cost), start(5, "workspace:c1"), finding(6, "workspace:c1", "Workspace demand mapped."), authorize(7, workflow.id, workflow.objective, workflow.cost, workflow.key, [workspace.id]), authorize(8, supplier.id, supplier.objective, supplier.cost, supplier.key, [workspace.id]), schedule(9, workflow.id, "workflow:c1", workflow.objective, workflow.cost, workflow.key, workflow.role, [workspace.id]), reserve(10, "workflow:c1", workflow.cost), start(11, "workflow:c1"), finding(12, "workflow:c1", "Workflow evidence submitted."), schedule(13, supplier.id, "supplier:c1", supplier.objective, supplier.cost, supplier.key, supplier.role, [workspace.id]), reserve(14, "supplier:c1", supplier.cost), start(15, "supplier:c1"), finding(16, "supplier:c1", "Supplier feasibility checked."), authorize(17, risk.id, risk.objective, risk.cost, risk.key, [workflow.id, supplier.id]), schedule(18, risk.id, "risk:c1", risk.objective, risk.cost, risk.key, risk.role, [workflow.id, supplier.id]), reserve(19, "risk:c1", risk.cost), start(20, "risk:c1"), finding(21, "risk:c1", "Risk review completed."), event(22, "MissionCompleted", {})],
};
const tribunalResult = evaluateTribunal({
  tribunalId: "office-tribunal-1", candidateId: "crosscurrent-workspace-market", policyVersion: "tribunal-policy-v1",
  riskDecision: { decisionId: "risk-1", candidateId: "crosscurrent-workspace-market", outcome: "ALLOWED", reasons: [] },
  claims: [{ claimId: "venture-claim", candidateId: "crosscurrent-workspace-market", decisive: true, tentative: false }],
  evidence: [
    { evidenceId: "venture-evidence-a", candidateId: "crosscurrent-workspace-market", claimId: "venture-claim", independenceGroupId: "group-a", direction: "SUPPORTS", reliabilityClass: "HIGH", strength: 5 },
    { evidenceId: "venture-evidence-b", candidateId: "crosscurrent-workspace-market", claimId: "venture-claim", independenceGroupId: "group-b", direction: "SUPPORTS", reliabilityClass: "HIGH", strength: 4 },
  ],
});
const reviewResult: BlindReviewResult = { reviewId: "office-review-1", candidateAssessments: [{ anonymizedCandidateId: "crosscurrent-workspace-market", reviewerScore: 68, reviewerEligible: false, confidenceClass: "MEDIUM", dimensionScores: { sourceIndependence: 70, decisionCriticalCoverage: 60, contradictionHandling: 65, claimEvidenceAlignment: 70, uncertaintyCalibration: 75 }, blockingDefects: ["unresolved_decision_critical_contradiction"], missingResearchKeys: ["crosscurrent-risk"] }], ranking: ["crosscurrent-workspace-market"], verdict: "REVISE" };
const rereviewResult: BlindReviewResult = { ...reviewResult, reviewId: "office-review-2", candidateAssessments: [{ ...reviewResult.candidateAssessments[0]!, reviewerScore: 92, reviewerEligible: true, confidenceClass: "HIGH", dimensionScores: { sourceIndependence: 95, decisionCriticalCoverage: 90, contradictionHandling: 90, claimEvidenceAlignment: 92, uncertaintyCalibration: 95 }, blockingDefects: [], missingResearchKeys: [] }], verdict: "ACCEPT" };
function withDecisionHistory(history: MissionEvent[], scenario: OfficeScenario): MissionEvent[] {
  const additions: MissionEvent[] = [
    event(2, "TribunalCompleted", tribunalResult),
    event(3, "BlindReviewCompleted", reviewResult),
  ];
  if (scenario !== "RUNNING") {
    additions.push(event(4, "RankingDivergenceDetected", { records: [{ divergenceId: "office-divergence-1", type: "TOP_CANDIDATE_DIVERGENCE", candidateIds: ["crosscurrent-workspace-market"], researchKey: null, blocking: false, status: "UNRESOLVED_ACCEPTED", resolutionNote: "Recorded for the static replay." }] }));
    additions.push(event(5, "RevisionRequested", { revisionId: "office-revision-1", reviewId: reviewResult.reviewId, affectedClaimIds: ["venture-claim"], blockingDefectCodes: reviewResult.candidateAssessments[0]!.blockingDefects }));
    additions.push(event(6, "FocusedReauditCompleted", { revisionId: "office-revision-1", auditId: "office-audit-1", changedClaimIds: ["venture-claim"], findings: [] }));
    additions.push(event(7, "FocusedRereviewCompleted", { revisionId: "office-revision-1", result: rereviewResult }));
  }
  const combined = [history[0]!, ...additions, ...history.slice(1)];
  return combined.map((item, index) => ({ ...item, sequenceNumber: index + 1, eventId: `office-${scenario.toLowerCase()}-${index + 1}` }));
}
for (const scenario of Object.keys(officeHistories) as OfficeScenario[]) officeHistories[scenario] = withDecisionHistory(officeHistories[scenario], scenario);
function taskState(status: TaskStatus): AgentState { if (status === "RUNNING") return "WORKING"; if (status === "COMPLETED") return "COMPLETED"; if (status === "INTERRUPTED" || status === "FAILED_PERMANENT" || status === "FAILED_TRANSIENT") return "BLOCKED"; return "WAITING"; }
function roleLabel(role: string): string { return role.toLowerCase().split("_").map((word) => word[0]!.toUpperCase() + word.slice(1)).join(" "); }
function workstationId(role: string): string { return role === "MARKET_RESEARCHER" ? "commander" : role === "EVIDENCE_RESEARCHER" ? "evidence" : role === "OPERATIONS_RESEARCHER" ? "operations" : role === "RISK_RESEARCHER" ? "risk" : "evidence"; }
function eventDetail(item: MissionEvent): string { const payload = item.payload as Record<string, unknown>; const detail = payload.reason ?? payload.finding ?? payload.objective ?? payload.status; return typeof detail === "string" ? detail : `${item.type} recorded in replay.`; }
function eventCategory(type: MissionEvent["type"]): ReplayEventCategory {
  if (type.includes("Budget")) return "budget";
  if (type.includes("Review") || type.includes("Tribunal") || type.includes("Divergence") || type.includes("Revision") || type.includes("Reaudit")) return "review";
  if (type.includes("Fail") || type.includes("Interrupt") || type.includes("Gap") || type.includes("Terminat")) return "failure";
  if (type === "TaskStarted" || type === "FindingSubmitted") return "agent";
  return "task";
}
function missionName(id: string | null): string { return (id ?? "unknown-mission").split("-").map((word) => word[0]!.toUpperCase() + word.slice(1)).join(" "); }
function officeStatus(status: MissionStatus): OfficeScenario { return status === "COMPLETED" || status === "COMPLETED_INSUFFICIENT_EVIDENCE" ? "COMPLETED" : status === "RUNNING" || status === "NOT_STARTED" ? "RUNNING" : "BLOCKED"; }
function phaseLabel(status: MissionStatus): string { return status === "COMPLETED" ? "Report ready" : status === "COMPLETED_INSUFFICIENT_EVIDENCE" ? "Insufficient evidence" : status === "BLOCKED_POLICY" ? "Policy block" : status === "FAILED_UNRECOVERABLE" ? "Mission stopped" : "Research in progress"; }
export function projectOffice(events: MissionEvent[]): OfficeProjection {
  const state = replay(events); const status = officeStatus(state.status);
  const tasks = Object.entries(state.authorizations).map(([taskId, authorization]) => {
    const task = state.tasks[taskId];
    return { label: task?.objective ?? authorization.objective, state: task ? taskState(task.status) : "WAITING", dependencies: authorization.dependencies.length ? `After ${authorization.dependencies.join(", ")}` : "Starting task" };
  });
  const agents = Object.values(state.attempts).map((attempt) => ({ id: workstationId(attempt.workerRole), role: roleLabel(attempt.workerRole), state: taskState(attempt.status), task: state.tasks[attempt.taskId]?.objective ?? attempt.taskId, detail: attempt.finding ?? "Assigned through replay.", evidence: attempt.finding ?? (attempt.status === "INTERRUPTED" ? "Failure or revision context recorded in replay." : "No finding recorded yet."), usage: { units: state.tasks[attempt.taskId]?.cost ?? 0, status: attempt.status } }));
  const tribunalEvent = events.find((item): item is Extract<MissionEvent, { type: "TribunalCompleted" }> => item.type === "TribunalCompleted");
  const reviewEvent = events.find((item): item is Extract<MissionEvent, { type: "BlindReviewCompleted" }> => item.type === "BlindReviewCompleted");
  const blockingFeedback = reviewEvent?.payload.candidateAssessments.flatMap((assessment) => assessment.blockingDefects) ?? [];
  const divergences = Object.values(state.divergenceRecords).map((record) => `${record.type}: ${record.candidateIds.join(", ")}`);
  const revisionResponse = state.revision?.rereview ? `Focused re-review returned ${state.revision.rereview.verdict.toLowerCase()} for the revision.` : state.revision ? "Revision requested; response is still pending." : null;
  const decisionViews: DecisionViews = { agentDesk: agents, tribunalRoom: tribunalEvent ? { result: state.tribunalResults[tribunalEvent.payload.tribunalId]!, recordedAtSequence: tribunalEvent.sequenceNumber } : null, reviewOffice: reviewEvent ? { result: state.blindReviewResults[reviewEvent.payload.reviewId]!, recordedAtSequence: reviewEvent.sequenceNumber, blockingFeedback, divergences, revisionResponse } : null };
  return { sourceLabel, mission: { name: missionName(state.missionId), phase: phaseLabel(state.status), status }, ledger: { ...state.budget }, agents, tasks, events: events.slice(-3).map((item) => ({ sequence: item.sequenceNumber, type: item.type, detail: eventDetail(item) })), decisionViews };
}

export function replayEvents(events: MissionEvent[]): ReplayEventRecord[] {
  return events.map((item) => ({ sequence: item.sequenceNumber, type: item.type, category: eventCategory(item.type), detail: eventDetail(item) }));
}

export function projectFinalReport(): FinalReportProjection {
  const fixture = loadFixture("crosscurrent-workspace-market");
  const riskDecisions = fixture.candidateEvaluations.map((candidate) => evaluateRiskGate(candidate.riskInput));
  const eligibilities = fixture.candidateEvaluations.map((candidate, index) => determineCandidateEligibility({ ...candidate, riskDecision: riskDecisions[index]! }));
  const report = buildCandidateReport(fixture.candidateEvaluations, riskDecisions, eligibilities);
  const heldOutIds = new Set(report.heldOut.map((candidate) => candidate.candidateId));
  const priorities = report.ranking.map((ranked) => ({ ...fixture.candidateEvaluations.find((candidate) => candidate.candidateId === ranked.candidateId)!, researchPriorityScore: ranked.researchPriorityScore }));
  const representative = priorities[0] ?? fixture.candidateEvaluations[0]!;
  const review = projectOffice(officeHistories.COMPLETED).decisionViews.reviewOffice;
  const heldOut = report.heldOut.filter((candidate) => heldOutIds.has(candidate.candidateId));
  const nextStep = report.outcome === "INSUFFICIENT_EVIDENCE"
    ? "Insufficient evidence: resolve held-out blockers before selecting a candidate."
    : priorities.length > 0
      ? `Next step: deepen validation for ${priorities[0]!.candidateId} before committing spend.`
      : "Insufficient evidence: no candidate cleared the recorded gates.";
  const representativeDecision = riskDecisions.find((decision) => decision.candidateId === representative.candidateId);
  return {
    sourceLabel: "Static fixture crosscurrent-workspace-market evaluated by browser-safe pure helpers. This is not live market data.",
    fixtureId: fixture.fixtureId,
    outcome: report.outcome,
    priorities,
    heldOut,
    reviewerVerdict: review?.result.verdict ?? "NO_RECORDED_REVIEW",
    customerProblemEvidence: representative.customerProblemEvidenceScore,
    evidenceQuality: representative.evidenceQualityScore,
    advertisingSaturation: representative.advertisingSaturationScore,
    operationalRisk: representative.operationalRiskScore,
    failureRisk: representative.failureRiskScore,
    safetyGate: representativeDecision?.outcome ?? "NO_RECORDED_GATE",
    evidenceSummary: {
      supporting: [
        `Customer-problem evidence ${representative.customerProblemEvidenceScore}/100`,
        `Evidence quality ${representative.evidenceQualityScore}/100`,
        `Trend durability ${representative.trendDurabilityScore}/100`,
      ],
      opposing: [
        `Advertising saturation ${representative.advertisingSaturationScore}/100`,
        `Operational risk ${representative.operationalRiskScore}/100`,
        `Failure risk ${representative.failureRiskScore}/100`,
      ],
    },
    nextStep,
  };
}
