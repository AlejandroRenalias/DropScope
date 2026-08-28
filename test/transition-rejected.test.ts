import { describe, expect, it } from "vitest";

import type { MissionEvent } from "../src/contracts.js";
import { handleProposedEvent } from "../src/command-handler.js";

const missionCreated: MissionEvent = {
  schemaVersion: 1,
  sequenceNumber: 1,
  missionId: "rejection-demo",
  eventId: "rejection-demo-1",
  timestamp: "2026-08-28T00:00:00.000Z",
  type: "MissionCreated",
  payload: { totalBudget: 120, missionSeed: 0 },
};

describe("illegal transition handling", () => {
  it("records an illegal task start without mutating mission work or budget", () => {
    const invalidStart: MissionEvent = {
      schemaVersion: 1,
      sequenceNumber: 2,
      missionId: "rejection-demo",
      eventId: "rejection-demo-2",
      timestamp: "2026-08-28T00:00:01.000Z",
      type: "TaskStarted",
      payload: { attemptId: "not-scheduled:a1", simulatedDelayMs: 0 },
    };

    const result = handleProposedEvent([missionCreated], invalidStart);

    expect(result.events.map((event) => event.type)).toEqual(["MissionCreated", "TransitionRejected"]);
    expect(result.state.budget).toEqual({ total: 120, reserved: 0, committed: 0, spent: 0, available: 120 });
    expect(result.state.tasks).toEqual({});
    expect(result.state.rejections).toEqual([
      { attemptedEventType: "TaskStarted", reason: "Only a scheduled attempt can start." },
    ]);
  });
});
