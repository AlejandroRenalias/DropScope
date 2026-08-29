import { describe, expect, it } from "vitest";

import { scoreEvidenceQuality } from "../src/evidence-quality.js";
import type { ResearchDataset } from "../src/research-domain.js";

const evidence = (evidenceId: string, claimId: string, group: string, reliabilityClass: "HIGH" | "MEDIUM" | "LOW") => ({
  evidenceId, sourceId: `${evidenceId}-source`, independenceGroupId: group, factId: evidenceId, candidateId: "candidate", claimId, claimTopic: "CUSTOMER_PROBLEM_EXISTS", content: evidenceId, sourceType: "CUSTOMER_REVIEW", geography: null,
  observedAt: "2026-08-29T10:00:00.000Z", capturedAt: "2026-08-29T10:00:00.000Z", reliabilityClass, direction: "SUPPORTS" as const, strength: 2, fixtureAnnotation: null,
});

const dataset: ResearchDataset = {
  candidates: [{ candidateId: "candidate", name: "Candidate", category: "Home" }],
  sources: ["a", "b", "c"].map((sourceId) => ({ sourceId: `${sourceId}-source`, sourceType: "CUSTOMER_REVIEW" as const, title: sourceId, canonicalLocation: `fixture://${sourceId}`, publisherOrOrigin: "Fixture", observedAt: "2026-08-29T10:00:00.000Z", capturedAt: "2026-08-29T10:00:00.000Z", geography: null, fixtureAnnotation: null })),
  claims: [
    { claimId: "first", candidateId: "candidate", claimTopic: "CUSTOMER_PROBLEM_EXISTS", text: "First decisive claim.", decisive: true, tentative: false, confidenceClass: "HIGH", evidenceIds: ["a", "b"], status: "PROPOSED" },
    { claimId: "second", candidateId: "candidate", claimTopic: "CUSTOMER_PROBLEM_EXISTS", text: "Second decisive claim.", decisive: true, tentative: true, confidenceClass: "LOW", evidenceIds: ["c"], status: "PROPOSED" },
  ],
  evidence: [evidence("a", "first", "one", "HIGH"), evidence("b", "first", "two", "MEDIUM"), evidence("c", "second", "three", "LOW")],
};

describe("frozen evidence-quality scoring", () => {
  it("weights the four frozen quality dimensions", () => {
    expect(scoreEvidenceQuality(dataset, { unresolvedMaterialContradictionCount: 1 })).toEqual({ score: 75, independenceScore: 75, reliabilityScore: 70, decisiveClaimCoverageScore: 100, contradictionResolutionScore: 50 });
  });

  it("uses zero for no decisive claims or no representative reliability", () => {
    expect(scoreEvidenceQuality({ ...dataset, claims: [{ ...dataset.claims[0], decisive: false }, { ...dataset.claims[1], decisive: false }] })).toEqual({ score: 0, independenceScore: 0, reliabilityScore: 0, decisiveClaimCoverageScore: 0, contradictionResolutionScore: 0 });
    expect(scoreEvidenceQuality({ ...dataset, evidence: [] })).toMatchObject({ reliabilityScore: 0, decisiveClaimCoverageScore: 0 });
  });

  it("reduces contradiction credit by half per unresolved material contradiction and rejects invalid counts", () => {
    expect(scoreEvidenceQuality(dataset, { unresolvedMaterialContradictionCount: 3 }).contradictionResolutionScore).toBe(0);
    expect(() => scoreEvidenceQuality(dataset, { unresolvedMaterialContradictionCount: -1 })).toThrow("non-negative integer");
  });

  it("uses only evidence aligned to each decisive claim's generic topic", () => {
    const genericTopicDataset = {
      ...dataset,
      claims: [{ ...dataset.claims[0], claimTopic: "TREND_DURABILITY", evidenceIds: ["a", "b", "wrong-topic"] }, dataset.claims[1]],
      evidence: [
        { ...dataset.evidence[0], claimTopic: "TREND_DURABILITY" },
        { ...dataset.evidence[1], claimTopic: "TREND_DURABILITY" },
        dataset.evidence[2],
        { ...dataset.evidence[0], evidenceId: "wrong-topic", claimTopic: "CUSTOMER_PROBLEM_EXISTS", independenceGroupId: "four", reliabilityClass: "HIGH" as const },
      ],
    };

    expect(scoreEvidenceQuality(genericTopicDataset, { unresolvedMaterialContradictionCount: 1 })).toEqual({ score: 75, independenceScore: 75, reliabilityScore: 70, decisiveClaimCoverageScore: 100, contradictionResolutionScore: 50 });
  });
});
