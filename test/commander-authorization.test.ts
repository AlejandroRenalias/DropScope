import { describe, expect, it } from "vitest";

import { handleProposedEvent } from "../src/command-handler.js";
import type { MissionEvent, WorkClass } from "../src/contracts.js";
import { replay } from "../src/reducer.js";

const event = (sequenceNumber: number, type: MissionEvent["type"], payload: MissionEvent["payload"]): MissionEvent => ({
  schemaVersion: 1, sequenceNumber, missionId: "commander-demo", eventId: `commander-demo-${sequenceNumber}`,
  timestamp: `2026-08-28T00:01:${String(sequenceNumber).padStart(2, "0")}.000Z`, type, payload,
} as MissionEvent);
const proposal = (taskId: string, workClass: WorkClass, dependencies: string[] = []) => ({
  taskId, objective: `${taskId} objective.`, cost: 10, workClass, researchKey: taskId,
  authorizationReason: workClass === "MANDATORY" ? "MANDATORY_BASELINE" as const : "GAP_RESOLUTION" as const,
  dependencies,
});
const mission = event(1, "MissionCreated", { totalBudget: 120, missionSeed: 0, policyVersions: { tribunal: "1" } });

describe("deterministic Commander authorization", () => {
  it("requires a recorded authorization before scheduling without mutating mission work or budget", () => {
    const unsanctionedSchedule = event(2, "TaskScheduled", { ...proposal("unsanctioned", "MANDATORY"), attemptId: "unsanctioned:a1", workerRole: "COMMANDER_TEST_WORKER" });
    const result = handleProposedEvent([mission], unsanctionedSchedule);

    expect(result.events.at(-1)?.type).toBe("TransitionRejected");
    expect(result.state.tasks).toEqual({});
    expect(result.state.budget.available).toBe(120);
    expect(result.state.rejections).toEqual([{ attemptedEventType: "TaskScheduled", reason: "Task requires Commander authorization before scheduling." }]);
  });

  it("records an allowed mandatory authorization that replay permits to schedule", () => {
    const authorized = event(2, "TaskAuthorized", proposal("baseline-check", "MANDATORY"));
    const scheduled = event(3, "TaskScheduled", { ...proposal("baseline-check", "MANDATORY"), attemptId: "baseline-check:a1", workerRole: "COMMANDER_TEST_WORKER" });
    const state = replay([mission, authorized, scheduled]);

    expect(state.authorizations["baseline-check"]).toMatchObject({ authorizationReason: "MANDATORY_BASELINE", researchKey: "baseline-check" });
    expect(state.tasks["baseline-check"].status).toBe("SCHEDULED");
  });

  it("rejects authorization when dependencies are incomplete or an optional task lacks a gap reason", () => {
    const dependencyBlocked = handleProposedEvent([mission], event(2, "TaskAuthorized", proposal("dependent", "MANDATORY", ["missing-prerequisite"])));
    const invalidOptional = event(2, "TaskAuthorized", { ...proposal("optional", "OPTIONAL"), authorizationReason: "MANDATORY_BASELINE" });
    const reasonBlocked = handleProposedEvent([mission], invalidOptional);

    expect(dependencyBlocked.state.rejections[0]?.reason).toBe("All task dependencies must be completed before authorization.");
    expect(reasonBlocked.state.rejections[0]?.reason).toBe("Optional work requires a gap-resolution authorization.");
  });

  it("rejects a task that duplicates an active research key", () => {
    const firstAuthorization = event(2, "TaskAuthorized", proposal("first-check", "MANDATORY"));
    const firstSchedule = event(3, "TaskScheduled", { ...proposal("first-check", "MANDATORY"), attemptId: "first-check:a1", workerRole: "COMMANDER_TEST_WORKER" });
    const duplicate = event(4, "TaskAuthorized", { ...proposal("duplicate-check", "MANDATORY"), researchKey: "first-check" });
    const result = handleProposedEvent([mission, firstAuthorization, firstSchedule], duplicate);

    expect(result.state.rejections[0]?.reason).toBe("An active or completed task already covers this research key.");
  });

  it("rejects new authorization after a terminal mission", () => {
    const completed = replay([mission, event(2, "MissionCompleted", {})]);
    const result = handleProposedEvent([mission, event(2, "MissionCompleted", {})], event(3, "TaskAuthorized", proposal("late", "MANDATORY")));

    expect(completed.status).toBe("COMPLETED");
    expect(result.state.rejections[0]?.reason).toBe("Cannot authorize work for a non-running mission.");
  });
});
