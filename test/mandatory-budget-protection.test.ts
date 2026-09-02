import { describe, expect, it } from "vitest";

import { handleProposedEvent } from "../src/command-handler.js";
import type { MissionEvent, WorkClass } from "../src/contracts.js";
import { protectedMandatoryBudget, remainingMandatoryUnreservedCost, replay } from "../src/reducer.js";

const event = (sequenceNumber: number, type: MissionEvent["type"], payload: MissionEvent["payload"]): MissionEvent => ({
  schemaVersion: 1,
  sequenceNumber,
  missionId: "mandatory-protection-demo",
  eventId: `mandatory-protection-demo-${sequenceNumber}`,
  timestamp: `2026-08-28T00:00:${String(sequenceNumber).padStart(2, "0")}.000Z`,
  type,
  payload,
} as MissionEvent);

const proposal = (taskId: string, workClass: WorkClass, cost: number) => ({
  taskId,
  objective: `${taskId} objective.`,
  cost,
  workClass,
  researchKey: taskId,
  ...(workClass === "OPTIONAL" ? { gapId: "optional-gap" } : {}),
  authorizationReason: workClass === "MANDATORY" ? "MANDATORY_BASELINE" as const : "GAP_RESOLUTION" as const,
  dependencies: [],
});
const authorize = (sequenceNumber: number, taskId: string, workClass: WorkClass, cost: number) => event(sequenceNumber, "TaskAuthorized", proposal(taskId, workClass, cost));
const schedule = (sequenceNumber: number, taskId: string, workClass: WorkClass, cost: number) => event(sequenceNumber, "TaskScheduled", { ...proposal(taskId, workClass, cost), attemptId: `${taskId}:a1`, workerRole: "BUDGET_TEST_WORKER" });
const missionCreated = event(1, "MissionCreated", { totalBudget: 30, missionSeed: 0, policyVersions: { tribunal: "1" } });

describe("computed mandatory budget protection", () => {
  it("computes protection from mandatory unreserved and reserved work", () => {
    const scheduledHistory = [missionCreated, authorize(2, "required-review", "MANDATORY", 20), schedule(3, "required-review", "MANDATORY", 20)];
    const reservedHistory = [...scheduledHistory, event(4, "BudgetReserved", { attemptId: "required-review:a1", cost: 20 })];
    const startedHistory = [...reservedHistory, event(5, "TaskStarted", { attemptId: "required-review:a1", simulatedDelayMs: 0 })];

    expect(remainingMandatoryUnreservedCost(replay(scheduledHistory))).toBe(20);
    expect(protectedMandatoryBudget(replay(scheduledHistory))).toBe(20);
    expect(remainingMandatoryUnreservedCost(replay(reservedHistory))).toBe(0);
    expect(protectedMandatoryBudget(replay(reservedHistory))).toBe(20);
    expect(protectedMandatoryBudget(replay(startedHistory))).toBe(0);
  });

  it("rejects optional work that would consume the computed mandatory protection", () => {
    const history = [missionCreated, event(2, "GapOpened", { gapId: "optional-gap", researchKey: "optional-exploration", affectedDecisionType: "CONFIDENCE", reason: "Need more evidence." }), authorize(3, "optional-exploration", "OPTIONAL", 11), schedule(4, "optional-exploration", "OPTIONAL", 11), authorize(5, "required-review", "MANDATORY", 20), schedule(6, "required-review", "MANDATORY", 20)];
    const stateBeforeReservation = replay(history);
    const rejected = handleProposedEvent(history, event(7, "BudgetReserved", { attemptId: "optional-exploration:a1", cost: 11 }));

    expect(rejected.events.at(-1)?.type).toBe("TransitionRejected");
    expect(rejected.state.budget).toEqual(stateBeforeReservation.budget);
    expect(protectedMandatoryBudget(rejected.state)).toBe(20);
  });

  it("reconstructs the same protection for every valid history prefix", () => {
    const history = [missionCreated, authorize(2, "required-review", "MANDATORY", 20), schedule(3, "required-review", "MANDATORY", 20), event(4, "BudgetReserved", { attemptId: "required-review:a1", cost: 20 }), event(5, "TaskStarted", { attemptId: "required-review:a1", simulatedDelayMs: 0 }), event(6, "FindingSubmitted", { attemptId: "required-review:a1", finding: "Review completed." })];

    expect(history.map((_, index) => protectedMandatoryBudget(replay(history.slice(0, index + 1))))).toEqual([0, 0, 20, 20, 0, 0]);
  });
});
