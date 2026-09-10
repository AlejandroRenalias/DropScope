import { describe, expect, it } from "vitest";
import { replay } from "../src/reducer.js";
import { buildCandidateReport } from "../src/report.js";
import { determineCandidateEligibility } from "../src/candidate-eligibility.js";
import { evaluateRiskGate } from "../src/risk-policy.js";
import { loadFixture } from "../src/fixture-model.js";
import { buildFixtureQualityPipeline } from "../src/fixture-quality-pipeline.js";

describe("fixture quality pipeline", () => {
  it("builds a reducer-valid persisted revision loop from the ranked candidate", () => {
    const fixture = loadFixture("crosscurrent-workspace-market");
    const riskDecisions = fixture.candidateEvaluations.map((candidate) => evaluateRiskGate(candidate.riskInput));
    const eligibility = fixture.candidateEvaluations.map((candidate, index) => determineCandidateEligibility({ ...candidate, riskDecision: riskDecisions[index]! }));
    const report = buildCandidateReport(fixture.candidateEvaluations, riskDecisions, eligibility);
    const events = buildFixtureQualityPipeline({ missionId: "quality-fixture", startingSequence: 1, report, riskDecisions });
    const state = replay([
      { schemaVersion: 1, sequenceNumber: 1, missionId: "quality-fixture", eventId: "created", timestamp: "2026-01-01T00:00:00.000Z", type: "MissionCreated", payload: { totalBudget: 140, missionSeed: 47, policyVersions: { tribunal: "1" } } },
      ...events,
    ]);
    expect(report.ranking[0]?.candidateId).toBe("deskflow-alpha");
    expect(events.map(({ type }) => type)).toEqual([
      "TribunalCompleted", "AuditCompleted", "BlindReviewCompleted", "RankingDivergenceDetected", "RevisionRequested", "FocusedReauditCompleted", "FocusedRereviewCompleted",
    ]);
    expect(events[2]?.payload).toMatchObject({ verdict: "REVISE" });
    expect(events.at(-1)?.payload).toMatchObject({ result: { verdict: "ACCEPT" } });
    expect(state.revision?.affectedClaimIds).toHaveLength(1);
    expect(state.status).toBe("RUNNING");
  });
});
