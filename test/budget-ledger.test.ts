import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";

import { handleProposedEvent } from "../src/command-handler.js";
import type { MissionEvent } from "../src/contracts.js";
import { replay } from "../src/reducer.js";
import { runWalkingSkeletonMission } from "../src/run-mission.js";

describe("four-state budget ledger", () => {
  it("moves an attempt from available to reserved, committed, and spent", async () => {
    const result = await runWalkingSkeletonMission({
      missionId: "budget-ledger-demo",
      totalBudget: 120,
      historyPath: join(await mkdtemp(join(tmpdir(), "dropscope-")), "mission.jsonl"),
    });

    expect(replay(result.events.slice(0, 4)).budget).toEqual({ total: 120, reserved: 10, committed: 0, spent: 0, available: 110 });
    expect(replay(result.events.slice(0, 5)).budget).toEqual({ total: 120, reserved: 0, committed: 10, spent: 0, available: 110 });
    expect(result.state.budget).toEqual({ total: 120, reserved: 0, committed: 0, spent: 10, available: 110 });
  });

  it("rejects reserving an already reserved attempt without changing the ledger", async () => {
    const result = await runWalkingSkeletonMission({
      missionId: "duplicate-reservation-demo",
      totalBudget: 120,
      historyPath: join(await mkdtemp(join(tmpdir(), "dropscope-")), "mission.jsonl"),
    });
    const stateBeforeDuplicate = replay(result.events.slice(0, 4));
    const duplicateReservation = {
      ...result.events[3],
      sequenceNumber: 5,
      eventId: "duplicate-reservation-demo-5",
    };

    const rejected = handleProposedEvent(result.events.slice(0, 4), duplicateReservation);

    expect(rejected.events.at(-1)?.type).toBe("TransitionRejected");
    expect(rejected.state.budget).toEqual(stateBeforeDuplicate.budget);
    expect(rejected.state.rejections).toEqual([
      { attemptedEventType: "BudgetReserved", reason: "Only a scheduled attempt can reserve its exact cost." },
    ]);
  });

  it("rejects an unaffordable reservation without changing the ledger", async () => {
    const result = await runWalkingSkeletonMission({
      missionId: "unaffordable-reservation-demo",
      totalBudget: 120,
      historyPath: join(await mkdtemp(join(tmpdir(), "dropscope-")), "mission.jsonl"),
    });
    const initialReservationHistory = result.events.slice(0, 4);
    const unaffordableAuthorization: MissionEvent = {
      schemaVersion: 1, sequenceNumber: 5, missionId: "unaffordable-reservation-demo", eventId: "unaffordable-reservation-demo-5", timestamp: "2026-08-28T00:00:05.000Z", type: "TaskAuthorized",
      payload: { taskId: "too-expensive", objective: "Exceed the remaining budget", cost: 111, workClass: "MANDATORY", researchKey: "too-expensive", authorizationReason: "MANDATORY_BASELINE", dependencies: [] },
    };
    const unaffordableSchedule: MissionEvent = {
      schemaVersion: 1,
      sequenceNumber: 6,
      missionId: "unaffordable-reservation-demo",
      eventId: "unaffordable-reservation-demo-6",
      timestamp: "2026-08-28T00:00:06.000Z",
      type: "TaskScheduled",
      payload: { taskId: "too-expensive", attemptId: "too-expensive:a1", objective: "Exceed the remaining budget", cost: 111, workClass: "MANDATORY", researchKey: "too-expensive", dependencies: [] },
    };
    const unaffordableReservation: MissionEvent = {
      schemaVersion: 1,
      sequenceNumber: 7,
      missionId: "unaffordable-reservation-demo",
      eventId: "unaffordable-reservation-demo-7",
      timestamp: "2026-08-28T00:00:07.000Z",
      type: "BudgetReserved",
      payload: { attemptId: "too-expensive:a1", cost: 111 },
    };
    const historyBeforeReservation = [...initialReservationHistory, unaffordableAuthorization, unaffordableSchedule];
    const stateBeforeReservation = replay(historyBeforeReservation);

    const rejected = handleProposedEvent(historyBeforeReservation, unaffordableReservation);

    expect(rejected.events.at(-1)?.type).toBe("TransitionRejected");
    expect(rejected.state.budget).toEqual(stateBeforeReservation.budget);
    expect(rejected.state.rejections).toEqual([
      { attemptedEventType: "BudgetReserved", reason: "Insufficient available budget." },
    ]);
  });

  it("maintains the ledger invariant after every valid event prefix", async () => {
    const result = await runWalkingSkeletonMission({
      missionId: "budget-prefix-demo",
      totalBudget: 120,
      historyPath: join(await mkdtemp(join(tmpdir(), "dropscope-")), "mission.jsonl"),
    });

    result.events.forEach((_, index) => {
      const budget = replay(result.events.slice(0, index + 1)).budget;
      expect(budget.available).toBe(budget.total - budget.reserved - budget.committed - budget.spent);
    });
  });
});
