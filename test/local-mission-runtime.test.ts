import { mkdir, mkdtemp, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { LocalMissionRuntime } from "../src/runtime/local-mission-runtime.js";
import { SubscriptionLiveWorkerAuthorization } from "../src/subscription-live-worker-authorization.js";

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
