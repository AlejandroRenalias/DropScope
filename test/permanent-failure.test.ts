import { describe, expect, it } from "vitest";
import type { MissionEvent } from "../src/contracts.js";
import { replay } from "../src/reducer.js";

const event = (sequenceNumber: number, type: MissionEvent["type"], payload: MissionEvent["payload"]): MissionEvent => ({
  schemaVersion: 1, sequenceNumber, missionId: "permanent-failure-demo", eventId: `permanent-failure-demo-${sequenceNumber}`,
  timestamp: `2026-09-02T00:00:${String(sequenceNumber).padStart(2, "0")}.000Z`, type, payload,
} as MissionEvent);

const mission = event(1, "MissionCreated", { totalBudget: 100, missionSeed: 0, policyVersions: { tribunal: "1" } });
const authorization = event(2, "TaskAuthorized", {
  taskId: "worker-task", objective: "Run worker task.", cost: 10, workClass: "MANDATORY", researchKey: "worker-task",
  authorizationReason: "MANDATORY_BASELINE", dependencies: [],
});
const schedule = (sequenceNumber: number, attemptId: string, workerRole: string) => event(sequenceNumber, "TaskScheduled", {
  taskId: "worker-task", attemptId, objective: "Run worker task.", cost: 10, workClass: "MANDATORY", researchKey: "worker-task",
  workerRole, dependencies: [],
});

describe("permanent worker failure", () => {
  it("records permanent failure and permits only compatible reassignment", () => {
    const events = [
      mission, authorization, schedule(3, "worker-task:a1", "RESEARCHER"),
      event(4, "BudgetReserved", { attemptId: "worker-task:a1", cost: 10 }),
      event(5, "TaskStarted", { attemptId: "worker-task:a1", simulatedDelayMs: 0 }),
      event(6, "TaskFailedPermanent", { attemptId: "worker-task:a1", reason: "Worker is unavailable." }),
      schedule(7, "worker-task:a2", "REVIEWER"),
    ];
    const state = replay(events);
    expect(state.attempts["worker-task:a1"]).toMatchObject({ status: "FAILED_PERMANENT", workerRole: "RESEARCHER" });
    expect(state.attempts["worker-task:a2"]).toMatchObject({ status: "SCHEDULED", workerRole: "REVIEWER" });
    expect(state.tasks["worker-task"].status).toBe("SCHEDULED");
  });

  it("rejects reassignment to the permanently failed worker", () => {
    const events = [
      mission, authorization, schedule(3, "worker-task:a1", "RESEARCHER"),
      event(4, "BudgetReserved", { attemptId: "worker-task:a1", cost: 10 }),
      event(5, "TaskStarted", { attemptId: "worker-task:a1", simulatedDelayMs: 0 }),
      event(6, "TaskFailedPermanent", { attemptId: "worker-task:a1", reason: "Worker is unavailable." }),
    ];
    expect(() => replay([...events, schedule(7, "worker-task:a2", "RESEARCHER")])).toThrow("same worker");
  });
});
