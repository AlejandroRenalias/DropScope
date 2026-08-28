import { describe, expect, it } from "vitest";

import { handleProposedEvent } from "../src/command-handler.js";
import type { MissionEvent } from "../src/contracts.js";
import { protectedMandatoryBudget, remainingMandatoryUnreservedCost, replay } from "../src/reducer.js";

const event = (sequenceNumber: number, type: MissionEvent["type"], payload: MissionEvent["payload"]): MissionEvent => ({
  schemaVersion: 1,
  sequenceNumber,
  missionId: "mandatory-protection-demo",
  eventId: `mandatory-protection-demo-${sequenceNumber}`,
  timestamp: `2026-08-28T00:00:0${sequenceNumber}.000Z`,
  type,
  payload,
} as MissionEvent);

const missionCreated = event(1, "MissionCreated", { totalBudget: 30, missionSeed: 0 });
const mandatoryScheduled = event(2, "TaskScheduled", {
  taskId: "required-review",
  attemptId: "required-review:a1",
  objective: "Complete the required review.",
  cost: 20,
  workClass: "MANDATORY",
  dependencies: [],
});

describe("computed mandatory budget protection", () => {
  it("computes protection from mandatory unreserved and reserved work", () => {
    const scheduled = replay([missionCreated, mandatoryScheduled]);
    const reserved = replay([
      missionCreated,
      mandatoryScheduled,
      event(3, "BudgetReserved", { attemptId: "required-review:a1", cost: 20 }),
    ]);
    const started = replay([
      missionCreated,
      mandatoryScheduled,
      event(3, "BudgetReserved", { attemptId: "required-review:a1", cost: 20 }),
      event(4, "TaskStarted", { attemptId: "required-review:a1", simulatedDelayMs: 0 }),
    ]);

    expect(remainingMandatoryUnreservedCost(scheduled)).toBe(20);
    expect(protectedMandatoryBudget(scheduled)).toBe(20);
    expect(remainingMandatoryUnreservedCost(reserved)).toBe(0);
    expect(protectedMandatoryBudget(reserved)).toBe(20);
    expect(protectedMandatoryBudget(started)).toBe(0);
  });

  it("rejects optional work that would consume the computed mandatory protection", () => {
    const optionalScheduled = event(3, "TaskScheduled", {
      taskId: "optional-exploration",
      attemptId: "optional-exploration:a1",
      objective: "Explore an optional lead.",
      cost: 11,
      workClass: "OPTIONAL",
      dependencies: [],
    });
    const optionalBeforeMandatory = { ...optionalScheduled, sequenceNumber: 2, eventId: "mandatory-protection-demo-2" } as MissionEvent;
    const mandatoryAfterOptional = { ...mandatoryScheduled, sequenceNumber: 3, eventId: "mandatory-protection-demo-3" } as MissionEvent;
    const history = [missionCreated, optionalBeforeMandatory, mandatoryAfterOptional];
    const stateBeforeReservation = replay(history);
    const rejected = handleProposedEvent(
      history,
      event(4, "BudgetReserved", { attemptId: "optional-exploration:a1", cost: 11 }),
    );

    expect(rejected.events.at(-1)?.type).toBe("TransitionRejected");
    expect(rejected.state.budget).toEqual(stateBeforeReservation.budget);
    expect(protectedMandatoryBudget(rejected.state)).toBe(20);
    expect(rejected.state.rejections).toEqual([
      { attemptedEventType: "BudgetReserved", reason: "Optional work would consume mandatory budget protection." },
    ]);
  });

  it("reconstructs the same protection for every valid history prefix", () => {
    const history = [
      missionCreated,
      mandatoryScheduled,
      event(3, "BudgetReserved", { attemptId: "required-review:a1", cost: 20 }),
      event(4, "TaskStarted", { attemptId: "required-review:a1", simulatedDelayMs: 0 }),
      event(5, "FindingSubmitted", { attemptId: "required-review:a1", finding: "Review completed." }),
    ];

    expect(history.map((_, index) => protectedMandatoryBudget(replay(history.slice(0, index + 1))))).toEqual([0, 20, 20, 0, 0]);
  });
});
