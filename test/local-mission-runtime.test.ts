import { mkdir, mkdtemp, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { LocalMissionRuntime } from "../src/runtime/local-mission-runtime.js";
import { SubscriptionLiveWorkerAuthorization } from "../src/subscription-live-worker-authorization.js";
import { SubscriptionLiveWorkerError } from "../src/subscription-live-worker-runner.js";
import { JsonlEventStore } from "../src/event-store.js";
import { projectFinalReport } from "../src/frontend/office-projection.js";

const decisionSnapshot = (report: ReturnType<typeof projectFinalReport>) => ({
  fixtureId: report.fixtureId,
  outcome: report.outcome,
  priorities: report.priorities,
  heldOut: report.heldOut,
  reviewerVerdict: report.reviewerVerdict,
  customerProblemEvidence: report.customerProblemEvidence,
  evidenceQuality: report.evidenceQuality,
  advertisingSaturation: report.advertisingSaturation,
  operationalRisk: report.operationalRisk,
  failureRisk: report.failureRisk,
  safetyGate: report.safetyGate,
  evidenceSummary: report.evidenceSummary,
  nextStep: report.nextStep,
});

describe("LocalMissionRuntime", () => {
  it("launches a fixture and reloads the persisted event history", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "dropscope-runtime-"));
    const runtime = new LocalMissionRuntime({ dataRoot, createMissionId: () => "mission-one" });

    const launched = await runtime.launch("mixed-opportunity-market");
    const reloaded = await runtime.reload(launched.missionId);

    expect(launched).toEqual(reloaded);
    expect(launched.events.length).toBeGreaterThan(0);
    expect(launched.events.every((event) => event.missionId === "mission-one")).toBe(true);
    expect(await readdir(join(dataRoot, "missions"))).toEqual(expect.arrayContaining(["mission-one.jsonl", "mission-one.meta.json"]));
  });

  it("launches and reloads the cross-current recorded specialist finding", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "dropscope-runtime-"));
    const runtime = new LocalMissionRuntime({ dataRoot, createMissionId: () => "crosscurrent-mission" });

    const launched = await runtime.launch("crosscurrent-workspace-market");
    const reloaded = await runtime.reload(launched.missionId);
    const findings = reloaded.events.filter((event) => event.type === "FindingSubmitted");

    expect(launched.events).toContainEqual(expect.objectContaining({ type: "TaskFailedTransient", payload: expect.objectContaining({ attemptId: "workflow-interviews:a1" }) }));
    expect(findings).toContainEqual(expect.objectContaining({ payload: { attemptId: "workflow-interviews:a2", finding: "Recorded Evidence Researcher: recurring workflow evidence supports the workspace problem." } }));
    expect(reloaded).toEqual(launched);
  });

  it("launches and reloads the isolated live-worker pilot as a running mission", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "dropscope-runtime-"));
    const runtime = new LocalMissionRuntime({ dataRoot, createMissionId: () => "live-worker-pilot-mission" });

    const launched = await runtime.launch("live-worker-pilot");

    expect(launched.events.map((event) => event.type)).toEqual(["MissionCreated", "SubscriptionRuntimeDeclared", "TaskAuthorized", "TaskScheduled", "BudgetReserved", "TaskStarted"]);
    expect(launched.events.some((event) => event.type === "WorkerExecutionRecorded" || event.type === "SubscriptionWorkerExecutionOutcomeRecorded")).toBe(false);
    expect(await runtime.reload("live-worker-pilot-mission")).toEqual(launched);
  });

  it("captures the fixed Google Trends pilot only through its injected source and persists replayable evidence", async () => {
    const capture = vi.fn(async () => ({ sourceUrl: "https://trends.google.com/trending/rss?geo=US" as const, geo: "US" as const, attribution: "Google Trends" as const, items: [{ query: "Desk lamps", traffic: "20K+" }] }));
    const runtime = new LocalMissionRuntime({ dataRoot: await mkdtemp(join(tmpdir(), "dropscope-runtime-")), createMissionId: () => "google-trends-mission", googleTrendsSource: { capture } });
    const launched = await runtime.launch("google-trends-pilot");

    expect(launched.events.map((event) => event.type)).toEqual(["MissionCreated", "TaskAuthorized", "TaskScheduled", "BudgetReserved", "TaskStarted"]);
    const completed = await runtime.captureGoogleTrends(launched.missionId);

    expect(capture).toHaveBeenCalledOnce();
    expect(completed.events.slice(-3).map((event) => event.type)).toEqual(["GoogleTrendsEvidenceCaptured", "FindingSubmitted", "MissionCompleted"]);
    expect(completed.events.at(-3)).toMatchObject({ payload: { sourceUrl: "https://trends.google.com/trending/rss?geo=US", geo: "US", attribution: "Google Trends", items: [{ query: "Desk lamps", traffic: "20K+" }] } });
    expect(await runtime.reload(launched.missionId)).toEqual(completed);
    await expect(runtime.captureGoogleTrends(launched.missionId)).rejects.toThrow("Exactly one resumable Google Trends");
  });

  it("imports one explicit fixed comparison CSV without retaining its raw text or changing the scheduler lifecycle", async () => {
    const runtime = new LocalMissionRuntime({ dataRoot: await mkdtemp(join(tmpdir(), "dropscope-runtime-")), createMissionId: () => "google-trends-comparison-mission" });
    const csv = "Category: All categories\nWeek,desk cable organizer: (United States),under-desk cable tray: (United States),cable management box: (United States)\n2026-01-04,12,24,36\n2026-01-11,18,30,42";
    const launched = await runtime.launch("google-trends-comparison-pilot");

    const completed = await runtime.importGoogleTrendsComparison(launched.missionId, csv);

    expect(completed.events.slice(-3).map((event) => event.type)).toEqual(["GoogleTrendsComparisonImported", "FindingSubmitted", "MissionCompleted"]);
    expect(completed.events.at(-3)).toMatchObject({ payload: { geo: "US", searchType: "WEB_SEARCH", timeframe: "PAST_12_MONTHS", granularity: "WEEK", periods: ["2026-01-04", "2026-01-11"], series: [{ term: "desk cable organizer", values: [12, 18] }, { term: "under-desk cable tray", values: [24, 30] }, { term: "cable management box", values: [36, 42] }] } });
    expect(JSON.stringify(completed)).not.toContain("Category: All categories");
    expect(JSON.stringify(completed)).not.toContain("average");
    expect(await runtime.reload(launched.missionId)).toEqual(completed);
    await expect(runtime.importGoogleTrendsComparison(launched.missionId, csv)).rejects.toThrow("Exactly one resumable Google Trends comparison");
  });

  it("keeps final-report decisions invariant when manual comparison context is imported", async () => {
    const runtime = new LocalMissionRuntime({ dataRoot: await mkdtemp(join(tmpdir(), "dropscope-runtime-")), createMissionId: () => "comparison-decision-invariance" });
    const csv = "Category: All categories\nWeek,desk cable organizer: (United States),under-desk cable tray: (United States),cable management box: (United States)\n2026-01-04,12,24,36\n2026-01-11,18,30,42";
    const launched = await runtime.launch("google-trends-comparison-pilot");
    const beforeImport = projectFinalReport(launched.events);

    const completed = await runtime.importGoogleTrendsComparison(launched.missionId, csv);
    const afterImport = projectFinalReport(completed.events);

    expect(decisionSnapshot(afterImport)).toEqual(decisionSnapshot(beforeImport));
    expect(afterImport.comparisonSignalContext).toMatchObject({
      geo: "US",
      series: [
        { term: "desk cable organizer", values: [12, 18] },
        { term: "under-desk cable tray", values: [24, 30] },
        { term: "cable management box", values: [36, 42] },
      ],
    });
  });

  it("persists a sanitized terminal Google Trends failure without a retry", async () => {
    const runtime = new LocalMissionRuntime({ dataRoot: await mkdtemp(join(tmpdir(), "dropscope-runtime-")), createMissionId: () => "google-trends-failure", googleTrendsSource: { capture: async () => { throw new Error("raw upstream response must not persist"); } } });
    await runtime.launch("google-trends-pilot");
    const failed = await runtime.captureGoogleTrends("google-trends-failure");
    expect(failed.events.slice(-3).map((event) => event.type)).toEqual(["GoogleTrendsCaptureFailed", "TaskFailedPermanent", "MissionTerminated"]);
    expect(failed.events.at(-3)).toMatchObject({ payload: { outcome: "UNAVAILABLE" } });
    expect(JSON.stringify(failed)).not.toContain("raw upstream");
  });

  it("resumes a capture lifecycle after an outcome-only durable prefix without repeating the source request", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "dropscope-runtime-"));
    const capture = vi.fn(async () => ({ sourceUrl: "https://trends.google.com/trending/rss?geo=US" as const, geo: "US" as const, attribution: "Google Trends" as const, items: [{ query: "Desk lamps", traffic: "20K+" }] }));
    const runtime = new LocalMissionRuntime({ dataRoot, createMissionId: () => "resumable-google-trends", googleTrendsSource: { capture } });
    const launched = await runtime.launch("google-trends-pilot");
    const store = new JsonlEventStore(join(dataRoot, "missions", "resumable-google-trends.jsonl"));
    await store.append({ schemaVersion: 1, sequenceNumber: 6, missionId: launched.missionId, eventId: `${launched.missionId}-6`, timestamp: "2026-09-15T00:00:00.000Z", type: "GoogleTrendsEvidenceCaptured", payload: { attemptId: "google-trends-us-now:a1", sourceUrl: "https://trends.google.com/trending/rss?geo=US", geo: "US", attribution: "Google Trends", retrievedAt: "2026-09-15T00:00:00.000Z", items: [{ query: "Desk lamps", traffic: "20K+" }] } });

    const resumed = await runtime.captureGoogleTrends(launched.missionId);

    expect(capture).not.toHaveBeenCalled();
    expect(resumed.events.slice(-2).map((event) => event.type)).toEqual(["FindingSubmitted", "MissionCompleted"]);
  });

  it("persists one user-triggered sanitized subscription preflight without starting a worker", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "dropscope-runtime-"));
    const check = vi.fn(async () => ({ accessStatus: "CHATGPT_AUTHENTICATED" as const, diagnosticCode: "NOT_APPLICABLE" as const }));
    const runtime = new LocalMissionRuntime({ dataRoot, createMissionId: () => "preflight-mission", subscriptionRuntimePreflight: { check } });
    await runtime.launch("mixed-opportunity-market");

    const checked = await runtime.preflightSubscriptionRuntime("preflight-mission");

    expect(check).toHaveBeenCalledOnce();
    expect(checked.events.at(-1)).toMatchObject({ type: "SubscriptionRuntimePreflightCompleted", payload: { accessStatus: "CHATGPT_AUTHENTICATED", diagnosticCode: "NOT_APPLICABLE", usageStatus: "NOT_ITEMIZED" } });
    await expect(runtime.preflightSubscriptionRuntime("preflight-mission")).rejects.toThrow("already recorded");
    expect(await runtime.reload("preflight-mission")).toEqual(checked);
  });

  it("confirms only the authenticated live-worker pilot without persisting or exposing its capability", async () => {
    let now = 10_000;
    const authorization = new SubscriptionLiveWorkerAuthorization(() => now, () => "private-capability");
    const runtime = new LocalMissionRuntime({
      dataRoot: await mkdtemp(join(tmpdir(), "dropscope-runtime-")),
      createMissionId: () => "pilot-confirmation-mission",
      subscriptionLiveWorkerAuthorization: authorization,
      subscriptionRuntimePreflight: { check: async () => ({ accessStatus: "CHATGPT_AUTHENTICATED", diagnosticCode: "NOT_APPLICABLE" }) },
    });
    const launched = await runtime.launch("live-worker-pilot");
    const checked = await runtime.preflightSubscriptionRuntime(launched.missionId);

    const confirmation = await runtime.confirmSubscriptionWorker(checked.missionId);

    expect(confirmation).toEqual({ missionId: checked.missionId, attemptId: "pilot-evidence:a1", status: "CONFIRMED", expiresAtMs: 70_000 });
    expect(confirmation).not.toHaveProperty("capability");
    expect((await runtime.reload(checked.missionId)).events).toHaveLength(7);
    now = 70_000;
    const replacement = await runtime.confirmSubscriptionWorker(checked.missionId);
    expect(replacement.expiresAtMs).toBe(130_000);
  });

  it("consumes one confirmation for the fixed pilot, then persists its closed success outcome and lifecycle", async () => {
    const runner = vi.fn(async (request: { taskId: string; attemptId: string }, sandboxCwd: string) => ({ taskId: request.taskId, attemptId: request.attemptId, status: "COMPLETED" as const, finding: "One fixed inline-pilot finding." }));
    const runtime = new LocalMissionRuntime({
      dataRoot: await mkdtemp(join(tmpdir(), "dropscope-runtime-")),
      createMissionId: () => "live-run-success",
      subscriptionRuntimePreflight: { check: async () => ({ accessStatus: "CHATGPT_AUTHENTICATED", diagnosticCode: "NOT_APPLICABLE" }) },
      subscriptionLiveWorkerRunner: { run: runner },
    });
    await runtime.launch("live-worker-pilot");
    await runtime.preflightSubscriptionRuntime("live-run-success");
    await runtime.confirmSubscriptionWorker("live-run-success");

    const completed = await runtime.runSubscriptionWorker("live-run-success");

    expect(runner).toHaveBeenCalledOnce();
    expect(runner.mock.calls[0]![0]).toMatchObject({ missionId: "live-run-success", taskId: "pilot-evidence", attemptId: "pilot-evidence:a1", maxCost: 10 });
    expect(runner.mock.calls[0]![1]).toContain("live-worker-pilot-sandbox");
    expect(completed.events.slice(-3).map((event) => event.type)).toEqual(["SubscriptionWorkerExecutionOutcomeRecorded", "FindingSubmitted", "MissionCompleted"]);
    expect(completed.events.at(-3)).toMatchObject({ payload: { attemptId: "pilot-evidence:a1", outcome: "COMPLETED", providerUsageStatus: "UNKNOWN" } });
    expect(JSON.stringify(completed)).not.toContain("sandboxCwd");
    await expect(runtime.runSubscriptionWorker("live-run-success")).rejects.toThrow("Exactly one running");
  });

  it("fails permanently without retry when the safe runner declines an approval", async () => {
    const runtime = new LocalMissionRuntime({
      dataRoot: await mkdtemp(join(tmpdir(), "dropscope-runtime-")),
      createMissionId: () => "live-run-declined",
      subscriptionRuntimePreflight: { check: async () => ({ accessStatus: "CHATGPT_AUTHENTICATED", diagnosticCode: "NOT_APPLICABLE" }) },
      subscriptionLiveWorkerRunner: { run: async () => { throw new SubscriptionLiveWorkerError("APPROVAL_DECLINED", 12); } },
    });
    await runtime.launch("live-worker-pilot");
    await runtime.preflightSubscriptionRuntime("live-run-declined");
    await runtime.confirmSubscriptionWorker("live-run-declined");

    const failed = await runtime.runSubscriptionWorker("live-run-declined");

    expect(failed.events.slice(-3).map((event) => event.type)).toEqual(["SubscriptionWorkerExecutionOutcomeRecorded", "TaskFailedPermanent", "MissionTerminated"]);
    expect(failed.events.at(-3)).toMatchObject({ payload: { outcome: "APPROVAL_DECLINED", elapsedMs: 12, providerUsageStatus: "UNKNOWN" } });
    expect(failed.events.at(-1)).toMatchObject({ payload: { status: "FAILED_UNRECOVERABLE" } });
    expect(JSON.stringify(failed)).not.toContain("private");
  });

  it("fails closed for non-pilot, unauthenticated, and non-running missions", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "dropscope-runtime-"));
    const runtime = new LocalMissionRuntime({ dataRoot, createMissionId: () => "ordinary-mission" });
    await runtime.launch("mixed-opportunity-market");
    await expect(runtime.confirmSubscriptionWorker("ordinary-mission")).rejects.toThrow("only for the live-worker pilot");

    const pilot = new LocalMissionRuntime({ dataRoot: await mkdtemp(join(tmpdir(), "dropscope-runtime-")), createMissionId: () => "unauthenticated-pilot" });
    await pilot.launch("live-worker-pilot");
    await expect(pilot.confirmSubscriptionWorker("unauthenticated-pilot")).rejects.toThrow("Authenticated subscription preflight");
  });

  it("rejects unsafe ID factory output before creating a history path", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "dropscope-runtime-"));
    const runtime = new LocalMissionRuntime({ dataRoot, createMissionId: () => "../outside" });

    await expect(runtime.launch("mixed-opportunity-market")).rejects.toThrow();
    expect(await readdir(dataRoot)).toEqual([]);
  });

  it("rejects unknown fixtures and invalid mission IDs", async () => {
    const runtime = new LocalMissionRuntime({ dataRoot: await mkdtemp(join(tmpdir(), "dropscope-runtime-")) });
    await expect(runtime.launch("not-a-fixture")).rejects.toThrow("Unknown fixture ID");
    await expect(runtime.reload("../escape")).rejects.toThrow();
  });

  it("atomically reserves a generated ID so concurrent launches cannot share history", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "dropscope-runtime-"));
    const runtime = new LocalMissionRuntime({ dataRoot, createMissionId: () => "same-mission" });
    const results = await Promise.allSettled([
      runtime.launch("mixed-opportunity-market"),
      runtime.launch("mixed-opportunity-market"),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const reloaded = await runtime.reload("same-mission");
    expect(reloaded.events.length).toBeGreaterThan(0);
    expect(reloaded.events.every((event) => event.missionId === "same-mission")).toBe(true);
  });

  it("fails clearly for an empty incomplete reservation", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "dropscope-runtime-"));
    const missionsRoot = join(dataRoot, "missions");
    await mkdir(missionsRoot, { recursive: true });
    await writeFile(join(missionsRoot, "partial-mission.jsonl"), "", "utf8");
    await writeFile(join(missionsRoot, "partial-mission.reserve"), "", "utf8");
    const runtime = new LocalMissionRuntime({ dataRoot });
    await expect(runtime.reload("partial-mission")).rejects.toThrow("launch incomplete");
  });

  it("does not present a valid event prefix as complete while its reservation remains", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "dropscope-runtime-"));
    const missionsRoot = join(dataRoot, "missions");
    await mkdir(missionsRoot, { recursive: true });
    await writeFile(join(missionsRoot, "partial-mission.jsonl"), `${JSON.stringify({ schemaVersion: 1, sequenceNumber: 1, missionId: "partial-mission", eventId: "partial-mission-1", timestamp: "2026-01-01T00:00:00.000Z", type: "MissionCreated", payload: { totalBudget: 20, missionSeed: 1, policyVersions: { tribunal: "1" } } })}\n`, "utf8");
    await writeFile(join(missionsRoot, "partial-mission.reserve"), JSON.stringify({ fixtureId: "mixed-opportunity-market" }), "utf8");
    const runtime = new LocalMissionRuntime({ dataRoot });
    await expect(runtime.reload("partial-mission")).rejects.toThrow("launch incomplete");
  });

  it("classifies malformed reservation metadata as incomplete", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "dropscope-runtime-"));
    const missionsRoot = join(dataRoot, "missions");
    await mkdir(missionsRoot, { recursive: true });
    await writeFile(join(missionsRoot, "partial-mission.reserve"), "{", "utf8");
    const runtime = new LocalMissionRuntime({ dataRoot });
    await expect(runtime.reload("partial-mission")).rejects.toThrow("launch incomplete");
  });

  it("classifies an unknown fixture in reservation metadata as incomplete", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "dropscope-runtime-"));
    const missionsRoot = join(dataRoot, "missions");
    await mkdir(missionsRoot, { recursive: true });
    await writeFile(join(missionsRoot, "partial-mission.reserve"), JSON.stringify({ fixtureId: "unknown-fixture" }), "utf8");
    const runtime = new LocalMissionRuntime({ dataRoot });
    await expect(runtime.reload("partial-mission")).rejects.toThrow("launch incomplete");
  });

  it("does not follow a symlink at a mission history path", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "dropscope-runtime-"));
    const missionsRoot = join(dataRoot, "missions");
    await mkdir(missionsRoot, { recursive: true });
    const outside = join(dataRoot, "outside.jsonl");
    await writeFile(outside, "", "utf8");
    try {
      await symlink(outside, join(missionsRoot, "linked-mission.jsonl"));
    } catch (error: unknown) {
      if (isPrivilegeError(error)) return;
      throw error;
    }
    const runtime = new LocalMissionRuntime({ dataRoot, createMissionId: () => "linked-mission" });
    await expect(runtime.launch("mixed-opportunity-market")).rejects.toThrow();
  });

  it("rejects a symlinked metadata path during reload", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "dropscope-runtime-"));
    const missionsRoot = join(dataRoot, "missions");
    await mkdir(missionsRoot, { recursive: true });
    const outside = join(dataRoot, "outside.meta.json");
    await writeFile(outside, JSON.stringify({ fixtureId: "mixed-opportunity-market" }), "utf8");
    try {
      await symlink(outside, join(missionsRoot, "linked-mission.meta.json"));
    } catch (error: unknown) {
      if (isPrivilegeError(error)) return;
      throw error;
    }
    const runtime = new LocalMissionRuntime({ dataRoot });
    await expect(runtime.reload("linked-mission")).rejects.toThrow("filesystem link");
  });
});

function isPrivilegeError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && ["EPERM", "EACCES"].includes(String(error.code));
}
