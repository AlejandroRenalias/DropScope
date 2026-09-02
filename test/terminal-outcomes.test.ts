import { describe, expect, it } from "vitest";
import { handleProposedEvent } from "../src/command-handler.js";
import type { MissionEvent } from "../src/contracts.js";
import { replay } from "../src/reducer.js";

const event = <T extends MissionEvent["type"]>(sequenceNumber: number, type: T, payload: Extract<MissionEvent, { type: T }>["payload"]): Extract<MissionEvent, { type: T }> => ({
  schemaVersion: 1, sequenceNumber, missionId: "terminal-demo", eventId: `terminal-demo-${sequenceNumber}`,
  timestamp: `2026-09-02T00:00:${String(sequenceNumber).padStart(2, "0")}.000Z`, type, payload,
} as Extract<MissionEvent, { type: T }>);

const mission = event(1, "MissionCreated", { totalBudget: 120, missionSeed: 0, policyVersions: { tribunal: "1" } });

describe("terminal mission outcomes", () => {
  it("records a completed-insufficient-evidence outcome only after work is settled", () => {
    const authorized = event(2, "TaskAuthorized", { taskId: "research", objective: "Research the question.", cost: 10, workClass: "MANDATORY", researchKey: "research", authorizationReason: "MANDATORY_BASELINE", dependencies: [] });
    const scheduled = event(3, "TaskScheduled", { ...authorized.payload, attemptId: "research:a1", workerRole: "TEST_WORKER" });
    const reserved = event(4, "BudgetReserved", { attemptId: "research:a1", cost: 10 });
    const started = event(5, "TaskStarted", { attemptId: "research:a1", simulatedDelayMs: 0 });
    const finding = event(6, "FindingSubmitted", { attemptId: "research:a1", finding: "No candidate clears the gates." });
    const terminated = replay([mission, authorized, scheduled, reserved, started, finding, event(7, "MissionTerminated", { status: "COMPLETED_INSUFFICIENT_EVIDENCE", reason: "No candidate cleared the evidence gates." })]);

    expect(terminated.status).toBe("COMPLETED_INSUFFICIENT_EVIDENCE");
    expect(terminated.budget).toEqual({ total: 120, reserved: 0, committed: 0, spent: 10, available: 110 });
  });

  it("rejects insufficient-evidence termination while a task or actionable gap remains", () => {
    const authorized = event(2, "TaskAuthorized", { taskId: "research", objective: "Research the question.", cost: 10, workClass: "MANDATORY", researchKey: "research", authorizationReason: "MANDATORY_BASELINE", dependencies: [] });
    const scheduled = event(3, "TaskScheduled", { ...authorized.payload, attemptId: "research:a1", workerRole: "TEST_WORKER" });
    const termination = event(4, "MissionTerminated", { status: "COMPLETED_INSUFFICIENT_EVIDENCE", reason: "No candidate cleared the evidence gates." });
    const gap = event(2, "GapOpened", { gapId: "gap", researchKey: "missing-evidence", affectedDecisionType: "ELIGIBILITY", reason: "Evidence is missing." });

    expect(() => replay([mission, event(2, "MissionTerminated", termination.payload)])).toThrow("completed baseline research");
    expect(() => replay([mission, authorized, scheduled, termination])).toThrow("completed baseline research");
    const reserved = event(4, "BudgetReserved", { attemptId: "research:a1", cost: 10 });
    const started = event(5, "TaskStarted", { attemptId: "research:a1", simulatedDelayMs: 0 });
    const finding = event(6, "FindingSubmitted", { attemptId: "research:a1", finding: "No candidate clears the gates." });
    const actionableGap = event(7, "GapOpened", gap.payload);
    expect(() => replay([mission, authorized, scheduled, reserved, started, finding, actionableGap, event(8, "MissionTerminated", termination.payload)])).toThrow("actionable gaps");
  });

  it("makes every terminal outcome reject later authority", () => {
    const gap = event(2, "GapOpened", { gapId: "gap", researchKey: "missing-evidence", affectedDecisionType: "ELIGIBILITY", reason: "Evidence is missing." });
    const history = [mission, gap, event(3, "MissionTerminated", { status: "BLOCKED_POLICY", reason: "A mission-wide policy blocks a report." })];
    const result = handleProposedEvent(history, event(4, "TaskAuthorized", { taskId: "late", objective: "Late work.", cost: 10, workClass: "MANDATORY", researchKey: "late", authorizationReason: "MANDATORY_BASELINE", dependencies: [] }));
    const gapResult = handleProposedEvent(history, event(4, "GapResolved", { gapId: "gap", reason: "Too late." }));

    expect(result.events.at(-1)?.type).toBe("TransitionRejected");
    expect(result.state.status).toBe("BLOCKED_POLICY");
    expect(gapResult.events.at(-1)?.type).toBe("TransitionRejected");
    expect(gapResult.state.gaps.gap?.status).toBe("OPEN");
    expect(() => replay([...history, event(4, "MissionCompleted", {})])).toThrow("Only a running mission can finish");
  });
});
