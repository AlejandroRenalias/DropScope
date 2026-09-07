import { describe, expect, it } from "vitest";
import { buildCandidateReport } from "../src/report.js";
import type { FixtureCandidateEvaluation } from "../src/fixture-model.js";
import type { CandidateEligibility } from "../src/candidate-eligibility.js";
import type { RiskGateDecision } from "../src/research-domain.js";

const evaluation = (candidateId: string, overrides: Partial<FixtureCandidateEvaluation> = {}): FixtureCandidateEvaluation => ({
  candidateId,
  riskInput: {
    decisionId: `${candidateId}-decision`, candidateId, decidedByPolicyVersion: "risk-v1",
    attributes: { intendedUser: "GENERAL", foodOrIngestion: "NO", bodyContact: "NONE", healthPositioning: "NONE", electricalPower: "NONE", thermalOrFireHazard: "NONE", physicalHazard: "NONE", protectiveFunction: "NONE", chemicalExposure: "NONE_DECLARED", regulatedCategorySignal: "NONE", brandOrCreativeSimilaritySignal: "NONE_OBSERVED", evidenceCompleteness: "SUFFICIENT" },
    attributeEvidenceIds: { intendedUser: [], foodOrIngestion: [], bodyContact: [], healthPositioning: [], electricalPower: [], thermalOrFireHazard: [], physicalHazard: [], protectiveFunction: [], chemicalExposure: [], regulatedCategorySignal: [], brandOrCreativeSimilaritySignal: [], evidenceCompleteness: [] },
  }, customerProblemEvidenceScore: 90, evidenceQualityScore: 90, trendDurabilityScore: 80, advertisingSaturationScore: 20, operationalRiskScore: 20, failureRiskScore: 20, hasUnresolvedBlockingContradiction: false, hasBlockingDecisionCriticalMissingEvidence: false, ...overrides,
});
const decision = (candidateId: string, outcome: RiskGateDecision["outcome"], code?: string): RiskGateDecision => ({ decisionId: `${candidateId}-decision`, candidateId, outcome, reasons: code ? [{ category: "SAFETY", code, explanation: "held out", evidenceIds: [] }] : [], decidedByPolicyVersion: "risk-v1" });
const eligibility = (candidateId: string, eligible: boolean, blockers: string[] = []): CandidateEligibility => ({ candidateId, eligible, blockers });

describe("candidate reports", () => {
  it("caps the main ranking at five and holds out the rest", () => {
    const evaluations = Array.from({ length: 6 }, (_, index) => evaluation(`candidate-${index}`));
    const decisions = evaluations.map(({ candidateId }) => decision(candidateId, "ALLOWED"));
    const eligibilities = evaluations.map(({ candidateId }) => eligibility(candidateId, true));
    const report = buildCandidateReport(evaluations, decisions, eligibilities);
    expect(report.outcome).toBe("RANKED");
    expect(report.ranking).toHaveLength(5);
    expect(report.heldOut).toEqual([expect.objectContaining({ candidateId: "candidate-5", outcome: "ALLOWED", reasonCodes: ["RANKING_CAP_EXCEEDED"] })]);
  });

  it("keeps every non-allowed gate outcome out of the main ranking", () => {
    const evaluations = [evaluation("allowed"), evaluation("restricted"), evaluation("manual"), evaluation("rejected")];
    const decisions = [decision("allowed", "ALLOWED"), decision("restricted", "RESTRICTED", "RESTRICTED_CODE"), decision("manual", "MANUAL_REVIEW", "MANUAL_CODE"), decision("rejected", "REJECTED", "REJECTED_CODE")];
    const eligibilities = [eligibility("allowed", true), eligibility("restricted", false, ["RISK_GATE_NOT_ALLOWED"]), eligibility("manual", false, ["RISK_GATE_NOT_ALLOWED"]), eligibility("rejected", false, ["RISK_GATE_NOT_ALLOWED"])];
    const report = buildCandidateReport(evaluations, decisions, eligibilities);
    expect(report.ranking.map(({ candidateId }) => candidateId)).toEqual(["allowed"]);
    expect(report.heldOut.map(({ outcome, reasonCodes }) => [outcome, reasonCodes[0]])).toEqual([["RESTRICTED", "RESTRICTED_CODE"], ["MANUAL_REVIEW", "MANUAL_CODE"], ["REJECTED", "REJECTED_CODE"]]);
  });

  it("reports insufficient evidence when no candidate is eligible", () => {
    const evaluations = [evaluation("blocked")];
    const report = buildCandidateReport(evaluations, [decision("blocked", "ALLOWED")], [eligibility("blocked", false, ["EVIDENCE_QUALITY_BELOW_THRESHOLD"])]);
    expect(report).toEqual({ outcome: "INSUFFICIENT_EVIDENCE", ranking: [], heldOut: [{ candidateId: "blocked", outcome: "ALLOWED", reasonCodes: ["EVIDENCE_QUALITY_BELOW_THRESHOLD"] }] });
  });

  it.each([
    ["duplicate evaluation", [evaluation("same"), evaluation("same")], [decision("same", "ALLOWED"), decision("same", "ALLOWED")], [eligibility("same", true), eligibility("same", true)], /Fixture evaluations must contain unique candidate IDs/],
    ["duplicate decision", [evaluation("one"), evaluation("two")], [decision("one", "ALLOWED"), decision("one", "ALLOWED")], [eligibility("one", true), eligibility("two", true)], /Risk decisions must contain unique candidate IDs/],
    ["mismatched IDs", [evaluation("one")], [decision("other", "ALLOWED")], [eligibility("one", true)], /Risk decisions candidate IDs must match fixture evaluations/],
  ] as const)("rejects %s", (_label, evaluations, decisions, eligibilities, error) => {
    expect(() => buildCandidateReport([...evaluations], [...decisions], [...eligibilities])).toThrow(error);
  });
});
