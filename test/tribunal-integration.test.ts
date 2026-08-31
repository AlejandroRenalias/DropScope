import { describe, expect, it } from "vitest";
import { missionEventSchema, type MissionEvent } from "../src/contracts.js";
import { replay } from "../src/reducer.js";

const event = (sequenceNumber: number, type: MissionEvent["type"], payload: MissionEvent["payload"]): MissionEvent => ({
  schemaVersion: 1,
  sequenceNumber,
  missionId: "tribunal-mission",
  eventId: `event-${sequenceNumber}`,
  timestamp: "2026-08-31T00:00:00.000Z",
  type,
  payload,
} as MissionEvent);

const mission = event(1, "MissionCreated", { totalBudget: 100, missionSeed: 5, policyVersions: { tribunal: "1" } });
const tribunal = (version = "1") => event(2, "TribunalCompleted", {
  tribunalId: "tribunal-1",
  candidateId: "candidate-1",
  recommendation: "CAUTION",
  ventureClaimIds: ["claim-1"],
  ruinClaimIds: ["claim-1"],
  reasons: [{ code: "TRIBUNAL_MATERIAL_CONFLICT", explanation: "Conflict remains.", claimIds: ["claim-1"], evidenceIds: ["evidence-1"], riskDecisionId: null, riskReasonCodes: [] }],
  decidedByPolicyVersion: version,
});

describe("tribunal event integration", () => {
  it("validates and replays the frozen tribunal result without changing mission status", () => {
    const result = tribunal();
    expect(missionEventSchema.parse(result)).toEqual(result);
    const state = replay([mission, result]);
    expect(state.status).toBe("RUNNING");
    expect(state.policyVersions).toEqual({ tribunal: "1" });
    expect(state.tribunalResults).toEqual({ "tribunal-1": result.payload });
  });

  it("rejects schema drift, a policy-version mismatch, and duplicate tribunal IDs", () => {
    expect(() => missionEventSchema.parse({ ...tribunal(), payload: { ...tribunal().payload, unexpected: true } })).toThrow();
    expect(() => replay([mission, tribunal("2")])).toThrow("policy version does not match");
    expect(() => replay([mission, tribunal(), { ...tribunal(), sequenceNumber: 3, eventId: "event-3" }])).toThrow("already recorded");
  });
});
