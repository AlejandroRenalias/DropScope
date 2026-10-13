import { describe, expect, it } from "vitest";
import type { MissionEvent } from "../src/contracts.js";
import { displayResearchCopy, summarizeResearchEvent } from "../src/frontend/research-presentation.js";

function makeEvent<T extends MissionEvent["type"]>(type: T, payload: Extract<MissionEvent, { type: T }>["payload"]): Extract<MissionEvent, { type: T }> {
  return { schemaVersion: 1, sequenceNumber: 1, missionId: "presentation-test", eventId: "presentation-test-1", timestamp: "2026-01-01T00:00:00.000Z", type, payload } as Extract<MissionEvent, { type: T }>;
}

describe("research presentation helpers", () => {
  it("normalizes visible copy without changing identifiers or other terms", () => {
    expect(displayResearchCopy("cross-current demand; CROSS-CURRENT risk; cross current"))
      .toBe("Crosscurrent demand; Crosscurrent risk; cross current");
  });

  it("summarizes budget reservations using only the recorded amount and attempt", () => {
    expect(summarizeResearchEvent(makeEvent("BudgetReserved", { attemptId: "pricing:a2", cost: 12 })))
      .toBe("Reserved 12 budget units · Attempt pricing:a2");
  });

  it("uses payload fields for human summaries and does not invent missing targets", () => {
    expect(summarizeResearchEvent(makeEvent("TaskAuthorized", {
      taskId: "market-check", objective: "Map the market.", cost: 9, workClass: "MANDATORY",
      researchKey: "market", authorizationReason: "MANDATORY_BASELINE", dependencies: [],
    }))).toBe("Map the market.");
    expect(summarizeResearchEvent(makeEvent("MissionCompleted", {}))).toBe("Mission completed");
  });
});
