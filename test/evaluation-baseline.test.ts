import { describe, expect, it } from "vitest";
import { evaluationConcurrencies, evaluationFixtureIds, runEvaluationBaseline, summarizeCapacityExperiment } from "../src/evaluation-baseline.js";

describe("repeatable evaluation baseline", () => {
  it("compares every fixed mission mode at each approved concurrency", async () => {
    const results = await runEvaluationBaseline();
    const repeatedResults = await runEvaluationBaseline();

    expect(repeatedResults).toEqual(results);
    expect(results).toHaveLength(evaluationFixtureIds.length * evaluationConcurrencies.length);
    expect(results.map(({ fixtureId, maxConcurrency }) => `${fixtureId}:${maxConcurrency}`)).toEqual(evaluationFixtureIds.flatMap((fixtureId) => evaluationConcurrencies.map((maxConcurrency) => `${fixtureId}:${maxConcurrency}`)));
    expect(results.every((result) => result.simulatedLatencyMs >= 0 && result.eventCount > 0 && result.spent >= 0)).toBe(true);
    expect(results.filter((result) => result.fixtureId === "failure-autopsy-pilot").every((result) => result.terminalStatus === "COMPLETED_INSUFFICIENT_EVIDENCE" && result.reviewerVerdict === "REJECT")).toBe(true);
    expect(results.filter((result) => result.fixtureId === "product-investigation-pilot").every((result) => result.ranking.includes("modular-desk-organizer") && result.reviewerVerdict === "REVISE")).toBe(true);
  });

  it("reports capacity gains without treating capacity as a change in quality or ledger usage", async () => {
    const comparison = summarizeCapacityExperiment(await runEvaluationBaseline());

    expect(comparison).toEqual([
      {
        fixtureId: "crosscurrent-workspace-market",
        capacityOneLatencyMs: 82,
        capacityTwoLatencyMs: 66,
        capacityThreeLatencyMs: 52,
        latencySavedAtCapacityTwoMs: 16,
        latencySavedAtCapacityThreeMs: 30,
        terminalOutcomeStable: true,
        qualityOutcomeStable: true,
        spentStable: true,
        eventCountStable: true,
        smallestCapacityAtMinimumLatency: 3,
      },
      {
        fixtureId: "failure-autopsy-pilot",
        capacityOneLatencyMs: 58,
        capacityTwoLatencyMs: 58,
        capacityThreeLatencyMs: 58,
        latencySavedAtCapacityTwoMs: 0,
        latencySavedAtCapacityThreeMs: 0,
        terminalOutcomeStable: true,
        qualityOutcomeStable: true,
        spentStable: true,
        eventCountStable: true,
        smallestCapacityAtMinimumLatency: 1,
      },
      {
        fixtureId: "product-investigation-pilot",
        capacityOneLatencyMs: 74,
        capacityTwoLatencyMs: 59,
        capacityThreeLatencyMs: 59,
        latencySavedAtCapacityTwoMs: 15,
        latencySavedAtCapacityThreeMs: 15,
        terminalOutcomeStable: true,
        qualityOutcomeStable: true,
        spentStable: true,
        eventCountStable: true,
        smallestCapacityAtMinimumLatency: 2,
      },
    ]);
  });

  it("rejects an incomplete capacity experiment instead of inferring a missing result", async () => {
    const summaries = await runEvaluationBaseline();

    expect(() => summarizeCapacityExperiment(summaries.filter((summary) => !(summary.fixtureId === "product-investigation-pilot" && summary.maxConcurrency === 3)))).toThrow("Capacity experiment requires every configured capacity for product-investigation-pilot.");
    expect(() => summarizeCapacityExperiment(summaries.map((summary) => summary.fixtureId === "product-investigation-pilot" && summary.maxConcurrency === 3 ? { ...summary, maxConcurrency: 2 } : summary))).toThrow("Capacity experiment is missing a configured capacity for product-investigation-pilot.");
  });
});
