import { describe, expect, it } from "vitest";
import type { MissionEvent } from "../src/contracts.js";
import { replay } from "../src/reducer.js";
const e = <T extends MissionEvent["type"]>(n: number, type: T, payload: Extract<MissionEvent, { type: T }> ["payload"]): Extract<MissionEvent, { type: T }> => ({ schemaVersion: 1, sequenceNumber: n, missionId: "revision", eventId: `e-${n}`, timestamp: "2026-09-02T00:00:00.000Z", type, payload } as Extract<MissionEvent, { type: T }>);
const mission = e(1, "MissionCreated", { totalBudget: 100, missionSeed: 1, policyVersions: { tribunal: "1" } });
const review = e(2, "BlindReviewCompleted", { reviewId: "review", candidateAssessments: [], ranking: [], verdict: "REJECT" });
const request = e(3, "RevisionRequested", { revisionId: "r", reviewId: "review", affectedClaimIds: ["claim"], blockingDefectCodes: ["defect"] });
const audit = e(4, "FocusedReauditCompleted", { revisionId: "r", auditId: "audit", changedClaimIds: ["claim"], findings: [] });
const rereview = e(5, "FocusedRereviewCompleted", { revisionId: "r", result: { reviewId: "review-2", candidateAssessments: [], ranking: [], verdict: "ACCEPT" } });
describe("focused revision cycle", () => {
  it("records exactly one ordered revision cycle", () => {
    expect(replay([mission, review, request, audit, rereview]).revision?.rereview?.reviewId).toBe("review-2");
    expect(() => replay([mission, review, request, { ...request, sequenceNumber: 4, eventId: "e-4" }])).toThrow("Only one revision cycle");
    expect(() => replay([mission, review, request, { ...rereview, sequenceNumber: 4, eventId: "e-4-rereview" }])).toThrow("completed focused re-audit");
  });

  it("requires the recorded triggering review and keeps re-audit inside the requested scope", () => {
    expect(() => replay([mission, review, e(3, "RevisionRequested", { ...request.payload, reviewId: "missing" })])).toThrow("recorded review");
    expect(() => replay([mission, review, e(3, "RevisionRequested", { ...request.payload, reviewId: "toString" })])).toThrow("recorded review");
    expect(() => replay([mission, review, request, { ...audit, payload: { ...audit.payload, changedClaimIds: ["outside"] } }])).toThrow("active revision");
    expect(() => replay([mission, review, request, { ...audit, payload: { ...audit.payload, changedClaimIds: ["claim", "claim"] } }])).toThrow("active revision");
  });

  it("requires an independent accepted re-review before completion", () => {
    const completion = e(4, "MissionCompleted", {});
    expect(() => replay([mission, review, request, completion])).toThrow("unfinished or unaccepted revision");
    expect(() => replay([mission, review, request, audit, e(5, "FocusedRereviewCompleted", { revisionId: "r", result: { ...rereview.payload.result, reviewId: "review" } })])).toThrow("completed focused re-audit");
    const secondReview = e(3, "BlindReviewCompleted", { reviewId: "other-review", candidateAssessments: [], ranking: [], verdict: "REJECT" });
    expect(() => replay([mission, review, secondReview, e(4, "RevisionRequested", request.payload), e(5, "FocusedReauditCompleted", audit.payload), e(6, "FocusedRereviewCompleted", { revisionId: "r", result: { ...rereview.payload.result, reviewId: "other-review" } })])).toThrow("completed focused re-audit");
    const rejectedRereview = e(5, "FocusedRereviewCompleted", { revisionId: "r", result: { ...rereview.payload.result, verdict: "REJECT" } });
    expect(() => replay([mission, review, request, audit, rejectedRereview, e(6, "MissionCompleted", {})])).toThrow("unfinished or unaccepted revision");
    const completed = replay([mission, review, request, audit, rereview, e(6, "MissionCompleted", {})]);
    expect(() => replay([mission, review, request, audit, rereview, e(6, "MissionCompleted", {}), { ...audit, sequenceNumber: 7, eventId: "e-7" }])).toThrow("active revision");
    expect(completed.status).toBe("COMPLETED");
  });
});
