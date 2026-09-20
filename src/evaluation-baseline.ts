import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFixtureMission } from "./fixture-runner.js";
import type { MissionEvent } from "./contracts.js";

export const evaluationFixtureIds = ["crosscurrent-workspace-market", "failure-autopsy-pilot", "product-investigation-pilot"] as const;
export const evaluationConcurrencies = [1, 2, 3] as const;
export interface EvaluationSummary { fixtureId: typeof evaluationFixtureIds[number]; maxConcurrency: number; terminalStatus: string; spent: number; eventCount: number; simulatedLatencyMs: number; ranking: string[]; reviewerVerdict: string | null; }

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
