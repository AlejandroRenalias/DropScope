import { describe, expect, it } from "vitest";
import { evaluationConcurrencies, evaluationFixtureIds, recommendDefaultTaskCapacity, runEvaluationBaseline, summarizeCapacityExperiment } from "../src/evaluation-baseline.js";

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
    // Runs the whole evaluation twice, so it sits near the 5 s default and timed out under load in a full run.
  }, 30_000);

  it("reports capacity gains without treating capacity as a change in quality or ledger usage", async () => {
    const comparison = summarizeCapacityExperiment(await runEvaluationBaseline());

    expect(comparison).toEqual([
      {
        fixtureId: "crosscurrent-workspace-market",
        capacityOneLatencyMs: 82,
        capacityTwoLatencyMs: 68,
        capacityThreeLatencyMs: 68,
        latencySavedAtCapacityTwoMs: 14,
        latencySavedAtCapacityThreeMs: 14,
        ledgerSpent: 130,
        terminalOutcomeStable: true,
        qualityOutcomeStable: true,
        spentStable: true,
        eventCountStable: true,
        smallestCapacityAtMinimumLatency: 2,
      },
      {
        fixtureId: "failure-autopsy-pilot",
        capacityOneLatencyMs: 58,
        capacityTwoLatencyMs: 58,
        capacityThreeLatencyMs: 58,
        latencySavedAtCapacityTwoMs: 0,
        latencySavedAtCapacityThreeMs: 0,
        ledgerSpent: 60,
        terminalOutcomeStable: true,
        qualityOutcomeStable: true,
        spentStable: true,
        eventCountStable: true,
        smallestCapacityAtMinimumLatency: 1,
      },
      {
        fixtureId: "product-investigation-pilot",
        capacityOneLatencyMs: 74,
        capacityTwoLatencyMs: 74,
        capacityThreeLatencyMs: 74,
        latencySavedAtCapacityTwoMs: 0,
        latencySavedAtCapacityThreeMs: 0,
        ledgerSpent: 80,
        terminalOutcomeStable: true,
        qualityOutcomeStable: true,
        spentStable: true,
        eventCountStable: true,
        smallestCapacityAtMinimumLatency: 1,
      },
    ]);
  });

  it("rejects an incomplete capacity experiment instead of inferring a missing result", async () => {
    const summaries = await runEvaluationBaseline();

    expect(() => summarizeCapacityExperiment(summaries.filter((summary) => !(summary.fixtureId === "product-investigation-pilot" && summary.maxConcurrency === 3)))).toThrow("Capacity experiment requires every configured capacity for product-investigation-pilot.");
    expect(() => summarizeCapacityExperiment(summaries.map((summary) => summary.fixtureId === "product-investigation-pilot" && summary.maxConcurrency === 3 ? { ...summary, maxConcurrency: 2 } : summary))).toThrow("Capacity experiment is missing a configured capacity for product-investigation-pilot.");
  });

  it("recommends the smallest capacity that reaches every fixture minimum without changing quality or usage", async () => {
    const comparison = summarizeCapacityExperiment(await runEvaluationBaseline());

    expect(recommendDefaultTaskCapacity(comparison)).toEqual({
      recommendationStatus: "SUPPORTED",
      suggestedTaskCapacity: 2,
      qualityAndUsageStable: true,
      rationale: "Capacity 2 reaches every fixed fixture's minimum logical latency without changing terminal outcome, quality signals, ledger spend, or event count.",
    });
    expect(recommendDefaultTaskCapacity(comparison.map((summary, index) => index === 0 ? { ...summary, qualityOutcomeStable: false } : summary))).toMatchObject({
      recommendationStatus: "INCONCLUSIVE",
      suggestedTaskCapacity: null,
      qualityAndUsageStable: false,
    });
    expect(() => recommendDefaultTaskCapacity([])).toThrow("A default-capacity recommendation requires at least one fixture comparison.");
  });
});
