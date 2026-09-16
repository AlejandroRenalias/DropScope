import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listenLocalRuntimeServer } from "../src/local-runtime-server.js";
import { LocalMissionRuntime } from "../src/runtime/local-mission-runtime.js";

const servers: Array<ReturnType<typeof listenLocalRuntimeServer> extends Promise<infer T> ? T : never> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function urlFor(server: (typeof servers)[number], path: string): Promise<string> {
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}${path}`;
}

describe("local runtime HTTP bridge", () => {
  it("launches and reloads through validated DTO endpoints", async () => {
    const runtime = new LocalMissionRuntime({ dataRoot: await mkdtemp(join(tmpdir(), "dropscope-server-")), createMissionId: () => "server-mission" });
    const server = await listenLocalRuntimeServer(runtime);
    servers.push(server);

    const launchResponse = await fetch(await urlFor(server, "/api/missions"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fixtureId: "evidence-drought" }) });
    expect(launchResponse.status).toBe(201);
    const launched = await launchResponse.json() as { missionId: string; fixtureId: string; events: unknown[]; historyPath?: string };
    expect(launched).toMatchObject({ missionId: "server-mission", fixtureId: "evidence-drought" });
    expect(launched.events.length).toBeGreaterThan(0);
    expect(launched).not.toHaveProperty("historyPath");

    const reloadResponse = await fetch(await urlFor(server, `/api/missions/${launched.missionId}`));
    expect(reloadResponse.status).toBe(200);
    expect(await reloadResponse.json()).toEqual(launched);
  });

  it("accepts only a user POST for a sanitized subscription preflight", async () => {
    const runtime = new LocalMissionRuntime({ dataRoot: await mkdtemp(join(tmpdir(), "dropscope-server-")), createMissionId: () => "preflight-server-mission", subscriptionRuntimePreflight: { check: async () => ({ accessStatus: "AUTHENTICATION_REQUIRED", diagnosticCode: "NOT_APPLICABLE" }) } });
    const server = await listenLocalRuntimeServer(runtime);
    servers.push(server);
    const launch = await fetch(await urlFor(server, "/api/missions"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fixtureId: "evidence-drought" }) });
    const mission = await launch.json() as { missionId: string };

    const preflight = await fetch(await urlFor(server, `/api/missions/${mission.missionId}/subscription-preflight`), { method: "POST" });

    expect(preflight.status).toBe(200);
    expect((await preflight.json() as { events: Array<{ type: string; payload: unknown }> }).events.at(-1)).toMatchObject({ type: "SubscriptionRuntimePreflightCompleted", payload: { accessStatus: "AUTHENTICATION_REQUIRED", usageStatus: "NOT_ITEMIZED" } });
    expect((await fetch(await urlFor(server, `/api/missions/${mission.missionId}/subscription-preflight`))).status).toBe(400);
    expect((await fetch(await urlFor(server, `/api/missions/${mission.missionId}/subscription-preflight`), { method: "POST" })).status).toBe(409);
  });

  it("returns a sanitized in-memory confirmation for the authenticated pilot", async () => {
    const runtime = new LocalMissionRuntime({
      dataRoot: await mkdtemp(join(tmpdir(), "dropscope-server-")),
      createMissionId: () => "confirmation-server-mission",
      subscriptionRuntimePreflight: { check: async () => ({ accessStatus: "CHATGPT_AUTHENTICATED", diagnosticCode: "NOT_APPLICABLE" }) },
    });
    const server = await listenLocalRuntimeServer(runtime);
    servers.push(server);
    const launch = await fetch(await urlFor(server, "/api/missions"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fixtureId: "live-worker-pilot" }) });
    const mission = await launch.json() as { missionId: string };
    expect((await fetch(await urlFor(server, `/api/missions/${mission.missionId}/subscription-confirmation`), { method: "POST" })).status).toBe(409);
    expect((await fetch(await urlFor(server, `/api/missions/${mission.missionId}/subscription-preflight`), { method: "POST" })).status).toBe(200);

    const response = await fetch(await urlFor(server, `/api/missions/${mission.missionId}/subscription-confirmation`), { method: "POST" });
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({ missionId: mission.missionId, attemptId: "pilot-evidence:a1", status: "CONFIRMED" });
    expect(body).toHaveProperty("expiresAtMs");
    expect(body).not.toHaveProperty("capability");
    expect((await fetch(await urlFor(server, `/api/missions/${mission.missionId}/subscription-confirmation`), { method: "POST", body: "{}" })).status).toBe(400);
  });

  it("runs only a confirmed pilot through the fixed subscription endpoint and returns replayable events", async () => {
    const runner = vi.fn(async (request: { taskId: string; attemptId: string }) => ({ taskId: request.taskId, attemptId: request.attemptId, status: "COMPLETED" as const, finding: "Fixed pilot finding." }));
    const runtime = new LocalMissionRuntime({
      dataRoot: await mkdtemp(join(tmpdir(), "dropscope-server-")),
      createMissionId: () => "run-server-mission",
      subscriptionRuntimePreflight: { check: async () => ({ accessStatus: "CHATGPT_AUTHENTICATED", diagnosticCode: "NOT_APPLICABLE" }) },
      subscriptionLiveWorkerRunner: { run: runner },
    });
    const server = await listenLocalRuntimeServer(runtime);
    servers.push(server);
    const launch = await fetch(await urlFor(server, "/api/missions"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fixtureId: "live-worker-pilot" }) });
    const mission = await launch.json() as { missionId: string };
    const runUrl = await urlFor(server, `/api/missions/${mission.missionId}/subscription-run`);

    expect((await fetch(runUrl, { method: "POST" })).status).toBe(409);
    await fetch(await urlFor(server, `/api/missions/${mission.missionId}/subscription-preflight`), { method: "POST" });
    await fetch(await urlFor(server, `/api/missions/${mission.missionId}/subscription-confirmation`), { method: "POST" });
    const response = await fetch(runUrl, { method: "POST" });

    expect(response.status).toBe(200);
    expect((await response.json() as { events: Array<{ type: string }> }).events.slice(-3).map((event) => event.type)).toEqual(["SubscriptionWorkerExecutionOutcomeRecorded", "FindingSubmitted", "MissionCompleted"]);
    expect(runner).toHaveBeenCalledOnce();
    expect((await fetch(runUrl, { method: "POST" })).status).toBe(409);
    expect((await fetch(runUrl, { method: "POST", body: "{}" })).status).toBe(400);
  });

  it("accepts one bounded manual comparison CSV only for its fixed local pilot", async () => {
    const runtime = new LocalMissionRuntime({ dataRoot: await mkdtemp(join(tmpdir(), "dropscope-server-")), createMissionId: () => "comparison-server-mission" });
    const server = await listenLocalRuntimeServer(runtime);
    servers.push(server);
    const launch = await fetch(await urlFor(server, "/api/missions"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fixtureId: "google-trends-comparison-pilot" }) });
    const mission = await launch.json() as { missionId: string };
    const importUrl = await urlFor(server, `/api/missions/${mission.missionId}/google-trends-comparison-import`);
    const csv = "Week,desk cable organizer: (United States),under-desk cable tray: (United States),cable management box: (United States)\n2026-01-04,12,24,36";

    const imported = await fetch(importUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ csv }) });

    expect(imported.status).toBe(200);
    expect((await imported.json() as { events: Array<{ type: string }> }).events.slice(-3).map((event) => event.type)).toEqual(["GoogleTrendsComparisonImported", "FindingSubmitted", "MissionCompleted"]);
    expect((await fetch(importUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ csv }) })).status).toBe(409);
    const invalidRuntime = new LocalMissionRuntime({ dataRoot: await mkdtemp(join(tmpdir(), "dropscope-server-")), createMissionId: () => "invalid-comparison-mission" });
    const invalidServer = await listenLocalRuntimeServer(invalidRuntime);
    servers.push(invalidServer);
    await fetch(await urlFor(invalidServer, "/api/missions"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fixtureId: "google-trends-comparison-pilot" }) });
    expect((await fetch(await urlFor(invalidServer, "/api/missions/invalid-comparison-mission/google-trends-comparison-import"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ csv: "not a comparison export" }) })).status).toBe(400);
  });

  it("returns clean client errors and does not accept event-authoring requests", async () => {
    const runtime = new LocalMissionRuntime({ dataRoot: await mkdtemp(join(tmpdir(), "dropscope-server-")) });
    const server = await listenLocalRuntimeServer(runtime);
    servers.push(server);
    const base = await urlFor(server, "");

    const malformed = await fetch(`${base}/api/missions`, { method: "POST", body: "not-json" });
    expect(malformed.status).toBe(400);
    const authoring = await fetch(`${base}/api/missions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fixtureId: "evidence-drought", events: [] }) });
    expect(authoring.status).toBe(400);
    const unknown = await fetch(`${base}/api/unknown`);
    expect(unknown.status).toBe(404);
    const invalidMethod = await fetch(`${base}/api/missions`, { method: "PUT", body: "{}" });
    expect(invalidMethod.status).toBe(405);
    const missing = await fetch(`${base}/api/missions/missing-mission`);
    expect(missing.status).toBe(404);
  });

  it("supports loopback CORS, including default-port origins, and exposes no rebind API", async () => {
    const runtime = new LocalMissionRuntime({ dataRoot: await mkdtemp(join(tmpdir(), "dropscope-server-")), createMissionId: () => "cors-mission" });
    const server = await listenLocalRuntimeServer(runtime);
    servers.push(server);
    const base = await urlFor(server, "");
    const origin = "http://localhost:5173";

    const preflight = await fetch(`${base}/api/missions`, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(origin);
    const launch = await fetch(`${base}/api/missions`, { method: "POST", headers: { Origin: origin, "content-type": "application/json" }, body: JSON.stringify({ fixtureId: "evidence-drought" }) });
    expect(launch.status).toBe(201);
    expect(launch.headers.get("access-control-allow-origin")).toBe(origin);
    const defaultPort = await fetch(`${base}/api/missions`, { method: "OPTIONS", headers: { Origin: "http://localhost", "Access-Control-Request-Method": "POST" } });
    expect(defaultPort.status).toBe(204);
    expect(defaultPort.headers.get("access-control-allow-origin")).toBe("http://localhost");
    const foreign = await fetch(`${base}/api/missions`, { method: "POST", headers: { Origin: "https://example.com", "content-type": "application/json" }, body: JSON.stringify({ fixtureId: "evidence-drought" }) });
    expect(foreign.status).toBe(403);
    expect(server).not.toHaveProperty("listen");
  });

  it("reports an interrupted mission as a deliberate conflict", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "dropscope-server-"));
    const runtime = new LocalMissionRuntime({ dataRoot });
    const server = await listenLocalRuntimeServer(runtime);
    servers.push(server);
    const fs = await import("node:fs/promises");
    await fs.mkdir(join(dataRoot, "missions"));
    await fs.writeFile(join(dataRoot, "missions", "partial-mission.reserve"), JSON.stringify({ fixtureId: "mixed-opportunity-market" }), "utf8");
    await fs.writeFile(join(dataRoot, "missions", "partial-mission.jsonl"), '{"schemaVersion":', "utf8");

    const response = await fetch(await urlFor(server, "/api/missions/partial-mission"));
    expect(response.status).toBe(409);
  });

  it("reports corrupted reservation metadata as a deliberate conflict", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "dropscope-server-"));
    const runtime = new LocalMissionRuntime({ dataRoot });
    const server = await listenLocalRuntimeServer(runtime);
    servers.push(server);
    const fs = await import("node:fs/promises");
    await fs.mkdir(join(dataRoot, "missions"));
    await fs.writeFile(join(dataRoot, "missions", "partial-mission.reserve"), JSON.stringify({ fixtureId: "unknown-fixture" }), "utf8");

    const response = await fetch(await urlFor(server, "/api/missions/partial-mission"));
    expect(response.status).toBe(409);
  });
});
