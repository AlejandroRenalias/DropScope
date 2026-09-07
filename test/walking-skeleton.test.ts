import { describe, expect, it } from "vitest";
import { appendFile, mkdtemp, readFile, writeFile } from "node:fs/promises";
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
    expect(result.state.budget.reserved).toBe(0);
    expect(result.state.budget.spent).toBe(10);
    expect(result.state.budget.available).toBe(110);
    expect(result.events.map((event) => event.type)).toEqual([
      "MissionCreated",
      "TaskAuthorized",
      "TaskScheduled",
      "BudgetReserved",
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
      "TaskAuthorized",
      "TaskScheduled",
      "BudgetReserved",
      "TaskStarted",
      "RecoveryStarted",
      "TaskInterrupted",
      "TaskScheduled",
      "BudgetReserved",
      "TaskStarted",
      "FindingSubmitted",
      "MissionCompleted",
    ]);
    expect(result.events.slice(0, 5).map((event) => event.type)).toEqual([
      "MissionCreated",
      "TaskAuthorized",
      "TaskScheduled",
      "BudgetReserved",
      "TaskStarted",
    ]);
    expect(result.state.tasks["system-check"].status).toBe("COMPLETED");
    expect(result.state.tasks["system-check"].attemptIds).toEqual(["system-check:a1", "system-check:a2"]);
    expect(result.state.attempts["system-check:a1"].status).toBe("INTERRUPTED");
    expect(result.state.attempts["system-check:a2"].status).toBe("COMPLETED");
    expect(result.events[5]).toMatchObject({ type: "RecoveryStarted", payload: { truncatedFinalLineDiscarded: false } });
  });

  it("discards and discloses only a truncated final JSONL line during recovery", async () => {
    const historyPath = join(await mkdtemp(join(tmpdir(), "dropscope-")), "mission.jsonl");
    await beginWalkingSkeletonMission({ missionId: "truncated-tail-demo", totalBudget: 120, historyPath });
    await appendFile(historyPath, '{"schemaVersion":1,"sequenceNumber":6', "utf8");

    const result = await recoverWalkingSkeletonMission({ missionId: "truncated-tail-demo", historyPath });

    expect(result.events.map((event) => event.sequenceNumber)).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
    expect(result.events[5]).toMatchObject({ type: "RecoveryStarted", payload: { truncatedFinalLineDiscarded: true } });
    expect(await readFile(historyPath, "utf8")).not.toContain('"sequenceNumber":6{"schemaVersion"');
  });

  it("rejects malformed complete JSONL history during recovery", async () => {
    const historyPath = join(await mkdtemp(join(tmpdir(), "dropscope-")), "mission.jsonl");
    await beginWalkingSkeletonMission({ missionId: "malformed-history-demo", totalBudget: 120, historyPath });
    await appendFile(historyPath, '{"schemaVersion":1}\n', "utf8");

    await expect(recoverWalkingSkeletonMission({ missionId: "malformed-history-demo", historyPath })).rejects.toThrow();
  });

  it("preserves replay compatibility for older recovery events without a truncation disposition", async () => {
    const historyPath = join(await mkdtemp(join(tmpdir(), "dropscope-")), "mission.jsonl");
    const started = await beginWalkingSkeletonMission({ missionId: "legacy-recovery-demo", totalBudget: 120, historyPath });
    const legacyRecovery = { ...started.events[0], sequenceNumber: 6, eventId: "legacy-recovery-demo-6", type: "RecoveryStarted" as const, payload: { interruptedAttemptIds: ["system-check:a1"] } };

    const { missionEventSchema } = await import("../src/contracts.js");
    expect(missionEventSchema.parse(legacyRecovery).payload).toMatchObject({ truncatedFinalLineDiscarded: false });
  });

  it("rejects malformed final fragments even when they lack a newline", async () => {
    const historyPath = join(await mkdtemp(join(tmpdir(), "dropscope-")), "mission.jsonl");
    await beginWalkingSkeletonMission({ missionId: "malformed-tail-demo", totalBudget: 120, historyPath });
    await appendFile(historyPath, '{"schemaVersion":1,}', "utf8");

    await expect(recoverWalkingSkeletonMission({ missionId: "malformed-tail-demo", historyPath })).rejects.toThrow("malformed rather than demonstrably truncated");
  });

  it("rejects a complete final record that is merely missing its newline", async () => {
    const historyPath = join(await mkdtemp(join(tmpdir(), "dropscope-")), "mission.jsonl");
    await beginWalkingSkeletonMission({ missionId: "missing-newline-demo", totalBudget: 120, historyPath });
    const contents = await readFile(historyPath, "utf8");
    await writeFile(historyPath, contents.trimEnd(), "utf8");

    await expect(recoverWalkingSkeletonMission({ missionId: "missing-newline-demo", historyPath })).rejects.toThrow("malformed rather than demonstrably truncated");
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

  it("enforces the single mission recovery restart cap", async () => {
    const historyPath = join(await mkdtemp(join(tmpdir(), "dropscope-")), "mission.jsonl");
    const started = await beginWalkingSkeletonMission({ missionId: "recovery-cap-demo", totalBudget: 120, historyPath });
    const once = [...started.events, { ...started.events[0], sequenceNumber: 6, eventId: "recovery-cap-demo-6", type: "RecoveryStarted" as const, payload: { interruptedAttemptIds: ["system-check:a1"], truncatedFinalLineDiscarded: false } }];
    expect(() => replay([...once, { ...once[5], sequenceNumber: 7, eventId: "recovery-cap-demo-7" }])).toThrow("recovery restart cap reached");
    expect(() => replay([...started.events, { ...once[5], sequenceNumber: 6, eventId: "recovery-cap-demo-invalid", payload: { interruptedAttemptIds: ["missing"] } } as never])).toThrow("must name each current running attempt");
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
