import { JsonlEventStore } from "./event-store.js";
import { loadFixture } from "./fixture-model.js";
import { replay, type MissionState } from "./reducer.js";
import { runSimulatedSchedule, type ScheduleResult } from "./scheduler.js";
import type { MissionEvent } from "./contracts.js";

export interface FixtureRunResult {
  fixtureId: string;
  events: MissionEvent[];
  state: MissionState;
  schedule: ScheduleResult;
}

export async function runFixtureMission(options: {
  fixtureId: string;
  missionId: string;
  historyPath: string;
  maxConcurrency?: number;
}): Promise<FixtureRunResult> {
  const fixture = loadFixture(options.fixtureId);
  const schedule = await runSimulatedSchedule({
    missionId: options.missionId,
    missionSeed: fixture.seed,
    totalBudget: fixture.budget,
    historyPath: options.historyPath,
    maxConcurrency: options.maxConcurrency,
    tasks: fixture.tasks.map((task) => ({
      taskId: task.id,
      objective: task.objective,
      cost: task.cost,
      durationMs: task.durationMs,
      workClass: task.workClass,
      researchKey: task.researchKey,
      dependencies: task.dependencies,
      workerRole: task.workerRole,
    })),
  });
  const events = await new JsonlEventStore(options.historyPath).readAll();
  return { fixtureId: fixture.fixtureId, events, state: replay(events), schedule };
}
