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
  it("reports approved uncertainty and claim-duplicate codes in deterministic order", () => {
    const makeClaim = (claimId: string, topic: string, evidenceIds: string[], tentative: boolean): ResearchDataset["claims"][number] => ({ claimId, candidateId: "candidate", claimTopic: topic, text: claimId, decisive: true, tentative, confidenceClass: "HIGH", evidenceIds, status: "PROPOSED" });
    const makeEvidence = (id: string, claimId: string, group: string, reliabilityClass: "HIGH" | "UNKNOWN" = "HIGH", annotation: Record<string, unknown> | null = null) => ({ ...evidence(id, claimId, group, "SUPPORTS", annotation), reliabilityClass });
    const deterministic: ResearchDataset = {
      candidates: base.candidates,
      sources: [source("evidence-Z-source"), source("evidence-é-source"), source("evidence-a-source"), source("evidence-dup-B-source"), source("evidence-dup-A-source")],
      claims: [
        makeClaim("claim-single", "single", ["evidence-Z"], false),
        makeClaim("claim-unknown", "unknown", ["evidence-a", "evidence-é"], true),
        makeClaim("claim-dup-B", "duplicate", ["evidence-dup-B"], true),
        makeClaim("claim-dup-A", "duplicate", ["evidence-dup-A"], true),
      ],
      evidence: [
        makeEvidence("evidence-Z", "claim-single", "group-Z"),
        makeEvidence("evidence-é", "claim-unknown", "group-é", "UNKNOWN"),
        makeEvidence("evidence-a", "claim-unknown", "group-a"),
        makeEvidence("evidence-dup-B", "claim-dup-B", "group-B", "HIGH", { canonicalEvidenceIds: ["shared-é", "shared-A"] }),
        makeEvidence("evidence-dup-A", "claim-dup-A", "group-A", "HIGH", { canonicalEvidenceIds: ["shared-A"] }),
      ],
    };
    const result = auditEvidence(deterministic);
    expect(result.findings.map(({ code, severity }) => ({ code, severity }))).toEqual([
      { code: "AUDIT_DECISIVE_SINGLE_GROUP_NOT_TENTATIVE", severity: "HIGH" },
      { code: "AUDIT_UNCERTAIN_DECISIVE_LABEL", severity: "HIGH" },
      { code: "AUDIT_UNCERTAIN_DECISIVE_LABEL", severity: "HIGH" },
      { code: "AUDIT_CLAIM_DUPLICATE", severity: "MEDIUM" },
    ]);
    expect(result.findings[0]).toMatchObject({ claimIds: ["claim-single"], evidenceIds: ["evidence-Z"] });
    expect(result.findings[1]).toMatchObject({ claimIds: ["claim-single"], evidenceIds: ["evidence-Z"] });
    expect(result.findings[2]).toMatchObject({ claimIds: ["claim-unknown"], evidenceIds: ["evidence-a", "evidence-é"] });
    expect(result.findings[3]).toMatchObject({ claimIds: ["claim-dup-A", "claim-dup-B"], evidenceIds: ["shared-A"] });
    expect(auditEvidence({ ...deterministic, claims: [...deterministic.claims].reverse(), evidence: [...deterministic.evidence].reverse() })).toEqual(result);
  });
});
