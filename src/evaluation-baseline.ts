import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFixtureMission } from "./fixture-runner.js";
import type { MissionEvent } from "./contracts.js";

export const evaluationFixtureIds = ["crosscurrent-workspace-market", "failure-autopsy-pilot", "product-investigation-pilot"] as const;
export const evaluationConcurrencies = [1, 2, 3] as const;
export interface EvaluationSummary { fixtureId: typeof evaluationFixtureIds[number]; maxConcurrency: number; terminalStatus: string; spent: number; eventCount: number; simulatedLatencyMs: number; ranking: string[]; reviewerVerdict: string | null; }

export interface CapacityExperimentSummary {
  fixtureId: typeof evaluationFixtureIds[number];
  capacityOneLatencyMs: number;
  capacityTwoLatencyMs: number;
  capacityThreeLatencyMs: number;
  latencySavedAtCapacityTwoMs: number;
  latencySavedAtCapacityThreeMs: number;
  terminalOutcomeStable: boolean;
  qualityOutcomeStable: boolean;
  spentStable: boolean;
  eventCountStable: boolean;
  smallestCapacityAtMinimumLatency: number;
}

function replaySimulatedLatency(events: MissionEvent[], maxConcurrency: number): number {
  const dependencies = new Map<string, string[]>();
  const taskFinishes = new Map<string, number>();
  let activeFinishes: number[] = [];
  let lastFinish = 0;
  for (const event of events) {
    if (event.type === "TaskScheduled") dependencies.set(event.payload.attemptId, event.payload.dependencies);
    if (event.type !== "TaskStarted") continue;
    const taskId = event.payload.attemptId.split(":")[0]!;
    let start = Math.max(0, ...(dependencies.get(event.payload.attemptId) ?? []).map((dependency) => taskFinishes.get(dependency) ?? 0));
    while (activeFinishes.length >= maxConcurrency) {
      start = Math.max(start, Math.min(...activeFinishes));
      activeFinishes = activeFinishes.filter((finish) => finish > start);
    }
    const finish = start + event.payload.simulatedDelayMs;
    activeFinishes.push(finish);
    taskFinishes.set(taskId, finish);
    lastFinish = Math.max(lastFinish, finish);
  }
  return lastFinish;
}

export async function runEvaluationBaseline(): Promise<EvaluationSummary[]> {
  const root = await mkdtemp(join(tmpdir(), "dropscope-evaluation-"));
  const summaries: EvaluationSummary[] = [];
  for (const fixtureId of evaluationFixtureIds) for (const maxConcurrency of evaluationConcurrencies) {
    const result = await runFixtureMission({ fixtureId, missionId: `${fixtureId}-${maxConcurrency}`, historyPath: join(root, `${fixtureId}-${maxConcurrency}.jsonl`), maxConcurrency });
    const simulatedLatencyMs = replaySimulatedLatency(result.events, maxConcurrency);
    const review = result.events.find((event) => event.type === "BlindReviewCompleted");
    summaries.push({ fixtureId, maxConcurrency, terminalStatus: result.state.status, spent: result.state.budget.spent, eventCount: result.events.length, simulatedLatencyMs, ranking: result.report.ranking.map(({ candidateId }) => candidateId), reviewerVerdict: review?.type === "BlindReviewCompleted" ? review.payload.verdict : null });
  }
  return summaries;
}

export function summarizeCapacityExperiment(summaries: EvaluationSummary[]): CapacityExperimentSummary[] {
  return evaluationFixtureIds.map((fixtureId) => {
    const fixtureSummaries = summaries.filter((summary) => summary.fixtureId === fixtureId);
    if (fixtureSummaries.length !== evaluationConcurrencies.length) throw new Error(`Capacity experiment requires every configured capacity for ${fixtureId}.`);
    const byCapacity = new Map(fixtureSummaries.map((summary) => [summary.maxConcurrency, summary]));
    if (evaluationConcurrencies.some((capacity) => !byCapacity.has(capacity))) throw new Error(`Capacity experiment is missing a configured capacity for ${fixtureId}.`);
    const one = byCapacity.get(1)!;
    const two = byCapacity.get(2)!;
    const three = byCapacity.get(3)!;
    const qualityOutcomes = fixtureSummaries.map((summary) => JSON.stringify({ ranking: summary.ranking, reviewerVerdict: summary.reviewerVerdict }));
    const minimumLatency = Math.min(...fixtureSummaries.map((summary) => summary.simulatedLatencyMs));
    return {
      fixtureId,
      capacityOneLatencyMs: one.simulatedLatencyMs,
      capacityTwoLatencyMs: two.simulatedLatencyMs,
      capacityThreeLatencyMs: three.simulatedLatencyMs,
      latencySavedAtCapacityTwoMs: one.simulatedLatencyMs - two.simulatedLatencyMs,
      latencySavedAtCapacityThreeMs: one.simulatedLatencyMs - three.simulatedLatencyMs,
      terminalOutcomeStable: new Set(fixtureSummaries.map((summary) => summary.terminalStatus)).size === 1,
      qualityOutcomeStable: new Set(qualityOutcomes).size === 1,
      spentStable: new Set(fixtureSummaries.map((summary) => summary.spent)).size === 1,
      eventCountStable: new Set(fixtureSummaries.map((summary) => summary.eventCount)).size === 1,
      smallestCapacityAtMinimumLatency: fixtureSummaries.find((summary) => summary.simulatedLatencyMs === minimumLatency)!.maxConcurrency,
    };
  });
}
