import { describe, expect, it } from "vitest";

import {
  blindReviewResultSchema,
  divergenceRecordSchema,
  researchDatasetSchema,
} from "../src/research-domain.js";

const dataset = {
  candidates: [{ candidateId: "desk-organizer", name: "Cable organizer", category: "Home office" }],
  sources: [{ sourceId: "review-source", sourceType: "CUSTOMER_REVIEW", title: "Cable organizer reviews", canonicalLocation: "fixture://reviews/cable-organizer", publisherOrOrigin: "Fixture review corpus", observedAt: "2026-08-29T10:00:00.000Z", capturedAt: "2026-08-29T10:00:00.000Z", geography: "US", fixtureAnnotation: null }],
  claims: [{ claimId: "cable-clutter", candidateId: "desk-organizer", claimTopic: "customer-problem", text: "Users report cable clutter.", decisive: true, tentative: false, confidenceClass: "MEDIUM", evidenceIds: ["review-evidence"] , status: "PROPOSED" }],
  evidence: [{ evidenceId: "review-evidence", sourceId: "review-source", independenceGroupId: "reviewers", factId: "reviews-cable-clutter", candidateId: "desk-organizer", claimId: "cable-clutter", claimTopic: "customer-problem", content: "Review corpus reports cable clutter.", sourceType: "CUSTOMER_REVIEW", geography: "US", observedAt: "2026-08-29T10:00:00.000Z", capturedAt: "2026-08-29T10:00:00.000Z", reliabilityClass: "MEDIUM", direction: "SUPPORTS", strength: 3, fixtureAnnotation: null }],
};

describe("research domain validation", () => {
  it("accepts a fixture dataset with internally consistent records", () => {
    expect(researchDatasetSchema.parse(dataset)).toMatchObject(dataset);
  });

  it("rejects signed evidence that contradicts its declared direction", () => {
    const invalid = structuredClone(dataset);
    invalid.evidence[0].strength = -2;

    expect(() => researchDatasetSchema.parse(invalid)).toThrow("Evidence direction must match the sign of its strength.");
  });

  it("rejects dangling and mismatched evidence references", () => {
    const invalid = structuredClone(dataset);
    invalid.evidence[0].claimTopic = "trend-durability";
    invalid.claims[0].evidenceIds = ["missing-evidence"];

    expect(() => researchDatasetSchema.parse(invalid)).toThrow(/unknown evidence|same candidate and topic/);
  });

  it("requires fixture annotations to be explicit objects or null", () => {
    const missing = structuredClone(dataset);
    delete (missing.sources[0] as Partial<typeof missing.sources[number]>).fixtureAnnotation;
    const invalid = structuredClone(dataset);
    invalid.evidence[0].fixtureAnnotation = "not-an-object" as never;

    expect(() => researchDatasetSchema.parse(missing)).toThrow();
    expect(() => researchDatasetSchema.parse(invalid)).toThrow();
  });
});

describe("frozen quality-pipeline contracts", () => {
  const review = {
    reviewId: "review-1",
    candidateAssessments: [{
      anonymizedCandidateId: "candidate-a",
      reviewerScore: 82,
      reviewerEligible: true,
      confidenceClass: "HIGH",
      dimensionScores: {
        sourceIndependence: 90,
        decisionCriticalCoverage: 75,
        contradictionHandling: 100,
        claimEvidenceAlignment: 85,
        uncertaintyCalibration: 80,
      },
      blockingDefects: [],
      missingResearchKeys: ["pricing"],
    }],
    ranking: ["candidate-a"],
    verdict: "REVISE",
  };

  it("accepts a complete blind review result", () => {
    expect(blindReviewResultSchema.parse(review)).toEqual(review);
  });

  it("enforces blind review enums, score range, and strict fields", () => {
    expect(() => blindReviewResultSchema.parse({ ...review, verdict: "MAYBE" })).toThrow();
    expect(() => blindReviewResultSchema.parse({
      ...review,
      candidateAssessments: [{ ...review.candidateAssessments[0], reviewerScore: 101 }],
    })).toThrow();
    expect(() => blindReviewResultSchema.parse({ ...review, unexpected: true })).toThrow();
    expect(() => blindReviewResultSchema.parse({ ...review, ranking: ["candidate", "candidate"] })).toThrow();
    expect(() => blindReviewResultSchema.parse({ ...review, candidateAssessments: [review.candidateAssessments[0], review.candidateAssessments[0]] })).toThrow();
    expect(() => blindReviewResultSchema.parse({
      ...review,
      candidateAssessments: [{ ...review.candidateAssessments[0], unexpected: true }],
    })).toThrow();
    expect(() => blindReviewResultSchema.parse({
      ...review,
      candidateAssessments: [{
        ...review.candidateAssessments[0],
        dimensionScores: { ...review.candidateAssessments[0].dimensionScores, sourceIndependence: 101 },
      }],
    })).toThrow();
    expect(() => blindReviewResultSchema.parse({
      ...review,
      candidateAssessments: [{
        ...review.candidateAssessments[0],
        dimensionScores: { ...review.candidateAssessments[0].dimensionScores, unexpected: 50 },
      }],
    })).toThrow();
  });

  it("accepts divergence records with nullable research and resolution fields", () => {
    const divergence = {
      divergenceId: "divergence-1",
      type: "MISSING_EVIDENCE_DIVERGENCE",
      candidateIds: ["candidate-a"],
      researchKey: null,
      blocking: false,
      status: "UNRESOLVED_ACCEPTED",
      resolutionNote: "Accepted pending the next research pass.",
    };

    expect(divergenceRecordSchema.parse(divergence)).toEqual(divergence);
  });

  it("enforces divergence enums, IDs, nullability, and strict fields", () => {
    const divergence = {
      divergenceId: "divergence-1",
      type: "ELIGIBILITY_DIVERGENCE",
      candidateIds: ["candidate-a"],
      researchKey: "eligibility",
      blocking: true,
      status: "OPEN",
      resolutionNote: null,
    };

    expect(() => divergenceRecordSchema.parse({ ...divergence, type: "UNKNOWN" })).toThrow();
    expect(() => divergenceRecordSchema.parse({ ...divergence, candidateIds: [""] })).toThrow();
    expect(() => divergenceRecordSchema.parse({ ...divergence, researchKey: 3 })).toThrow();
    expect(() => divergenceRecordSchema.parse({ ...divergence, unexpected: true })).toThrow();
  });
});
