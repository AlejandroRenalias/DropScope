import { mkdtemp, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runFixtureMission } from "../src/fixture-runner.js";
import { deriveAttemptDecision } from "../src/scheduler.js";
import { JsonlEventStore } from "../src/event-store.js";

describe("fixture-driven simulated missions", () => {
  it("can append a mission through an already-reserved writer handle", async () => {
    const root = await mkdtemp(join(tmpdir(), "dropscope-"));
    const historyPath = join(root, "owned.jsonl");
    const writer = await open(historyPath, "ax");
    try {
      const result = await runFixtureMission({
        fixtureId: "mixed-opportunity-market",
        missionId: "owned-mission",
        historyPath,
        eventStore: new JsonlEventStore(historyPath, writer),
      });
      expect(result.events.every((event) => event.missionId === "owned-mission")).toBe(true);
    } finally {
      await writer.close();
    }
  });

  it.each(["mixed-opportunity-market", "evidence-drought", "safety-ambiguity"])("runs %s through the shared scheduler", async (fixtureId) => {
    const result = await runFixtureMission({
      fixtureId,
      missionId: `${fixtureId}-mission`,
      historyPath: join(await mkdtemp(join(tmpdir(), "dropscope-")), "mission.jsonl"),
    });

    expect(result.state.status).toBe(fixtureId === "evidence-drought" ? "COMPLETED_INSUFFICIENT_EVIDENCE" : "COMPLETED");
    expect(result.report.outcome).toBe(fixtureId === "evidence-drought" ? "INSUFFICIENT_EVIDENCE" : "RANKED");
    expect(result.events[0]?.type).toBe("MissionCreated");
    expect(result.events.at(-1)?.type).toBe(fixtureId === "evidence-drought" ? "MissionTerminated" : "MissionCompleted");
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
      ["RESTRICTED", "SAFETY_ELECTRICAL_COMPONENT"],
      ["ALLOWED", undefined],
      ["ALLOWED", undefined],
    ]);
    expect(result.report.ranking.map(({ candidateId }) => candidateId)).toEqual(["safe-alpha", "safe-beta"]);
    expect(result.report.heldOut.map(({ candidateId, outcome }) => [candidateId, outcome])).toEqual([
      ["food-risk", "REJECTED"], ["medical-risk", "REJECTED"], ["ambiguous-risk", "MANUAL_REVIEW"], ["restricted-risk", "RESTRICTED"],
    ]);
    expect(result.state.status).toBe("COMPLETED");
  });

  it("changes mission data without changing the runner", async () => {
    const root = await mkdtemp(join(tmpdir(), "dropscope-"));
    const first = await runFixtureMission({ fixtureId: "evidence-drought", missionId: "fixture-one", historyPath: join(root, "one.jsonl") });
    const second = await runFixtureMission({ fixtureId: "safety-ambiguity", missionId: "fixture-two", historyPath: join(root, "two.jsonl") });

    expect(first.events[0]?.payload).not.toEqual(second.events[0]?.payload);
    expect(Object.keys(first.state.tasks)).not.toEqual(Object.keys(second.state.tasks));
  });

  it("preserves a scheduler terminal outcome without appending a second terminal event", async () => {
    const seed = Array.from({ length: 500 }, (_, value) => value).find((value) => deriveAttemptDecision(value, "market-scan", 1, 20).outcome === "FAILED_TRANSIENT" && deriveAttemptDecision(value, "market-scan", 2, 20).outcome === "FAILED_TRANSIENT");
    expect(seed).toBeDefined();
    const result = await runFixtureMission({ fixtureId: "mixed-opportunity-market", missionId: "fixture-terminal", missionSeed: seed!, historyPath: join(await mkdtemp(join(tmpdir(), "dropscope-")), "mission.jsonl") });
    expect(result.state.status).toBe("FAILED_UNRECOVERABLE");
    expect(result.events.filter((event) => event.type === "MissionTerminated")).toHaveLength(1);
    expect(result.events.at(-1)?.type).toBe("MissionTerminated");
  });

  it("runs the unseen cross-current workspace holdout through generic fixture data", async () => {
    const result = await runFixtureMission({ fixtureId: "crosscurrent-workspace-market", missionId: "fixture-d-holdout", historyPath: join(await mkdtemp(join(tmpdir(), "dropscope-")), "mission.jsonl") });

    expect(result.fixtureId).toBe("crosscurrent-workspace-market");
    expect(result.events[0]?.type).toBe("MissionCreated");
    expect(result.state.status).toBe("COMPLETED");
    expect(result.events.at(-1)?.type).toBe("MissionCompleted");
    expect(Object.values(result.schedule.taskOutcomes)).toEqual(["COMPLETED", "COMPLETED", "COMPLETED", "COMPLETED"]);
    expect(Object.keys(result.state.tasks)).toHaveLength(4);
    expect(result.riskDecisions.map(({ outcome }) => outcome)).toEqual(["REJECTED", "REJECTED", "RESTRICTED", "MANUAL_REVIEW", "ALLOWED", "ALLOWED", "ALLOWED"]);
    expect(result.riskDecisions.map(({ reasons }) => reasons.map(({ code }) => code))).toEqual([
      ["SAFETY_INGESTION_OR_FOOD", "SAFETY_HIGH_POWER_ELECTRICAL", "INTELLECTUAL_PROPERTY_OBVIOUS_REFERENCE"],
      ["REGULATORY_MEDICAL_POSITIONING"],
      ["REGULATORY_CHILD_DIRECTED"],
      ["INSUFFICIENT_INFORMATION_MATERIAL_CONFLICT"],
      [], [], [],
    ]);
    expect(result.report.outcome).toBe("RANKED");
    expect(result.report.ranking.map(({ candidateId }) => candidateId)).toEqual(["deskflow-alpha", "deskflow-beta", "deskflow-gamma"]);
    expect(result.report.heldOut.map(({ candidateId, outcome }) => [candidateId, outcome])).toEqual([
      ["food-power-crosscurrent", "REJECTED"], ["medical-workspace", "REJECTED"], ["child-workspace", "RESTRICTED"], ["uncertain-workspace", "MANUAL_REVIEW"],
    ]);
    expect(result.report.heldOut.map(({ reasonCodes }) => reasonCodes)).toEqual([
      ["SAFETY_INGESTION_OR_FOOD", "SAFETY_HIGH_POWER_ELECTRICAL", "INTELLECTUAL_PROPERTY_OBVIOUS_REFERENCE", "RISK_GATE_NOT_ALLOWED"],
      ["REGULATORY_MEDICAL_POSITIONING", "RISK_GATE_NOT_ALLOWED"],
      ["REGULATORY_CHILD_DIRECTED", "RISK_GATE_NOT_ALLOWED"],
      ["INSUFFICIENT_INFORMATION_MATERIAL_CONFLICT", "RISK_GATE_NOT_ALLOWED", "UNRESOLVED_BLOCKING_CONTRADICTION", "DECISION_CRITICAL_MISSING_EVIDENCE"],
    ]);
    expect(result.events).toContainEqual(expect.objectContaining({ type: "TaskFailedTransient", payload: expect.objectContaining({ attemptId: "workflow-interviews:a1" }) }));
    expect(result.events).toContainEqual(expect.objectContaining({ type: "FindingSubmitted", payload: { attemptId: "workflow-interviews:a2", finding: "Recorded Evidence Researcher: recurring workflow evidence supports the workspace problem." } }));
    expect(result.events.filter((event) => event.type === "FindingSubmitted" && event.payload.finding.includes("Recorded Evidence Researcher"))).toHaveLength(1);
  });

  it("does not activate the recorded specialist for unrelated fixtures", async () => {
    const result = await runFixtureMission({ fixtureId: "mixed-opportunity-market", missionId: "fixture-no-worker", historyPath: join(await mkdtemp(join(tmpdir(), "dropscope-")), "mission.jsonl") });

    expect(result.events.some((event) => event.type === "FindingSubmitted" && event.payload.finding.includes("Recorded Evidence Researcher"))).toBe(false);
  });
});
