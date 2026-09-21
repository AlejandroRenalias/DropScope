import { describe, expect, it } from "vitest";
import { missionEventSchema } from "../src/contracts.js";
import { replay } from "../src/reducer.js";

const created = { schemaVersion: 1 as const, sequenceNumber: 1, missionId: "autopsy", eventId: "autopsy-1", timestamp: "2026-01-01T00:00:00.000Z", type: "MissionCreated" as const, payload: { totalBudget: 20, missionSeed: 1, policyVersions: { tribunal: "1" } } };
const autopsyMode = { schemaVersion: 1 as const, sequenceNumber: 2, missionId: "autopsy", eventId: "autopsy-2", timestamp: "2026-01-01T00:00:01.000Z", type: "MissionModeDeclared" as const, payload: { mode: "FAILURE_AUTOPSY" as const } };

describe("Failure Autopsy mission mode", () => {
  it("is a strict one-time declaration immediately after mission creation", () => {
    expect(replay([created, autopsyMode]).missionMode).toBe("FAILURE_AUTOPSY");
    expect(() => replay([created, { ...created, sequenceNumber: 2, eventId: "autopsy-task", type: "TaskAuthorized" as const, payload: { taskId: "task", objective: "task", cost: 1, workClass: "MANDATORY" as const, researchKey: "task", authorizationReason: "MANDATORY_BASELINE" as const, dependencies: [] } }, { ...autopsyMode, sequenceNumber: 3, eventId: "autopsy-mode-late" }])).toThrow("immediately after mission creation");
    expect(() => replay([created, autopsyMode, { ...autopsyMode, sequenceNumber: 3, eventId: "autopsy-mode-duplicate" }])).toThrow("exactly once");
  });

  it("does not admit an explicit Learn-a-Market declaration", () => {
    expect(missionEventSchema.safeParse({ ...autopsyMode, payload: { mode: "LEARN_A_MARKET" } }).success).toBe(false);
    expect(missionEventSchema.safeParse({ ...autopsyMode, payload: { mode: "PRODUCT_INVESTIGATION" } }).success).toBe(true);
  });
});
