import type { MissionEvent } from "./contracts.js";
import { evaluateTribunal } from "./tribunal-policy.js";
import type { BlindReviewResult } from "./research-domain.js";
import type { RiskGateDecision } from "./research-domain.js";
import type { CandidateReport } from "./report.js";

export interface FixtureQualityPipelineInput {
  missionId: string;
  startingSequence: number;
  report: CandidateReport;
  riskDecisions: RiskGateDecision[];
}

const timestamp = (sequence: number) => `2026-01-01T00:00:${String(sequence % 60).padStart(2, "0")}.000Z`;

function qualityEvent<T extends MissionEvent["type"]>(
  missionId: string,
  sequenceNumber: number,
  type: T,
  payload: Extract<MissionEvent, { type: T }>["payload"],
): Extract<MissionEvent, { type: T }> {
  return {
    schemaVersion: 1,
    sequenceNumber,
    missionId,
    eventId: `${missionId}-quality-${sequenceNumber}`,
    timestamp: timestamp(sequenceNumber),
    type,
    payload,
  } as Extract<MissionEvent, { type: T }>;
}

function reviewResult(candidateId: string, reviewId: string, verdict: BlindReviewResult["verdict"], score: number, blockingDefects: string[], missingResearchKeys: string[]): BlindReviewResult {
  return {
    reviewId,
    candidateAssessments: [{
      anonymizedCandidateId: candidateId,
      reviewerScore: score,
      reviewerEligible: verdict === "ACCEPT",
      confidenceClass: verdict === "ACCEPT" ? "HIGH" : "MEDIUM",
      dimensionScores: {
        sourceIndependence: score,
        decisionCriticalCoverage: score,
        contradictionHandling: score,
        claimEvidenceAlignment: score,
        uncertaintyCalibration: score,
      },
      blockingDefects,
      missingResearchKeys,
    }],
    ranking: [candidateId],
    verdict,
  };
}

/** The first runtime quality fixture exercises the full revision loop only for the crosscurrent holdout. */
export function buildFixtureQualityPipeline({ missionId, startingSequence, report, riskDecisions }: FixtureQualityPipelineInput): MissionEvent[] {
  const candidate = report.ranking[0];
  if (!candidate) throw new Error("A quality pipeline requires a ranked candidate.");
  const riskDecision = riskDecisions.find((decision) => decision.candidateId === candidate.candidateId);
  if (!riskDecision) throw new Error(`Missing risk decision for ranked candidate ${candidate.candidateId}.`);

  const claimId = `${candidate.candidateId}-workflow-claim`;
  const review = reviewResult(candidate.candidateId, `${candidate.candidateId}-review-1`, "REVISE", 68, ["unresolved_decision_critical_contradiction"], ["crosscurrent-risk"]);
  const rereview = reviewResult(candidate.candidateId, `${candidate.candidateId}-review-2`, "ACCEPT", 92, [], []);
  const tribunalRiskDecision = { decisionId: riskDecision.decisionId, candidateId: riskDecision.candidateId, outcome: riskDecision.outcome, reasons: riskDecision.reasons };
  const tribunal = evaluateTribunal({
    tribunalId: `${candidate.candidateId}-tribunal-1`,
    candidateId: candidate.candidateId,
    policyVersion: "1",
    riskDecision: tribunalRiskDecision,
    claims: [{ claimId, candidateId: candidate.candidateId, decisive: true, tentative: false }],
    evidence: [
      { evidenceId: `${candidate.candidateId}-evidence-a`, candidateId: candidate.candidateId, claimId, independenceGroupId: "group-a", direction: "SUPPORTS", reliabilityClass: "HIGH", strength: 5 },
      { evidenceId: `${candidate.candidateId}-evidence-b`, candidateId: candidate.candidateId, claimId, independenceGroupId: "group-b", direction: "SUPPORTS", reliabilityClass: "HIGH", strength: 4 },
    ],
  });
  const revisionId = `${candidate.candidateId}-revision-1`;
  const events: MissionEvent[] = [
    qualityEvent(missionId, startingSequence + 1, "TribunalCompleted", tribunal),
    qualityEvent(missionId, startingSequence + 2, "AuditCompleted", { auditId: `${candidate.candidateId}-audit-1`, findings: [{ code: "AUDIT_MATERIAL_CONTRADICTION", severity: "HIGH", claimIds: [claimId], evidenceIds: [], sourceIds: [], factIds: [], explanation: "The first review requires a focused contradiction re-audit." }] }),
    qualityEvent(missionId, startingSequence + 3, "BlindReviewCompleted", review),
    qualityEvent(missionId, startingSequence + 4, "RankingDivergenceDetected", { records: [{ divergenceId: `${candidate.candidateId}-divergence-1`, type: "TOP_CANDIDATE_DIVERGENCE", candidateIds: [candidate.candidateId], researchKey: null, blocking: false, status: "UNRESOLVED_ACCEPTED", resolutionNote: "Recorded for deterministic fixture review." }] }),
    qualityEvent(missionId, startingSequence + 5, "RevisionRequested", { revisionId, reviewId: review.reviewId, affectedClaimIds: [claimId], blockingDefectCodes: review.candidateAssessments[0]!.blockingDefects }),
    qualityEvent(missionId, startingSequence + 6, "FocusedReauditCompleted", { revisionId, auditId: `${candidate.candidateId}-audit-2`, changedClaimIds: [claimId], findings: [] }),
    qualityEvent(missionId, startingSequence + 7, "FocusedRereviewCompleted", { revisionId, result: rereview }),
  ];
  return events;
}

