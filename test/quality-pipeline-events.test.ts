import { describe, expect, it } from "vitest";
import { type MissionEvent } from "../src/contracts.js";
import { replay } from "../src/reducer.js";

const event = (sequenceNumber: number, type: MissionEvent["type"], payload: MissionEvent["payload"]): MissionEvent => ({ schemaVersion: 1, sequenceNumber, missionId: "quality", eventId: `e-${sequenceNumber}`, timestamp: "2026-08-31T00:00:00.000Z", type, payload } as MissionEvent);
const mission = event(1, "MissionCreated", { totalBudget: 100, missionSeed: 1, policyVersions: { tribunal: "1" } });

describe("quality-pipeline event replay", () => {
  it("records audit, blind review, and divergence results without changing mission authority", () => {
    const audit = event(2, "AuditCompleted", { auditId: "audit", findings: [] });
    const review = event(3, "BlindReviewCompleted", { reviewId: "review", candidateAssessments: [], ranking: [], verdict: "ACCEPT" });
    const divergencePayload = { records: [{ divergenceId: "divergence", type: "MISSING_EVIDENCE_DIVERGENCE" as const, candidateIds: ["candidate"], researchKey: "demand", blocking: true, status: "OPEN" as const, resolutionNote: null }] };
    const divergence = event(4, "MissingEvidenceDivergenceDetected", divergencePayload);
    const state = replay([mission, audit, review, divergence]);
    expect(state.status).toBe("RUNNING");
    expect(state.auditResults.audit).toEqual(audit.payload);
    expect(state.blindReviewResults.review).toEqual(review.payload);
    expect(state.divergenceRecords.divergence).toEqual(divergencePayload.records[0]);
  });
});
