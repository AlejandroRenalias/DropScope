import { describe, expect, it } from "vitest";
import { replayVirtualStaffingLatency, runVirtualStaffingExperiment, virtualStaffingPlans } from "../src/virtual-staffing-evaluation.js";
import { runFixtureMission } from "../src/fixture-runner.js";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("virtual role-based staffing evaluation", () => {
  it("compares the three closed staffing plans against the same fixed mission outputs", async () => {
    const results = await runVirtualStaffingExperiment();
    const repeatedResults = await runVirtualStaffingExperiment();

    expect(repeatedResults).toEqual(results);
    expect(results).toHaveLength(9);
    expect(results.map(({ fixtureId, planId }) => `${fixtureId}:${planId}`)).toEqual([
      "crosscurrent-workspace-market:generalist",
      "crosscurrent-workspace-market:research-operations-pair",
      "crosscurrent-workspace-market:specialist-team",
      "failure-autopsy-pilot:generalist",
      "failure-autopsy-pilot:research-operations-pair",
      "failure-autopsy-pilot:specialist-team",
      "product-investigation-pilot:generalist",
      "product-investigation-pilot:research-operations-pair",
      "product-investigation-pilot:specialist-team",
    ]);
    expect(results.filter((result) => result.fixtureId === "crosscurrent-workspace-market").map((result) => result.virtualAgentCount)).toEqual([1, 2, 4]);
    expect(results.map((result) => result.simulatedLatencyMs)).toEqual([82, 68, 68, 58, 58, 58, 74, 74, 74]);
    for (const fixtureId of ["crosscurrent-workspace-market", "failure-autopsy-pilot", "product-investigation-pilot"]) {
      const fixtureResults = results.filter((result) => result.fixtureId === fixtureId);
      expect(new Set(fixtureResults.map((result) => JSON.stringify({ terminalStatus: result.terminalStatus, spent: result.spent, eventCount: result.eventCount, ranking: result.ranking, reviewerVerdict: result.reviewerVerdict })))).toHaveLength(1);
    }
    expect(results.filter((result) => result.fixtureId === "failure-autopsy-pilot").every((result) => result.terminalStatus === "COMPLETED_INSUFFICIENT_EVIDENCE" && result.reviewerVerdict === "REJECT")).toBe(true);
    expect(results.filter((result) => result.fixtureId === "product-investigation-pilot").every((result) => result.ranking.includes("modular-desk-organizer") && result.reviewerVerdict === "REVISE")).toBe(true);
  });

  it("rejects a plan that cannot staff a recorded role", async () => {
    const root = await mkdtemp(join(tmpdir(), "dropscope-uncovered-role-"));
    const mission = await runFixtureMission({ fixtureId: "failure-autopsy-pilot", missionId: "uncovered-role", historyPath: join(root, "mission.jsonl"), maxConcurrency: 3 });

    expect(() => replayVirtualStaffingLatency(mission.events, { planId: "evidence-only", label: "Evidence only", agents: [{ agentId: "evidence-1", supportedRoles: ["EVIDENCE_RESEARCHER"] }] })).toThrow("Virtual staffing plan evidence-only has no agent for MARKET_RESEARCHER.");
    expect(virtualStaffingPlans).toHaveLength(3);
  });
});
