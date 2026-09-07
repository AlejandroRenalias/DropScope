import { describe, expect, it } from "vitest";

import type { MissionEvent } from "../src/contracts.js";
import { formatMissionSummary } from "../src/mission-summary.js";
import { replay } from "../src/reducer.js";

const event = <T extends MissionEvent["type"]>(sequenceNumber: number, type: T, payload: Extract<MissionEvent, { type: T }>["payload"]): Extract<MissionEvent, { type: T }> => ({
  schemaVersion: 1,
  sequenceNumber,
  missionId: "summary-test",
  eventId: `summary-test-${sequenceNumber}`,
  timestamp: "2026-01-01T00:00:00.000Z",
  type,
  payload,
} as Extract<MissionEvent, { type: T }>);

describe("formatMissionSummary", () => {
  it("reports the terminal state, complete ledger, no gaps, and event sequence", () => {
    const events = [
      event(1, "MissionCreated", { totalBudget: 20, missionSeed: 1, policyVersions: { tribunal: "1" } }),
      event(2, "MissionCompleted", {}),
    ];
    const output = formatMissionSummary(replay(events), events);
    expect(output).toContain("Mission: COMPLETED");
    expect(output).toContain("Budget: 20 total, 0 reserved, 0 committed, 0 spent, 20 available");
    expect(output).toContain("Unresolved gaps: none");
    expect(output).toContain("1: MissionCreated\n  2: MissionCompleted");
  });

  it("lists open and reopened gaps for a blocked mission", () => {
    const events = [
      event(1, "MissionCreated", { totalBudget: 20, missionSeed: 1 }),
      event(2, "GapOpened", { gapId: "gap-open", researchKey: "key-open", affectedDecisionType: "ELIGIBILITY", reason: "missing" }),
      event(3, "GapOpened", { gapId: "gap-reopened", researchKey: "key-reopened", affectedDecisionType: "CONFIDENCE", reason: "uncertain" }),
      event(4, "GapResolved", { gapId: "gap-reopened", reason: "temporarily addressed" }),
      event(5, "GapReopened", { gapId: "gap-reopened", reason: "new conflict" }),
      event(6, "MissionTerminated", { status: "BLOCKED_POLICY", reason: "unresolved evidence" }),
    ];
    const output = formatMissionSummary(replay(events), events);
    expect(output).toContain("Mission: BLOCKED_POLICY");
    expect(output).toContain("Unresolved gaps: gap-open (OPEN), gap-reopened (REOPENED)");
    expect(output).toContain("6: MissionTerminated");
  });
});
