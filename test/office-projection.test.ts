import { describe, expect, it } from "vitest";
import { officeHistories, projectFinalReport, projectOffice, replayEvents } from "../src/frontend/office-projection.js";
import { replay } from "../src/reducer.js";
import { firstLiveSubscriptionWorkerGuard } from "../src/subscription-live-worker-contract.js";
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
  it("derives subscription status only from a persisted declaration", () => {
    expect(projectOffice(officeHistories.COMPLETED).decisionViews.subscriptionRuntime).toBeNull();
    const history = officeHistories.COMPLETED.map((item, index) => ({ ...item, sequenceNumber: index + 1, eventId: `declared-${index + 1}` }));
    const declaration = { ...history[0]!, type: "SubscriptionRuntimeDeclared" as const, payload: { executionEnabled: false as const, accessStatus: "NOT_CHECKED" as const, usageStatus: "NOT_ITEMIZED" as const }, sequenceNumber: 2, eventId: "declared-2" };
    const declared = [history[0]!, declaration, ...history.slice(1).map((item, index) => ({ ...item, sequenceNumber: index + 3, eventId: `declared-${index + 3}` }))];
    expect(projectOffice(declared).decisionViews.subscriptionRuntime).toMatchObject({ execution: "DISABLED", access: "LOCAL_SUBSCRIPTION_NOT_CHECKED", usage: "SUBSCRIPTION_NOT_ITEMIZED", firstLiveWorker: firstLiveSubscriptionWorkerGuard, protocolFake: { approvalCategories: ["command", "file change", "permissions"], terminalOutcomes: ["completed", "timed out", "unavailable", "approval declined", "interrupted", "invalid result", "turn failed"] } });
  });
  it("projects sanitized persisted subscription preflight status without account details", () => {
    const history = officeHistories.COMPLETED.map((item, index) => ({ ...item, sequenceNumber: index + 1, eventId: `preflight-${index + 1}` }));
    const declaration = { ...history[0]!, type: "SubscriptionRuntimeDeclared" as const, payload: { executionEnabled: false as const, accessStatus: "NOT_CHECKED" as const, usageStatus: "NOT_ITEMIZED" as const }, sequenceNumber: 2, eventId: "preflight-2" };
    const preflight = { ...history[0]!, type: "SubscriptionRuntimePreflightCompleted" as const, payload: { accessStatus: "CHATGPT_AUTHENTICATED" as const, usageStatus: "NOT_ITEMIZED" as const }, sequenceNumber: history.length + 2, eventId: `preflight-${history.length + 2}` };
    const declared = [history[0]!, declaration, ...history.slice(1).map((item, index) => ({ ...item, sequenceNumber: index + 3, eventId: `preflight-${index + 3}` })), preflight];
    expect(projectOffice(declared).decisionViews.subscriptionRuntime).toMatchObject({ execution: "DISABLED", access: "LOCAL_CHATGPT_AUTHENTICATED", usage: "SUBSCRIPTION_NOT_ITEMIZED", firstLiveWorker: firstLiveSubscriptionWorkerGuard, protocolFake: { approvalCategories: ["command", "file change", "permissions"], terminalOutcomes: ["completed", "timed out", "unavailable", "approval declined", "interrupted", "invalid result", "turn failed"] } });
  });
  it("projects a sanitized persisted subscription-worker outcome without a thread or provider measurement", () => {
    const history = officeHistories.RUNNING.map((item, index) => ({ ...item, sequenceNumber: index + 1, eventId: `outcome-${index + 1}` }));
    const declaration = { ...history[0]!, type: "SubscriptionRuntimeDeclared" as const, payload: { executionEnabled: false as const, accessStatus: "NOT_CHECKED" as const, usageStatus: "NOT_ITEMIZED" as const }, sequenceNumber: 2, eventId: "outcome-2" };
    const preflight = { ...history[0]!, type: "SubscriptionRuntimePreflightCompleted" as const, payload: { accessStatus: "CHATGPT_AUTHENTICATED" as const, usageStatus: "NOT_ITEMIZED" as const }, sequenceNumber: 3, eventId: "outcome-3" };
    const events = [history[0]!, declaration, preflight, ...history.slice(1).map((item, index) => ({ ...item, sequenceNumber: index + 4, eventId: `outcome-${index + 4}` }))];
    const outcome = { ...history[0]!, type: "SubscriptionWorkerExecutionOutcomeRecorded" as const, payload: { attemptId: "workflow:a1", outcome: "TIMEOUT" as const, providerUsageStatus: "UNKNOWN" as const, elapsedMs: 90_000 }, sequenceNumber: events.length + 1, eventId: `outcome-${events.length + 1}` };

    expect(projectOffice([...events, outcome]).decisionViews.subscriptionRuntime?.lastWorkerOutcome).toEqual(outcome.payload);
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
  it("keeps the legacy static review label when a replay has no recorded review", () => {
    expect(projectFinalReport(officeHistories.RUNNING).reviewerVerdict).toBe(projectFinalReport().reviewerVerdict);
  });
  it("labels replay event categories and projects valid prefixes without mutation", () => {
    const history = officeHistories.BLOCKED;
    const records = replayEvents(history);
    expect(new Set(records.map((record) => record.category))).toEqual(new Set(["task", "agent", "budget", "review", "failure"]));
    history.forEach((_, index) => expect(() => projectOffice(history.slice(0, index + 1))).not.toThrow());
    expect(history).toHaveLength(records.length);
  });
});
