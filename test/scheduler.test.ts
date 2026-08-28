import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { JsonlEventStore } from "../src/event-store.js";
import { replay } from "../src/reducer.js";
import { runSimulatedSchedule } from "../src/scheduler.js";

describe("dependency-aware asynchronous scheduler", () => {
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

    expect(result.taskOutcomes).toEqual({ pulse: "FAILED_TRANSIENT", echo: "COMPLETED" });
    expect(result.executionIntervals.echo.finishedAt).toBeGreaterThan(result.executionIntervals.pulse.finishedAt);
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

    expect(first.completionOrder).toEqual(["echo", "pulse"]);
    expect(second.completionOrder).toEqual(["echo", "pulse"]);
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
    expect(replayed.tasks.pulse.status).toBe("FAILED_TRANSIENT");
    expect(replayed.tasks.echo.status).toBe("COMPLETED");
    expect(replayed.budget.spent).toBe(20);
    expect(result.taskOutcomes).toEqual({ pulse: "FAILED_TRANSIENT", echo: "COMPLETED" });
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
    const pulseCompletion = events.findIndex((event) => event.type === "FindingSubmitted" && event.payload.attemptId === "pulse:a1");
    const echoStart = events.findIndex((event) => event.type === "TaskStarted" && event.payload.attemptId === "echo:a1");

    expect(echoSchedule?.payload).toMatchObject({ dependencies: ["pulse"] });
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
});
