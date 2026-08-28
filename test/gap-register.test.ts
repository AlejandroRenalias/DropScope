import { describe, expect, it } from "vitest";
import { handleProposedEvent } from "../src/command-handler.js";
import type { MissionEvent } from "../src/contracts.js";
import { replay } from "../src/reducer.js";

const event = (sequenceNumber: number, type: MissionEvent["type"], payload: MissionEvent["payload"]): MissionEvent => ({ schemaVersion: 1, sequenceNumber, missionId: "gap-demo", eventId: `gap-demo-${sequenceNumber}`, timestamp: `2026-08-28T00:02:${String(sequenceNumber).padStart(2, "0")}.000Z`, type, payload } as MissionEvent);
const mission = event(1, "MissionCreated", { totalBudget: 120, missionSeed: 0 });
const openGap = event(2, "GapOpened", { gapId: "gap-1", researchKey: "pricing-risk", affectedDecisionType: "SAFETY_OR_RISK", reason: "Need evidence." });
const optionalAuthorization = (sequenceNumber: number, gapId?: string) => event(sequenceNumber, "TaskAuthorized", { taskId: "pricing-check", objective: "Check pricing risk.", cost: 10, workClass: "OPTIONAL", researchKey: "pricing-risk", gapId, authorizationReason: "GAP_RESOLUTION", dependencies: [] });

describe("authoritative gap register", () => {
  it("persists opening, resolution, and reopening through replay", () => {
    const state = replay([mission, openGap, event(3, "GapResolved", { gapId: "gap-1", reason: "Resolved." }), event(4, "GapReopened", { gapId: "gap-1", reason: "Evidence changed." })]);
    expect(state.gaps["gap-1"]).toMatchObject({ researchKey: "pricing-risk", status: "REOPENED" });
  });
  it("allows optional authorization only for a matching actionable gap", () => {
    const allowed = replay([mission, openGap, optionalAuthorization(3, "gap-1")]);
    const rejected = handleProposedEvent([mission], optionalAuthorization(2));
    expect(allowed.authorizations["pricing-check"].gapId).toBe("gap-1");
    expect(rejected.state.rejections[0]?.reason).toBe("Gap-resolution work requires a matching actionable gap.");
  });
});
