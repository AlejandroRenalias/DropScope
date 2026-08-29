import { describe, expect, it } from "vitest";

import { scoreDatasetClaim, selectEvidenceRepresentatives } from "../src/evidence-scoring.js";
import { researchDatasetSchema, type Evidence, type ResearchDataset } from "../src/research-domain.js";

const dataset: ResearchDataset = {
  candidates: [{ candidateId: "candidate", name: "Candidate", category: "Home" }],
  sources: ["one", "two", "three", "four"].map((sourceId) => ({ sourceId, sourceType: "CUSTOMER_REVIEW" as const, title: sourceId, canonicalLocation: `fixture://${sourceId}`, publisherOrOrigin: "Fixture", observedAt: "2026-08-29T10:00:00.000Z", capturedAt: "2026-08-29T10:00:00.000Z", geography: null, fixtureAnnotation: null })),
  claims: [
    { claimId: "problem", candidateId: "candidate", claimTopic: "CUSTOMER_PROBLEM_EXISTS", text: "There is a problem.", decisive: true, tentative: false, confidenceClass: "MEDIUM", evidenceIds: ["a", "b", "c", "d"], status: "PROPOSED" },
    { claimId: "another-claim", candidateId: "candidate", claimTopic: "CUSTOMER_PROBLEM_EXISTS", text: "A related problem claim.", decisive: false, tentative: false, confidenceClass: "LOW", evidenceIds: ["other-claim"], status: "PROPOSED" },
  ],
  evidence: [
    { evidenceId: "a", sourceId: "one", independenceGroupId: "reviews", factId: "a", candidateId: "candidate", claimId: "problem", claimTopic: "CUSTOMER_PROBLEM_EXISTS", content: "Strong support.", sourceType: "CUSTOMER_REVIEW", geography: null, observedAt: "2026-08-29T10:00:00.000Z", capturedAt: "2026-08-29T10:00:00.000Z", reliabilityClass: "MEDIUM", direction: "SUPPORTS", strength: 5, fixtureAnnotation: null },
    { evidenceId: "b", sourceId: "two", independenceGroupId: "reviews", factId: "b", candidateId: "candidate", claimId: "problem", claimTopic: "CUSTOMER_PROBLEM_EXISTS", content: "Weak support.", sourceType: "CUSTOMER_REVIEW", geography: null, observedAt: "2026-08-29T10:00:00.000Z", capturedAt: "2026-08-29T10:00:00.000Z", reliabilityClass: "LOW", direction: "SUPPORTS", strength: 5, fixtureAnnotation: null },
    { evidenceId: "c", sourceId: "three", independenceGroupId: "survey", factId: "c", candidateId: "candidate", claimId: "problem", claimTopic: "CUSTOMER_PROBLEM_EXISTS", content: "Opposing evidence.", sourceType: "CUSTOMER_REVIEW", geography: null, observedAt: "2026-08-29T10:00:00.000Z", capturedAt: "2026-08-29T10:00:00.000Z", reliabilityClass: "HIGH", direction: "OPPOSES", strength: -2, fixtureAnnotation: null },
    { evidenceId: "d", sourceId: "four", independenceGroupId: "unknown", factId: "d", candidateId: "candidate", claimId: "problem", claimTopic: "CUSTOMER_PROBLEM_EXISTS", content: "Unreliable support.", sourceType: "CUSTOMER_REVIEW", geography: null, observedAt: "2026-08-29T10:00:00.000Z", capturedAt: "2026-08-29T10:00:00.000Z", reliabilityClass: "UNKNOWN", direction: "SUPPORTS", strength: 5, fixtureAnnotation: null },
  ],
};

describe("frozen evidence scoring", () => {
  it("uses one strongest weighted representative for every independence group", () => {
    expect(selectEvidenceRepresentatives(dataset.evidence).map((item) => item.evidenceId)).toEqual(["a", "c", "d"]);
    expect(scoreDatasetClaim(dataset, "problem")).toMatchObject({ representativeEvidenceIds: ["a", "c", "d"], independentGroupCount: 3, netStrength: 1.5, score: 58, requiresTentativeLabel: true });
  });

  it("breaks equal-magnitude group ties toward opposing evidence, then lexical ID", () => {
    const support = { ...dataset.evidence[0], evidenceId: "z", reliabilityClass: "HIGH" as const, strength: 2, independenceGroupId: "tie" };
    const oppose = { ...dataset.evidence[2], evidenceId: "a", strength: -2, independenceGroupId: "tie" };
    const sameDirection = { ...support, evidenceId: "b", independenceGroupId: "lexical" };
    const sameDirectionLater = { ...support, evidenceId: "c", independenceGroupId: "lexical" };

    expect(selectEvidenceRepresentatives([support, oppose, sameDirectionLater, sameDirection] as Evidence[]).map((item) => item.evidenceId)).toEqual(["a", "b"]);
  });

  it("uses lexical IDs for zero-weight ties regardless of input order", () => {
    const unknownSupport = { ...dataset.evidence[3], evidenceId: "z", independenceGroupId: "zero" };
    const neutral = { ...dataset.evidence[3], evidenceId: "a", independenceGroupId: "zero", direction: "NEUTRAL" as const, strength: 0 };

    expect(selectEvidenceRepresentatives([unknownSupport, neutral]).map((item) => item.evidenceId)).toEqual(["a"]);
    expect(selectEvidenceRepresentatives([neutral, unknownSupport]).map((item) => item.evidenceId)).toEqual(["a"]);
  });

  it("marks a decisive claim tentative when it has fewer than two independent groups", () => {
    const oneGroup = { ...dataset, evidence: [dataset.evidence[0]] };

    expect(scoreDatasetClaim(oneGroup, "problem").requiresTentativeLabel).toBe(true);
  });

  it("scores all evidence for the candidate and canonical topic, then clamps the net range", () => {
    const supportingGroups = ["one", "two", "three"].map((independenceGroupId, index) => ({ ...dataset.evidence[0], evidenceId: `support-${index}`, independenceGroupId }));
    const opposingGroups = ["one", "two", "three", "four", "five", "six"].map((independenceGroupId, index) => ({ ...dataset.evidence[2], evidenceId: `oppose-${index}`, independenceGroupId }));
    const additionalClaimEvidence = { ...dataset.evidence[0], evidenceId: "other-claim", claimId: "another-claim", independenceGroupId: "four" };

    const crossClaimDataset = {
      ...dataset,
      claims: [{ ...dataset.claims[0], evidenceIds: supportingGroups.map((item) => item.evidenceId) }, dataset.claims[1]],
      evidence: [...supportingGroups, additionalClaimEvidence],
    };

    expect(() => researchDatasetSchema.parse(crossClaimDataset)).not.toThrow();
    expect(scoreDatasetClaim(crossClaimDataset, "problem")).toMatchObject({ netStrength: 10, score: 100 });
    expect(scoreDatasetClaim({ ...dataset, evidence: opposingGroups }, "problem")).toMatchObject({ netStrength: -10, score: 0 });
  });
});
