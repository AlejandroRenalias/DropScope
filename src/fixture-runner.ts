import { JsonlEventStore } from "./event-store.js";
import { loadFixture } from "./fixture-model.js";
import { replay, type MissionState } from "./reducer.js";
import { runSimulatedSchedule, type ScheduleResult } from "./scheduler.js";
import type { MissionEvent } from "./contracts.js";
import { determineCandidateEligibility, type CandidateEligibility } from "./candidate-eligibility.js";

export interface FixtureRunResult {
  fixtureId: string;
  events: MissionEvent[];
  state: MissionState;
  schedule: ScheduleResult;
  candidateEligibility: CandidateEligibility[];
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
    completeMission: false,
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
  const candidateEligibility = fixture.candidateEvaluations.map(determineCandidateEligibility);
  const store = new JsonlEventStore(options.historyPath);
  const events = await store.readAll();
  const terminalEvent: MissionEvent = {
    schemaVersion: 1,
    sequenceNumber: events.length + 1,
    missionId: options.missionId,
    eventId: `${options.missionId}-${events.length + 1}`,
    timestamp: new Date().toISOString(),
    type: fixture.candidateEvaluations.length > 0 && candidateEligibility.every((candidate) => !candidate.eligible) ? "MissionTerminated" : "MissionCompleted",
    payload: fixture.candidateEvaluations.length > 0 && candidateEligibility.every((candidate) => !candidate.eligible)
      ? { status: "COMPLETED_INSUFFICIENT_EVIDENCE", reason: "No fixture candidate cleared the evidence gates." }
      : {},
  } as MissionEvent;
  await store.append(terminalEvent);
  const completedEvents = await store.readAll();
  return { fixtureId: fixture.fixtureId, events: completedEvents, state: replay(completedEvents), schedule, candidateEligibility };
}