/** A fixed autopsy records why a held-out candidate must stop without a revision loop. */
export function buildFailureAutopsyQualityPipeline({ missionId, startingSequence, report, riskDecisions }: FixtureQualityPipelineInput): MissionEvent[] {
  const candidate = report.heldOut[0];
  if (!candidate) throw new Error("A failure autopsy requires one held-out candidate.");
  const riskDecision = riskDecisions.find((decision) => decision.candidateId === candidate.candidateId);
  if (!riskDecision) throw new Error(`Missing risk decision for ${candidate.candidateId}.`);
  const claimId = `${candidate.candidateId}-autopsy-claim`;
  const tribunal = evaluateTribunal({
    tribunalId: `${candidate.candidateId}-autopsy-tribunal-1`, candidateId: candidate.candidateId, policyVersion: "1",
    riskDecision: { decisionId: riskDecision.decisionId, candidateId: riskDecision.candidateId, outcome: riskDecision.outcome, reasons: riskDecision.reasons.map(({ code, evidenceIds }) => ({ code, evidenceIds })) },
    claims: [{ claimId, candidateId: candidate.candidateId, decisive: true, tentative: false }],
    evidence: [
      { evidenceId: `${candidate.candidateId}-autopsy-support`, candidateId: candidate.candidateId, claimId, independenceGroupId: "autopsy-support", direction: "SUPPORTS", reliabilityClass: "LOW", strength: 1 },
      { evidenceId: `${candidate.candidateId}-autopsy-risk`, candidateId: candidate.candidateId, claimId, independenceGroupId: "autopsy-risk", direction: "OPPOSES", reliabilityClass: "HIGH", strength: -5 },
    ],
  });
  const review = reviewResult(candidate.candidateId, `${candidate.candidateId}-autopsy-review-1`, "REJECT", 35, ["risk_gate_rejected", "decision_critical_evidence_missing"], ["autopsy-problem-evidence"]);
  return [
    qualityEvent(missionId, startingSequence + 1, "TribunalCompleted", tribunal),
    qualityEvent(missionId, startingSequence + 2, "AuditCompleted", { auditId: `${candidate.candidateId}-autopsy-audit-1`, findings: [{ code: "AUDIT_DECISIVE_CLAIM_NO_VALID_EVIDENCE", severity: "HIGH", claimIds: [claimId], evidenceIds: [], sourceIds: [], factIds: [], explanation: "The fixed autopsy lacks decision-critical support for the concept." }] }),
    qualityEvent(missionId, startingSequence + 3, "BlindReviewCompleted", review),
  ];
}
