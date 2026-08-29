import { describe, expect, it } from "vitest";

import { researchDatasetSchema } from "../src/research-domain.js";

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
