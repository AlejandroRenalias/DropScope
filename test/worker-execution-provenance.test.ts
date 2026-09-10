import { describe, expect, it } from "vitest";
import { missionEventSchema, type MissionEvent } from "../src/contracts.js";
import { replay } from "../src/reducer.js";

const event = <T extends MissionEvent["type"]>(sequenceNumber: number, type: T, payload: Extract<MissionEvent, { type: T }> ["payload"]): Extract<MissionEvent, { type: T }> => ({
  schemaVersion: 1,
  sequenceNumber,
  missionId: "provenance-demo",
  eventId: `provenance-demo-${sequenceNumber}`,
  timestamp: `2026-09-10T00:00:${String(sequenceNumber).padStart(2, "0")}.000Z`,
  type,
  payload,
} as Extract<MissionEvent, { type: T }>);

const startedAttempt = (attemptId = "recorded:a1") => [
  event(1, "MissionCreated", { totalBudget: 20, missionSeed: 1, policyVersions: { tribunal: "1" } }),
  event(2, "TaskAuthorized", { taskId: "recorded", objective: "Read recorded evidence.", cost: 10, workClass: "MANDATORY", researchKey: "recorded", authorizationReason: "MANDATORY_BASELINE", dependencies: [] }),
  event(3, "TaskScheduled", { taskId: "recorded", attemptId, objective: "Read recorded evidence.", cost: 10, workClass: "MANDATORY", researchKey: "recorded", workerRole: "EVIDENCE_RESEARCHER", dependencies: [] }),
  event(4, "BudgetReserved", { attemptId, cost: 10 }),
  event(5, "TaskStarted", { attemptId, simulatedDelayMs: 0 }),
];

const recorded = (sequenceNumber: number, attemptId: string) => event(sequenceNumber, "WorkerExecutionRecorded", { attemptId, mode: "RECORDED_DRY_RUN", providerUsageStatus: "NOT_APPLICABLE" });

describe("worker execution provenance", () => {
  it("persists one recorded dry-run declaration against a running attempt", () => {
    const state = replay([...startedAttempt(), recorded(6, "recorded:a1")]);

    expect(state.workerExecutionProvenance).toEqual({
      "recorded:a1": { mode: "RECORDED_DRY_RUN", providerUsageStatus: "NOT_APPLICABLE" },
    });
  });

  it("preserves legacy histories and rejects early or duplicate declarations", () => {
    expect(replay(startedAttempt().slice(0, 1)).workerExecutionProvenance).toEqual({});
    expect(() => replay([...startedAttempt().slice(0, 4), recorded(5, "recorded:a1")])).toThrow("Only a running attempt");
    expect(() => replay([...startedAttempt("__proto__"), recorded(6, "__proto__"), recorded(7, "__proto__")])).toThrow("already recorded");
  });

  it("rejects a live mode or provider usage measurement in this dry-run-only contract", () => {
    const valid = recorded(6, "recorded:a1");

    expect(missionEventSchema.safeParse(valid).success).toBe(true);
    expect(missionEventSchema.safeParse({ ...valid, payload: { ...valid.payload, mode: "LIVE_PROVIDER" } }).success).toBe(false);
    expect(missionEventSchema.safeParse({ ...valid, payload: { ...valid.payload, providerUsageStatus: "REPORTED" } }).success).toBe(false);
  });
});
