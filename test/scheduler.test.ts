import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { JsonlEventStore } from "../src/event-store.js";
import { replay } from "../src/reducer.js";
import { deriveAttemptDecision, runSimulatedSchedule } from "../src/scheduler.js";
import { RecordedWorkerAdapter } from "../src/worker-adapter.js";

describe("dependency-aware asynchronous scheduler", () => {
  it("derives decisions with explicit attempt identity", () => {
    expect(deriveAttemptDecision(3, "pulse", 1, 20)).not.toEqual(deriveAttemptDecision(3, "pulse", 2, 20));
  });
  it("runs independent tasks with real overlap", async () => {
    const result = await runSimulatedSchedule({
      missionId: "scheduler-overlap-demo",
      missionSeed: 11,
      totalBudget: 120,
      tasks: [
        { taskId: "pulse", objective: "Discover trends", cost: 10, durationMs: 30 },
        { taskId: "echo", objective: "Validate problems", cost: 10, durationMs: 30 },
      ],
    });

    const pulse = result.executionIntervals.pulse;
    const echo = result.executionIntervals.echo;

    expect(pulse.startedAt).toBeLessThan(echo.finishedAt);
    expect(echo.startedAt).toBeLessThan(pulse.finishedAt);
    expect(result.maxConcurrentAttempts).toBe(2);
  });

  it("does not start a dependent task until its prerequisite completes", async () => {
    const result = await runSimulatedSchedule({
      missionId: "scheduler-dependency-demo",
      missionSeed: 12,
      totalBudget: 120,
      tasks: [
        { taskId: "pulse", objective: "Discover trends", cost: 10, durationMs: 20 },
        { taskId: "echo", objective: "Validate problems", cost: 10, durationMs: 5, dependencies: ["pulse"] },
      ],
    });

    expect(result.executionIntervals.echo.startedAt).toBeGreaterThanOrEqual(result.executionIntervals.pulse.finishedAt);
  });

  it("rejects a cyclic dependency graph", async () => {
    await expect(runSimulatedSchedule({
      missionId: "scheduler-cycle-demo",
      missionSeed: 13,
      totalBudget: 120,
      tasks: [
        { taskId: "pulse", objective: "Discover trends", cost: 10, durationMs: 1, dependencies: ["echo"] },
        { taskId: "echo", objective: "Validate problems", cost: 10, durationMs: 1, dependencies: ["pulse"] },
      ],
    })).rejects.toThrow("Task dependency graph contains a cycle.");
  });

  it("rejects a mixed graph before any independent task can run", async () => {
    await expect(runSimulatedSchedule({
      missionId: "scheduler-mixed-cycle-demo",
      missionSeed: 14,
      totalBudget: 120,
      tasks: [
        { taskId: "independent", objective: "Independent work", cost: 10, durationMs: 1 },
        { taskId: "pulse", objective: "Discover trends", cost: 10, durationMs: 1, dependencies: ["echo"] },
        { taskId: "echo", objective: "Validate problems", cost: 10, durationMs: 1, dependencies: ["pulse"] },
      ],
    })).rejects.toThrow("Task dependency graph contains a cycle.");
  });

  it("continues unrelated eligible work after a transient failure", async () => {
    const result = await runSimulatedSchedule({
      missionId: "scheduler-failure-demo",
      missionSeed: 3,
      totalBudget: 120,
      tasks: [
        { taskId: "pulse", objective: "Discover trends", cost: 10, durationMs: 5 },
        { taskId: "echo", objective: "Validate problems", cost: 10, durationMs: 20 },
      ],
    });

    expect(result.taskOutcomes).toEqual({ pulse: "COMPLETED", echo: "COMPLETED" });
    expect(result.completionOrder).toContain("echo");
  });

  it("terminates when the one permitted transient retry is exhausted", async () => {
    const seed = Array.from({ length: 500 }, (_, value) => value).find((value) => deriveAttemptDecision(value, "retry", 1, 1).outcome === "FAILED_TRANSIENT" && deriveAttemptDecision(value, "retry", 2, 1).outcome === "FAILED_TRANSIENT");
    expect(seed).toBeDefined();
    const historyPath = join(await mkdtemp(join(tmpdir(), "dropscope-")), "retry.jsonl");
    const result = await runSimulatedSchedule({ missionId: "retry-exhaustion", missionSeed: seed!, totalBudget: 30, historyPath, tasks: [{ taskId: "retry", objective: "Retry once.", cost: 10, durationMs: 1 }] });
    const events = await new JsonlEventStore(historyPath).readAll();

    expect(result.taskOutcomes).toEqual({ retry: "FAILED_TRANSIENT" });
    expect(events.filter((event) => event.type === "TaskFailedTransient")).toHaveLength(2);
    expect(events.at(-1)).toMatchObject({ type: "MissionTerminated", payload: { status: "FAILED_UNRECOVERABLE" } });
  });

  it("uses a fixed mission seed to produce reproducible out-of-order completion", async () => {
    const options = {
      missionId: "scheduler-seed-demo",
      missionSeed: 7,
      totalBudget: 120,
      tasks: [
        { taskId: "pulse", objective: "Discover trends", cost: 10, durationMs: 20 },
        { taskId: "echo", objective: "Validate problems", cost: 10, durationMs: 20 },
      ],
    };

    const first = await runSimulatedSchedule(options);
    const second = await runSimulatedSchedule(options);

    expect(first.completionOrder).toEqual(["pulse", "echo"]);
    expect(second.completionOrder).toEqual(["pulse", "echo"]);
    expect(first.taskOutcomes).toEqual(second.taskOutcomes);
  });

  it("persists scheduler events that replay to the same task outcomes", async () => {
    const historyPath = join(await mkdtemp(join(tmpdir(), "dropscope-")), "scheduler.jsonl");
    const result = await runSimulatedSchedule({
      missionId: "scheduler-persistence-demo",
      missionSeed: 3,
      totalBudget: 120,
      historyPath,
      tasks: [
        { taskId: "pulse", objective: "Discover trends", cost: 10, durationMs: 5 },
        { taskId: "echo", objective: "Validate problems", cost: 10, durationMs: 10 },
      ],
    });

    const events = await new JsonlEventStore(historyPath).readAll();
    const replayed = replay(events);

    expect(events.map((event) => event.type)).toContain("TaskFailedTransient");
    expect(events[0].payload).toMatchObject({ missionSeed: 3 });
    expect(events.find((event) => event.type === "TaskStarted")?.payload).toMatchObject({ simulatedDelayMs: expect.any(Number) });
    expect(replayed.tasks.pulse.status).toBe("COMPLETED");
    expect(replayed.tasks.echo.status).toBe("COMPLETED");
    expect(replayed.budget.spent).toBe(30);
    expect(result.taskOutcomes).toEqual({ pulse: "COMPLETED", echo: "COMPLETED" });
  });

  it("persists dependency metadata and transition order", async () => {
    const historyPath = join(await mkdtemp(join(tmpdir(), "dropscope-")), "dependency.jsonl");
    await runSimulatedSchedule({
      missionId: "scheduler-event-order-demo",
      missionSeed: 15,
      totalBudget: 120,
      historyPath,
      tasks: [
        { taskId: "pulse", objective: "Discover trends", cost: 10, durationMs: 5 },
        { taskId: "echo", objective: "Validate problems", cost: 10, durationMs: 1, dependencies: ["pulse"] },
      ],
    });
    const events = await new JsonlEventStore(historyPath).readAll();
    const echoSchedule = events.find((event) => event.type === "TaskScheduled" && event.payload.taskId === "echo");
    const echoAuthorization = events.findIndex((event) => event.type === "TaskAuthorized" && event.payload.taskId === "echo");
    const pulseCompletion = events.findIndex((event) => event.type === "FindingSubmitted" && event.payload.attemptId === "pulse:a1");
    const echoStart = events.findIndex((event) => event.type === "TaskStarted" && event.payload.attemptId === "echo:a1");

    expect(echoSchedule?.payload).toMatchObject({ dependencies: ["pulse"] });
    expect(echoStart).toBeGreaterThan(echoAuthorization);
    expect(echoStart).toBeGreaterThan(pulseCompletion);
  });

  it("rejects unaffordable work before any task can start", async () => {
    await expect(runSimulatedSchedule({
      missionId: "scheduler-budget-demo",
      missionSeed: 16,
      totalBudget: 10,
      tasks: [
        { taskId: "pulse", objective: "Discover trends", cost: 10, durationMs: 1 },
        { taskId: "echo", objective: "Validate problems", cost: 10, durationMs: 1 },
      ],
    })).rejects.toThrow("Insufficient mission budget for scheduled task attempts.");
  });

  it("rejects concurrent tasks that claim the same research key", async () => {
    await expect(runSimulatedSchedule({
      missionId: "scheduler-duplicate-key-demo",
      missionSeed: 17,
      totalBudget: 120,
      tasks: [
        { taskId: "first", researchKey: "same-question", objective: "First answer", cost: 10, durationMs: 1 },
        { taskId: "second", researchKey: "same-question", objective: "Second answer", cost: 10, durationMs: 1 },
      ],
    })).rejects.toThrow("An active or completed task already covers this research key.");
  });

  it("persists one validated dry-run specialist finding through the runtime-owned event path", async () => {
    const historyPath = join(await mkdtemp(join(tmpdir(), "dropscope-")), "worker-adapter.jsonl");
    const seed = Array.from({ length: 500 }, (_, value) => value).find((value) => deriveAttemptDecision(value, "evidence", 1, 1).outcome === "COMPLETED");
    expect(seed).toBeDefined();

    await runSimulatedSchedule({
      missionId: "worker-adapter-demo",
      missionSeed: seed!,
      totalBudget: 20,
      historyPath,
      workerAssignment: {
        workerRole: "EVIDENCE_RESEARCHER",
        adapter: new RecordedWorkerAdapter({
          "evidence:a1": { taskId: "evidence", attemptId: "evidence:a1", status: "COMPLETED", finding: "Recorded evidence supports the workflow problem." },
        }),
      },
      tasks: [{ taskId: "evidence", objective: "Check recorded evidence.", cost: 10, durationMs: 1, workerRole: "EVIDENCE_RESEARCHER" }],
    });
    const events = await new JsonlEventStore(historyPath).readAll();

    expect(events.find((event) => event.type === "FindingSubmitted")).toMatchObject({ payload: { attemptId: "evidence:a1", finding: "Recorded evidence supports the workflow problem." } });
    expect(replay(events).tasks.evidence.status).toBe("COMPLETED");
  });

  it("records a malformed worker result as a normal transient failure before retrying", async () => {
    const historyPath = join(await mkdtemp(join(tmpdir(), "dropscope-")), "worker-adapter-retry.jsonl");
    const seed = Array.from({ length: 500 }, (_, value) => value).find((value) => deriveAttemptDecision(value, "evidence", 1, 1).outcome === "COMPLETED" && deriveAttemptDecision(value, "evidence", 2, 1).outcome === "COMPLETED");
    expect(seed).toBeDefined();

    await runSimulatedSchedule({
      missionId: "worker-adapter-retry-demo",
      missionSeed: seed!,
      totalBudget: 20,
      historyPath,
      workerAssignment: {
        workerRole: "EVIDENCE_RESEARCHER",
        adapter: new RecordedWorkerAdapter({
          "evidence:a1": { taskId: "evidence", attemptId: "evidence:a1", status: "COMPLETED", finding: "Invalid because this extra field is not accepted.", extra: true },
          "evidence:a2": { taskId: "evidence", attemptId: "evidence:a2", status: "COMPLETED", finding: "Recorded retry result passed validation." },
        }),
      },
      tasks: [{ taskId: "evidence", objective: "Check recorded evidence.", cost: 10, durationMs: 1, workerRole: "EVIDENCE_RESEARCHER" }],
    });
    const events = await new JsonlEventStore(historyPath).readAll();

    expect(events.find((event) => event.type === "TaskFailedTransient")).toMatchObject({ payload: { attemptId: "evidence:a1", reason: expect.stringContaining("Worker result rejected") } });
    expect(events.find((event) => event.type === "FindingSubmitted")).toMatchObject({ payload: { attemptId: "evidence:a2", finding: "Recorded retry result passed validation." } });
    expect(replay(events).tasks.evidence.status).toBe("COMPLETED");
  });

  it("refuses unaffordable work before a dry-run adapter can run", async () => {
    let calls = 0;
    const adapter = { run: async () => { calls += 1; return { taskId: "evidence", attemptId: "evidence:a1", status: "COMPLETED" as const, finding: "Should never run." }; } };

    await expect(runSimulatedSchedule({
      missionId: "worker-adapter-budget-demo",
      missionSeed: 1,
      totalBudget: 5,
      workerAssignment: { workerRole: "EVIDENCE_RESEARCHER", adapter },
      tasks: [{ taskId: "evidence", objective: "Check recorded evidence.", cost: 10, durationMs: 1, workerRole: "EVIDENCE_RESEARCHER" }],
    })).rejects.toThrow("Insufficient mission budget for scheduled task attempts.");

    expect(calls).toBe(0);
  });
});
