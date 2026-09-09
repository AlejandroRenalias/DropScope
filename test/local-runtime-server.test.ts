import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { listenLocalRuntimeServer } from "../src/local-runtime-server.js";
import { LocalMissionRuntime } from "../src/runtime/local-mission-runtime.js";

const servers: Array<ReturnType<typeof listenLocalRuntimeServer> extends Promise<infer T> ? T : never> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))));
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

  it("supports loopback CORS and rejects public origins and hosts", async () => {
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
    const foreign = await fetch(`${base}/api/missions`, { method: "POST", headers: { Origin: "https://example.com", "content-type": "application/json" }, body: JSON.stringify({ fixtureId: "evidence-drought" }) });
    expect(foreign.status).toBe(403);

    await expect(listenLocalRuntimeServer(runtime, { host: "0.0.0.0" })).rejects.toThrow("loopback hosts");
  });
});
