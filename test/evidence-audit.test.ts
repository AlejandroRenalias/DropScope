import { describe, expect, it } from "vitest";
import { auditEvidence } from "../src/evidence-audit.js";
import type { ResearchDataset } from "../src/research-domain.js";

const source = (sourceId: string, canonicalLocation = `fixture://${sourceId}`) => ({ sourceId, sourceType: "CUSTOMER_REVIEW" as const, title: sourceId, canonicalLocation, publisherOrOrigin: "Fixture", observedAt: "2026-08-29T10:00:00.000Z", capturedAt: "2026-08-29T10:00:00.000Z", geography: null, fixtureAnnotation: null });
const evidence = (id: string, claimId: string, group: string, direction: "SUPPORTS" | "OPPOSES", annotation: Record<string, unknown> | null = null) => ({ evidenceId: id, sourceId: `${id}-source`, independenceGroupId: group, factId: id, candidateId: "candidate", claimId, claimTopic: "topic", content: id, sourceType: "CUSTOMER_REVIEW", geography: null, observedAt: "2026-08-29T10:00:00.000Z", capturedAt: "2026-08-29T10:00:00.000Z", reliabilityClass: "HIGH" as const, direction, strength: direction === "SUPPORTS" ? 2 : -2, fixtureAnnotation: annotation });
const base: ResearchDataset = { candidates: [{ candidateId: "candidate", name: "Candidate", category: "Home" }], sources: [source("support-source"), source("oppose-source")], claims: [{ claimId: "claim", candidateId: "candidate", claimTopic: "topic", text: "Claim", decisive: true, tentative: true, confidenceClass: "HIGH", evidenceIds: ["support", "oppose"], status: "PROPOSED" }], evidence: [evidence("support", "claim", "group-a", "SUPPORTS"), evidence("oppose", "claim", "group-b", "OPPOSES")] };

describe("evidence audit", () => {
  it("emits material contradiction deterministically", () => {
    const result = auditEvidence(base);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ code: "AUDIT_MATERIAL_CONTRADICTION", severity: "HIGH", claimIds: ["claim"], evidenceIds: ["oppose", "support"] });
    expect(auditEvidence({ ...base, evidence: [...base.evidence].reverse() })).toEqual(result);
  });
  it("reports missing traceability, tentative defects, and declared duplicates", () => {
    const broken = { ...base, claims: [{ ...base.claims[0], tentative: false, evidenceIds: [] }, { ...base.claims[0], claimId: "claim-2", evidenceIds: ["support"] }], sources: [source("a-source", "fixture://same/"), source("b-source", "fixture://same")], evidence: [{ ...base.evidence[0], fixtureAnnotation: { canonicalFactId: "fact" } }, { ...base.evidence[1], sourceId: "missing-source", fixtureAnnotation: { canonicalFactId: "fact" } }] } as ResearchDataset;
    const codes = auditEvidence(broken).findings.map((item) => item.code);
    expect(codes).toContain("AUDIT_EVIDENCE_UNTRACEABLE");
    expect(codes).toContain("AUDIT_DECISIVE_CLAIM_NO_VALID_EVIDENCE");
    expect(codes).toContain("AUDIT_SOURCE_DUPLICATE");
    expect(codes).toContain("AUDIT_FACT_DUPLICATE");
  });
});
