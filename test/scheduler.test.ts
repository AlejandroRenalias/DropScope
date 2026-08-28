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
      totalBudget: 120,
      tasks: [
        { taskId: "pulse", objective: "Discover trends", cost: 10, durationMs: 1, dependencies: ["echo"] },
        { taskId: "echo", objective: "Validate problems", cost: 10, durationMs: 1, dependencies: ["pulse"] },
      ],
    })).rejects.toThrow("No eligible task remains; dependencies are missing or cyclic.");
  });

  it("continues unrelated eligible work after a transient failure", async () => {
    const result = await runSimulatedSchedule({
      missionId: "scheduler-failure-demo",
      totalBudget: 120,
      tasks: [
        { taskId: "pulse", objective: "Discover trends", cost: 10, durationMs: 5, outcome: "TRANSIENT_FAILURE" },
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
  });

  it("persists scheduler events that replay to the same task outcomes", async () => {
    const historyPath = join(await mkdtemp(join(tmpdir(), "dropscope-")), "scheduler.jsonl");
    const result = await runSimulatedSchedule({
      missionId: "scheduler-persistence-demo",
      missionSeed: 17,
      totalBudget: 120,
      historyPath,
      tasks: [
        { taskId: "pulse", objective: "Discover trends", cost: 10, durationMs: 5, outcome: "TRANSIENT_FAILURE" },
        { taskId: "echo", objective: "Validate problems", cost: 10, durationMs: 10 },
      ],
    });

    const events = await new JsonlEventStore(historyPath).readAll();
    const replayed = replay(events);

    expect(events.map((event) => event.type)).toContain("TaskFailedTransient");
    expect(events[0].payload).toMatchObject({ missionSeed: 17 });
    expect(replayed.tasks.pulse.status).toBe("FAILED_TRANSIENT");
    expect(replayed.tasks.echo.status).toBe("COMPLETED");
    expect(replayed.budget.spent).toBe(20);
    expect(result.taskOutcomes).toEqual({ pulse: "FAILED_TRANSIENT", echo: "COMPLETED" });
  });
});
