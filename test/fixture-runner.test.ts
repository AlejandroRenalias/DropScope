import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runFixtureMission } from "../src/fixture-runner.js";

describe("fixture-driven simulated missions", () => {
  it.each(["mixed-opportunity-market", "evidence-drought", "safety-ambiguity"])("runs %s through the shared scheduler", async (fixtureId) => {
    const result = await runFixtureMission({
      fixtureId,
      missionId: `${fixtureId}-mission`,
      historyPath: join(await mkdtemp(join(tmpdir(), "dropscope-")), "mission.jsonl"),
    });

    expect(result.state.status).toBe(fixtureId === "mixed-opportunity-market" ? "COMPLETED" : "COMPLETED_INSUFFICIENT_EVIDENCE");
    expect(result.events[0]?.type).toBe("MissionCreated");
    expect(result.events.at(-1)?.type).toBe(fixtureId === "mixed-opportunity-market" ? "MissionCompleted" : "MissionTerminated");
    expect(new Set(Object.values(result.schedule.taskOutcomes))).toEqual(new Set(["COMPLETED"]));
  });

  it("derives insufficient evidence from candidate gate inputs rather than a fixture name", async () => {
    const result = await runFixtureMission({ fixtureId: "evidence-drought", missionId: "drought-outcome", historyPath: join(await mkdtemp(join(tmpdir(), "dropscope-")), "mission.jsonl") });

    expect(result.candidateEligibility).toEqual([expect.objectContaining({ candidateId: "drought-candidate", eligible: false, blockers: expect.arrayContaining(["CUSTOMER_PROBLEM_EVIDENCE_BELOW_THRESHOLD", "EVIDENCE_QUALITY_BELOW_THRESHOLD"]) })]);
    expect(result.state.status).toBe("COMPLETED_INSUFFICIENT_EVIDENCE");
  });

  it("derives safety fixture policy outcomes and reason codes through the shared evaluator", async () => {
    const result = await runFixtureMission({ fixtureId: "safety-ambiguity", missionId: "safety-outcome", historyPath: join(await mkdtemp(join(tmpdir(), "dropscope-")), "mission.jsonl") });
    expect(result.riskDecisions.map((decision) => [decision.outcome, decision.reasons[0]?.code])).toEqual([
      ["REJECTED", "SAFETY_INGESTION_OR_FOOD"],
      ["REJECTED", "REGULATORY_MEDICAL_POSITIONING"],
      ["MANUAL_REVIEW", "INSUFFICIENT_INFORMATION_MATERIAL_MISSING"],
    ]);
    expect(result.state.status).toBe("COMPLETED_INSUFFICIENT_EVIDENCE");
  });

  it("changes mission data without changing the runner", async () => {
    const root = await mkdtemp(join(tmpdir(), "dropscope-"));
    const first = await runFixtureMission({ fixtureId: "evidence-drought", missionId: "fixture-one", historyPath: join(root, "one.jsonl") });
    const second = await runFixtureMission({ fixtureId: "safety-ambiguity", missionId: "fixture-two", historyPath: join(root, "two.jsonl") });

    expect(first.events[0]?.payload).not.toEqual(second.events[0]?.payload);
    expect(Object.keys(first.state.tasks)).not.toEqual(Object.keys(second.state.tasks));
  });
});
