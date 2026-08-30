import { describe, expect, it } from "vitest";
import { calculateBlindReview, calculateBlindReviewDimensions, calculateReviewerScore, mapReviewerDecision, rankBlindReviews, type BlindReviewInput } from "../src/blind-review.js";

const base: BlindReviewInput = {
  anonymizedCandidateId: "b",
  claims: [
    { claimId: "c1", candidateId: "b", decisive: true, audited: true, tentative: true, requiresUncertaintyLabel: true, uncertaintyLabelCorrect: true },
    { claimId: "c2", candidateId: "b", decisive: true, audited: true },
  ],
  evidence: [
    { evidenceId: "e1", claimId: "c1", candidateId: "b", independenceGroupId: "g1", direction: "SUPPORTS" },
    { evidenceId: "e2", claimId: "c1", candidateId: "b", independenceGroupId: "g2", direction: "OPPOSES" },
    { evidenceId: "e3", claimId: "c2", candidateId: "b", independenceGroupId: "g3", direction: "SUPPORTS" },
  ],
  requiredResearchKeys: ["pricing", "demand"], coveredResearchKeys: ["pricing"], unresolvedMaterialContradictionCount: 1,
};

describe("blind reviewer calculations", () => {
  it("applies all five frozen dimension formulas and rounded weighted score", () => {
    const scores = calculateBlindReviewDimensions(base);
    expect(scores).toEqual({ sourceIndependence: 75, decisionCriticalCoverage: 50, contradictionHandling: 50, claimEvidenceAlignment: 100, uncertaintyCalibration: 100 });
    expect(calculateReviewerScore(scores)).toBe(70);
  });

  it("handles rubric empty cases", () => {
    const input = { anonymizedCandidateId: "x", claims: [], evidence: [], requiredResearchKeys: [] };
    const scores = calculateBlindReviewDimensions(input);
    expect(scores).toEqual({ sourceIndependence: 0, decisionCriticalCoverage: 0, contradictionHandling: 100, claimEvidenceAlignment: 0, uncertaintyCalibration: 100 });
    expect(calculateBlindReview(input).reviewerScore).toBe(0);
  });

  it("collects blocking defects and missing keys", () => {
    const result = calculateBlindReview({ ...base, claims: [{ claimId: "c1", candidateId: "b", decisive: true }], evidence: [] });
    expect(result.blockingDefects).toEqual(["decisive_claim_has_no_valid_evidence", "unresolved_decision_critical_contradiction"]);
    expect(result.missingResearchKeys).toEqual(["demand"]);
    expect(result.reviewerEligible).toBe(false);
    expect(result.confidenceClass).toBe("LOW");
    expect(result.verdict).toBe("REJECT");
    expect(result.reasonCodes).toEqual(["REVIEW_BLOCKING_DEFECTS_PRESENT"]);
  });

  it("applies defects, gaps, and score precedence", () => {
    expect(mapReviewerDecision({ reviewerScore: 95, blockingDefects: ["defect"], missingResearchKeys: ["gap"] })).toEqual({ reviewerEligible: false, confidenceClass: "LOW", verdict: "REJECT", reasonCodes: ["REVIEW_BLOCKING_DEFECTS_PRESENT"] });
    expect(mapReviewerDecision({ reviewerScore: 95, blockingDefects: [], missingResearchKeys: ["gap"] })).toEqual({ reviewerEligible: false, confidenceClass: "LOW", verdict: "REASSIGN", reasonCodes: ["REVIEW_MISSING_RESEARCH_KEYS"] });
    expect(calculateBlindReview({
      ...base,
      claims: [base.claims[0]],
      evidence: base.evidence.slice(0, 2),
      unresolvedMaterialContradictionCount: 0,
    }).verdict).toBe("REASSIGN");
  });

  it.each([
    [74, false, "MEDIUM", "REVISE", "REVIEW_SCORE_BELOW_MINIMUM"],
    [75, true, "MEDIUM", "ACCEPT", "REVIEW_SCORE_ACCEPTABLE"],
    [89, true, "MEDIUM", "ACCEPT", "REVIEW_SCORE_ACCEPTABLE"],
    [90, true, "HIGH", "ACCEPT", "REVIEW_SCORE_HIGH"],
  ] as const)("maps score boundary %s", (score, eligible, confidenceClass, verdict, code) => {
    expect(mapReviewerDecision({ reviewerScore: score, blockingDefects: [], missingResearchKeys: [] })).toEqual({ reviewerEligible: eligible, confidenceClass, verdict, reasonCodes: [code] });
  });

  it("flags evidence that cannot be traced to a supplied claim and candidate", () => {
    const result = calculateBlindReview({ ...base, evidence: [...base.evidence, { evidenceId: "orphan", claimId: "unknown", candidateId: "b", independenceGroupId: "g9", direction: "SUPPORTS" }] });
    expect(result.blockingDefects).toContain("malformed_or_untraceable_evidence");
  });

  it("ranks by reviewer score, independence, then code-unit ID", () => {
    const make = (id: string, score: number, independence: number): ReturnType<typeof calculateBlindReview> => ({ ...calculateBlindReview({ anonymizedCandidateId: id, claims: [], evidence: [] }), reviewerScore: score, dimensionScores: { sourceIndependence: independence, decisionCriticalCoverage: 0, contradictionHandling: 0, claimEvidenceAlignment: 0, uncertaintyCalibration: 0 } });
    expect(rankBlindReviews([make("z", 80, 90), make("a", 80, 90), make("low", 70, 100)]).map(({ anonymizedCandidateId }) => anonymizedCandidateId)).toEqual(["a", "z", "low"]);
  });
});
