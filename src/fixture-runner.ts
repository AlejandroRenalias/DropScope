import { JsonlEventStore } from "./event-store.js";
import { loadFixture } from "./fixture-model.js";
import { replay, type MissionState } from "./reducer.js";
import { runSimulatedSchedule, type ScheduleResult } from "./scheduler.js";
import type { MissionEvent } from "./contracts.js";
import { determineCandidateEligibility, type CandidateEligibility } from "./candidate-eligibility.js";
import { evaluateRiskGate } from "./risk-policy.js";
import type { RiskGateDecision } from "./research-domain.js";
import { buildCandidateReport, type CandidateReport } from "./report.js";
import { buildFixtureQualityPipeline } from "./fixture-quality-pipeline.js";
import { RecordedWorkerAdapter } from "./worker-adapter.js";

export interface FixtureRunResult {
  fixtureId: string;
  events: MissionEvent[];
  state: MissionState;
  schedule: ScheduleResult;
  candidateEligibility: CandidateEligibility[];
  riskDecisions: RiskGateDecision[];
  report: CandidateReport;
}

export async function runFixtureMission(options: {
  fixtureId: string;
  missionId: string;
  historyPath: string;
  eventStore?: JsonlEventStore;
  maxConcurrency?: number;
  missionSeed?: number;
}): Promise<FixtureRunResult> {
  const fixture = loadFixture(options.fixtureId);
  const recordedWorkerAssignment = fixture.fixtureId === "crosscurrent-workspace-market"
    ? {
        workerRole: "EVIDENCE_RESEARCHER",
        adapter: new RecordedWorkerAdapter({
          "workflow-interviews:a2": {
            taskId: "workflow-interviews",
            attemptId: "workflow-interviews:a2",
            status: "COMPLETED" as const,
            finding: "Recorded Evidence Researcher: recurring workflow evidence supports the workspace problem.",
          },
        }),
      }
    : undefined;
  const schedule = await runSimulatedSchedule({
    missionId: options.missionId,
    missionSeed: options.missionSeed ?? fixture.seed,
    totalBudget: fixture.budget,
    historyPath: options.eventStore ? undefined : options.historyPath,
    eventStore: options.eventStore,
    maxConcurrency: options.maxConcurrency,
    completeMission: false,
    recordedWorkerAssignment,
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
  const riskDecisions = fixture.candidateEvaluations.map((candidate) => evaluateRiskGate(candidate.riskInput));
  const candidateEligibility = fixture.candidateEvaluations.map((candidate, index) => determineCandidateEligibility({ ...candidate, riskDecision: riskDecisions[index]! }));
  const report = buildCandidateReport(fixture.candidateEvaluations, riskDecisions, candidateEligibility);
  const store = options.eventStore ?? new JsonlEventStore(options.historyPath);
  const events = await store.readAll();
  const scheduledState = replay(events);
  if (scheduledState.status !== "RUNNING") {
    return { fixtureId: fixture.fixtureId, events, state: scheduledState, schedule, candidateEligibility, riskDecisions, report };
  }
  if (fixture.fixtureId === "crosscurrent-workspace-market") {
    const qualityEvents = buildFixtureQualityPipeline({ missionId: options.missionId, startingSequence: events.length, report, riskDecisions });
    for (const qualityEvent of qualityEvents) await store.append(qualityEvent);
  }
  const sequenceNumber = (await store.readAll()).length + 1;
  const terminalEvent: MissionEvent = {
    schemaVersion: 1,
    sequenceNumber,
    missionId: options.missionId,
    eventId: `${options.missionId}-${sequenceNumber}`,
    timestamp: new Date().toISOString(),
    type: report.outcome === "INSUFFICIENT_EVIDENCE" ? "MissionTerminated" : "MissionCompleted",
    payload: report.outcome === "INSUFFICIENT_EVIDENCE"
      ? { status: "COMPLETED_INSUFFICIENT_EVIDENCE", reason: "No fixture candidate cleared the evidence gates." }
      : {},
  } as MissionEvent;
  await store.append(terminalEvent);
  const completedEvents = await store.readAll();
  return { fixtureId: fixture.fixtureId, events: completedEvents, state: replay(completedEvents), schedule, candidateEligibility, riskDecisions, report };
}
