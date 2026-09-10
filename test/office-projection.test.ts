import { describe, expect, it } from "vitest";
import { officeHistories, projectFinalReport, projectOffice, replayEvents } from "../src/frontend/office-projection.js";
import { replay } from "../src/reducer.js";
describe("Research Office event projection", () => {
  it("exposes exactly three valid replay histories", () => { expect(Object.keys(officeHistories)).toEqual(["RUNNING", "BLOCKED", "COMPLETED"]); Object.values(officeHistories).forEach((history) => expect(() => replay(history)).not.toThrow()); });
  it("reads the ledger and changing display state from replay", () => { const running = projectOffice(officeHistories.RUNNING); const blocked = projectOffice(officeHistories.BLOCKED); const completed = projectOffice(officeHistories.COMPLETED); expect(running.ledger).toEqual({ total: 140, reserved: 0, committed: 50, spent: 25, available: 65 }); expect(running.mission).toMatchObject({ name: "Crosscurrent Workspace Market", status: "RUNNING" }); expect(running.tasks.filter((task) => task.state === "WORKING")).toHaveLength(2); expect(blocked.mission.status).toBe("BLOCKED"); expect(replay(officeHistories.BLOCKED).status).toBe("BLOCKED_POLICY"); expect(blocked.agents.some((agent) => agent.state === "BLOCKED")).toBe(true); expect(completed.mission.status).toBe("COMPLETED"); expect(completed.tasks.every((task) => task.state === "COMPLETED")).toBe(true); });
  it("projects dependencies and the recent event trail without precomputed values", () => { const projection = projectOffice(officeHistories.COMPLETED); expect(projection.tasks.find((task) => task.label.toLowerCase().includes("risk"))?.dependencies).toContain("workflow-interviews"); expect(projection.events.map((item) => item.type)).toEqual(["TaskStarted", "FindingSubmitted", "MissionCompleted"]); expect(projection.sourceLabel).toContain("replayed"); });
  it("projects the decision rooms only from recorded replay results", () => {
    const running = projectOffice(officeHistories.RUNNING);
    const completed = projectOffice(officeHistories.COMPLETED);
    expect(running.decisionViews.agentDesk.every((agent) => agent.usage.units > 0)).toBe(true);
    expect(running.decisionViews.tribunalRoom?.result.recommendation).toBe("CONTINUE_RESEARCH");
    expect(running.decisionViews.reviewOffice?.result.ranking).toEqual(["crosscurrent-workspace-market"]);
    expect(running.decisionViews.reviewOffice?.blockingFeedback).toContain("unresolved_decision_critical_contradiction");
    expect(completed.decisionViews.reviewOffice?.divergences).toContain("TOP_CANDIDATE_DIVERGENCE: crosscurrent-workspace-market");
    expect(completed.decisionViews.reviewOffice?.revisionResponse).toContain("returned accept");
  });
  it("projects persisted dry-run provenance without relying on finding text", () => {
    const recordedHistory = officeHistories.COMPLETED.flatMap((event) => event.type === "FindingSubmitted" && event.payload.attemptId === "workflow:c1"
      ? [
          { ...event, type: "WorkerExecutionRecorded" as const, payload: { attemptId: "workflow:c1", mode: "RECORDED_DRY_RUN" as const, providerUsageStatus: "NOT_APPLICABLE" as const } },
          { ...event, payload: { ...event.payload, finding: "Recorded result without a provenance prefix." } },
        ]
      : [event],
    ).map((event, index) => ({ ...event, sequenceNumber: index + 1, eventId: `recorded-${index + 1}` }));
    const projection = projectOffice(recordedHistory);

    expect(projection.decisionViews.agentDesk.find((agent) => agent.attemptId === "workflow:c1")?.provenance).toBe("RECORDED_DRY_RUN");
    expect(projection.decisionViews.missionUsageSummary).toEqual({ dryRunCount: 1, unrecordedAttemptCount: 3, recordedDryRunProviderUsageStatus: "NOT_APPLICABLE", ...replay(recordedHistory).budget });
    expect(replay(recordedHistory).status).toBe("COMPLETED");
  });
  it("does not show a mission dry-run summary without recorded dry-run provenance", () => {
    expect(projectOffice(officeHistories.COMPLETED).decisionViews.missionUsageSummary).toBeNull();
  });
  it("builds a browser-safe final report from the static fixture helpers", () => {
    const report = projectFinalReport();
    expect(report.fixtureId).toBe("crosscurrent-workspace-market");
    expect(report.priorities.length).toBeGreaterThan(0);
    expect(report.priorities.length).toBeLessThanOrEqual(5);
    expect(report.heldOut.some((candidate) => candidate.reasonCodes.length > 0)).toBe(true);
    expect(report.safetyGate).toBe("ALLOWED");
    expect(report.evidenceSummary.supporting).toContain("Customer-problem evidence 91/100");
    expect(report.evidenceSummary.opposing).toContain("Operational risk 18/100");
    expect(report.reviewerVerdict).toBe("REVISE");
    expect(report.nextStep).toContain("Next step");
  });
  it("labels replay event categories and projects valid prefixes without mutation", () => {
    const history = officeHistories.BLOCKED;
    const records = replayEvents(history);
    expect(new Set(records.map((record) => record.category))).toEqual(new Set(["task", "agent", "budget", "review", "failure"]));
    history.forEach((_, index) => expect(() => projectOffice(history.slice(0, index + 1))).not.toThrow());
    expect(history).toHaveLength(records.length);
  });
});
