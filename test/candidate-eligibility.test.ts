import { describe, expect, it } from "vitest";

import { determineCandidateEligibility } from "../src/candidate-eligibility.js";
import type { RiskGateDecision } from "../src/research-domain.js";

const decision = (outcome: RiskGateDecision["outcome"]): RiskGateDecision => ({
  decisionId: `decision-${outcome}`, candidateId: "candidate", outcome, reasons: [], decidedByPolicyVersion: "risk-v1",
});

describe("candidate eligibility", () => {
  it("permits only an allowed candidate that clears every evidence gate", () => {
    expect(determineCandidateEligibility({ candidateId: "candidate", riskDecision: decision("ALLOWED"), customerProblemEvidenceScore: 65, evidenceQualityScore: 70, hasUnresolvedBlockingContradiction: false, hasBlockingDecisionCriticalMissingEvidence: false })).toEqual({ candidateId: "candidate", eligible: true, blockers: [] });
  });

  it.each(["RESTRICTED", "MANUAL_REVIEW", "REJECTED"] as const)("holds %s out of the eligible ranking", (outcome) => {
    expect(determineCandidateEligibility({ candidateId: "candidate", riskDecision: decision(outcome), customerProblemEvidenceScore: 100, evidenceQualityScore: 100, hasUnresolvedBlockingContradiction: false, hasBlockingDecisionCriticalMissingEvidence: false })).toMatchObject({ eligible: false, blockers: ["RISK_GATE_NOT_ALLOWED"] });
  });

  it("reports every evidence and publication blocker without weakening thresholds", () => {
    expect(determineCandidateEligibility({ candidateId: "candidate", riskDecision: decision("ALLOWED"), customerProblemEvidenceScore: 64, evidenceQualityScore: 69, hasUnresolvedBlockingContradiction: true, hasBlockingDecisionCriticalMissingEvidence: true }).blockers).toEqual([
      "CUSTOMER_PROBLEM_EVIDENCE_BELOW_THRESHOLD",
      "EVIDENCE_QUALITY_BELOW_THRESHOLD",
      "UNRESOLVED_BLOCKING_CONTRADICTION",
      "DECISION_CRITICAL_MISSING_EVIDENCE",
    ]);
  });

  it("rejects malformed decisions, foreign decisions, and invalid scores", () => {
    expect(() => determineCandidateEligibility({ candidateId: "other", riskDecision: decision("ALLOWED"), customerProblemEvidenceScore: 65, evidenceQualityScore: 70, hasUnresolvedBlockingContradiction: false, hasBlockingDecisionCriticalMissingEvidence: false })).toThrow("different candidate");
    expect(() => determineCandidateEligibility({ candidateId: "candidate", riskDecision: decision("ALLOWED"), customerProblemEvidenceScore: 65.5, evidenceQualityScore: 70, hasUnresolvedBlockingContradiction: false, hasBlockingDecisionCriticalMissingEvidence: false })).toThrow("integer from 0 through 100");
  });

  it("does not block an otherwise eligible candidate for non-blocking missing evidence", () => {
    expect(determineCandidateEligibility({ candidateId: "candidate", riskDecision: decision("ALLOWED"), customerProblemEvidenceScore: 65, evidenceQualityScore: 70, hasUnresolvedBlockingContradiction: false, hasBlockingDecisionCriticalMissingEvidence: false }).eligible).toBe(true);
  });
});
