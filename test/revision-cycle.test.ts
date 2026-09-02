import { describe, expect, it } from "vitest";
import type { MissionEvent } from "../src/contracts.js";
import { replay } from "../src/reducer.js";
const e = (n: number, type: MissionEvent["type"], payload: MissionEvent["payload"]): MissionEvent => ({ schemaVersion: 1, sequenceNumber: n, missionId: "revision", eventId: `e-${n}`, timestamp: "2026-09-02T00:00:00.000Z", type, payload } as MissionEvent);
const mission = e(1, "MissionCreated", { totalBudget: 100, missionSeed: 1, policyVersions: { tribunal: "1" } });
const request = e(2, "RevisionRequested", { revisionId: "r", reviewId: "review", affectedClaimIds: ["claim"], blockingDefectCodes: ["defect"] });
const audit = e(3, "FocusedReauditCompleted", { revisionId: "r", auditId: "audit", changedClaimIds: ["claim"], findings: [] });
const rereview = e(4, "FocusedRereviewCompleted", { revisionId: "r", result: { reviewId: "review-2", candidateAssessments: [], ranking: [], verdict: "ACCEPT" } });
describe("focused revision cycle", () => {
  it("records exactly one ordered revision cycle", () => {
    expect(replay([mission, request, audit, rereview]).revision?.rereview?.reviewId).toBe("review-2");
    expect(() => replay([mission, request, { ...request, sequenceNumber: 3, eventId: "e-3" }])).toThrow("Only one revision cycle");
    expect(() => replay([mission, request, { ...rereview, sequenceNumber: 3, eventId: "e-3-rereview" }])).toThrow("completed focused re-audit");
  });
});
