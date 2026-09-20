import { describe, expect, it } from "vitest";
import { evaluationConcurrencies, evaluationFixtureIds, runEvaluationBaseline } from "../src/evaluation-baseline.js";

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
});
