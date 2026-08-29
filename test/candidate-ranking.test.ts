import { describe, expect, it } from "vitest";

import { calculateResearchPriority, rankEligibleCandidates, type CandidateRankingInput } from "../src/candidate-ranking.js";

const candidate = (candidateId: string, overrides: Partial<CandidateRankingInput> = {}): CandidateRankingInput => ({
  candidateId, eligible: true, customerProblemEvidenceScore: 80, evidenceQualityScore: 70, trendDurabilityScore: 60, advertisingSaturationScore: 40, operationalRiskScore: 30, failureRiskScore: 20, ...overrides,
});

describe("research-priority ranking", () => {
  it("uses the frozen weighted formula with inverse saturation and risk dimensions", () => {
    expect(calculateResearchPriority(candidate("first"))).toBe(71);
  });

  it("ranks eligible candidates by priority, quality, then lexical ID", () => {
    expect(rankEligibleCandidates([
      candidate("zeta", { evidenceQualityScore: 80 }),
      candidate("alpha", { evidenceQualityScore: 80 }),
      candidate("higher", { customerProblemEvidenceScore: 90 }),
      candidate("held", { eligible: false, customerProblemEvidenceScore: 100 }),
    ]).map(({ candidateId }) => candidateId)).toEqual(["higher", "alpha", "zeta"]);
  });

  it("rejects missing IDs and out-of-range scores", () => {
    expect(() => calculateResearchPriority(candidate("", {}))).toThrow("Candidate ID");
    expect(() => calculateResearchPriority(candidate("bad", { failureRiskScore: 101 }))).toThrow("integers from 0 through 100");
    expect(() => calculateResearchPriority(candidate("bad", { eligible: "false" as never }))).toThrow("eligibility must be a boolean");
  });

  it("uses code-unit lexical ordering independent of the host locale", () => {
    expect(rankEligibleCandidates([candidate("ä"), candidate("z")]).map(({ candidateId }) => candidateId)).toEqual(["z", "ä"]);
  });
});
