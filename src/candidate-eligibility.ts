import { riskGateDecisionSchema, type RiskGateDecision } from "./research-domain.js";

const minimumCustomerProblemEvidenceScore = 65;
const minimumEvidenceQualityScore = 70;

export interface CandidateEligibilityInput {
  candidateId: string;
  riskDecision: RiskGateDecision;
  customerProblemEvidenceScore: number;
  evidenceQualityScore: number;
  hasUnresolvedBlockingContradiction: boolean;
  hasBlockingDecisionCriticalMissingEvidence: boolean;
}

export interface CandidateEligibility {
  candidateId: string;
  eligible: boolean;
  blockers: string[];
}

const validScore = (score: number, name: string) => {
  if (!Number.isInteger(score) || score < 0 || score > 100) throw new Error(`${name} must be an integer from 0 through 100.`);
};

export function determineCandidateEligibility(input: CandidateEligibilityInput): CandidateEligibility {
  const riskDecision = riskGateDecisionSchema.parse(input.riskDecision);
  if (riskDecision.candidateId !== input.candidateId) throw new Error("Risk decision belongs to a different candidate.");
  validScore(input.customerProblemEvidenceScore, "Customer-problem evidence score");
  validScore(input.evidenceQualityScore, "Evidence quality score");

  const blockers: string[] = [];
  if (riskDecision.outcome !== "ALLOWED") blockers.push("RISK_GATE_NOT_ALLOWED");
  if (input.customerProblemEvidenceScore < minimumCustomerProblemEvidenceScore) blockers.push("CUSTOMER_PROBLEM_EVIDENCE_BELOW_THRESHOLD");
  if (input.evidenceQualityScore < minimumEvidenceQualityScore) blockers.push("EVIDENCE_QUALITY_BELOW_THRESHOLD");
  if (input.hasUnresolvedBlockingContradiction) blockers.push("UNRESOLVED_BLOCKING_CONTRADICTION");
  if (input.hasBlockingDecisionCriticalMissingEvidence) blockers.push("DECISION_CRITICAL_MISSING_EVIDENCE");

  return { candidateId: input.candidateId, eligible: blockers.length === 0, blockers };
}
