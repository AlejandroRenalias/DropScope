import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { beginWalkingSkeletonMission, recoverWalkingSkeletonMission, runWalkingSkeletonMission } from "../src/run-mission.js";
import { replay } from "../src/reducer.js";

describe("Milestone 1A.0 walking skeleton", () => {
  it("records one completed task and a completed mission", async () => {
    const result = await runWalkingSkeletonMission({
      missionId: "walking-skeleton-demo",
      totalBudget: 120,
      historyPath: join(await mkdtemp(join(tmpdir(), "dropscope-")), "mission.jsonl"),
    });

    expect(result.state.status).toBe("COMPLETED");
    expect(result.state.budget.spent).toBe(10);
    expect(result.state.budget.available).toBe(110);
    expect(result.events.map((event) => event.type)).toEqual([
      "MissionCreated",
      "TaskScheduled",
      "TaskStarted",
      "FindingSubmitted",
      "MissionCompleted",
    ]);
  });

  it("recovers an interrupted task by appending recovery events without rewriting history", async () => {
    const historyPath = join(await mkdtemp(join(tmpdir(), "dropscope-")), "mission.jsonl");
    await beginWalkingSkeletonMission({ missionId: "recovery-demo", totalBudget: 120, historyPath });

    const result = await recoverWalkingSkeletonMission({ missionId: "recovery-demo", historyPath });

    expect(result.state.status).toBe("COMPLETED");
    expect(result.state.budget.spent).toBe(20); // Interrupted work remains charged; the recovery attempt costs 10 more.
    expect(result.events.map((event) => event.type)).toEqual([
      "MissionCreated",
      "TaskScheduled",
      "TaskStarted",
      "RecoveryStarted",
      "TaskInterrupted",
      "TaskScheduled",
      "TaskStarted",
      "FindingSubmitted",
      "MissionCompleted",
    ]);
    expect(result.events.slice(0, 3).map((event) => event.type)).toEqual([
      "MissionCreated",
      "TaskScheduled",
      "TaskStarted",
    ]);
    expect(result.state.tasks["system-check"].status).toBe("COMPLETED");
    expect(result.state.tasks["system-check"].attemptIds).toEqual(["system-check:a1", "system-check:a2"]);
    expect(result.state.attempts["system-check:a1"].status).toBe("INTERRUPTED");
    expect(result.state.attempts["system-check:a2"].status).toBe("COMPLETED");
  });

  it("rejects a history with a skipped sequence number", async () => {
    const result = await runWalkingSkeletonMission({
      missionId: "sequence-check-demo",
      totalBudget: 120,
      historyPath: join(await mkdtemp(join(tmpdir(), "dropscope-")), "mission.jsonl"),
    });
    const corruptedHistory = result.events.map((event) => ({ ...event }));
    corruptedHistory[2] = { ...corruptedHistory[2], sequenceNumber: 5 };

    expect(() => replay(corruptedHistory)).toThrow("Expected sequence number 3, received 5.");
  });

  it("replays every valid event-history prefix", async () => {
    const result = await runWalkingSkeletonMission({
      missionId: "prefix-replay-demo",
      totalBudget: 120,
      historyPath: join(await mkdtemp(join(tmpdir(), "dropscope-")), "mission.jsonl"),
    });

    result.events.forEach((_, index) => {
      const stateAfterPrefix = replay(result.events.slice(0, index + 1));
      expect(stateAfterPrefix.lastSequenceNumber).toBe(index + 1);
    });
  });
});
