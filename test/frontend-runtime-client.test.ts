import { describe, expect, it, vi } from "vitest";
import { captureGoogleTrends, confirmSubscriptionWorker, launchLocalMission, preflightSubscriptionRuntime, reloadLocalMission, runSubscriptionWorker, RuntimeClientError } from "../src/frontend/runtime-client.js";

const valid = { schemaVersion: 1, sequenceNumber: 1, missionId: "mission-1", eventId: "event-1", timestamp: "2026-01-01T00:00:00.000Z", type: "MissionCreated", payload: { totalBudget: 10, missionSeed: 1 } };
const dto = { missionId: "mission-1", fixtureId: "crosscurrent-workspace-market", events: [valid] };

describe("frontend runtime client", () => {
  it("posts launches to the fixed loopback API and validates DTOs", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(dto), { status: 201 }));
    await expect(launchLocalMission("crosscurrent-workspace-market")).resolves.toEqual(dto);
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8787/api/missions", expect.objectContaining({ method: "POST" }));
    fetchMock.mockRestore();
  });

  it("surfaces server errors and rejects malformed event DTOs", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "Mission launch incomplete: mission-1" }), { status: 409 }));
    await expect(reloadLocalMission("mission-1")).rejects.toMatchObject({ message: "Mission launch incomplete: mission-1", status: 409 });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ...dto, events: [{ nope: true }] }), { status: 200 }));
    await expect(reloadLocalMission("mission-1")).rejects.toBeInstanceOf(RuntimeClientError);
    fetchMock.mockRestore();
  });

  it("reports an unavailable local runtime clearly", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    await expect(reloadLocalMission("mission-1")).rejects.toThrow("Start it with npm run runtime:dev");
    fetchMock.mockRestore();
  });

  it("posts a subscription preflight only to the fixed loopback mission endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(dto), { status: 200 }));
    await expect(preflightSubscriptionRuntime("mission-1")).resolves.toEqual(dto);
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8787/api/missions/mission-1/subscription-preflight", expect.objectContaining({ method: "POST" }));
    fetchMock.mockRestore();
  });

  it("posts a confirmation request and accepts only its sanitized DTO", async () => {
    const confirmation = { missionId: "mission-1", attemptId: "pilot-evidence:a1", status: "CONFIRMED", expiresAtMs: 70_000 };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(confirmation), { status: 200 }));
    await expect(confirmSubscriptionWorker("mission-1")).resolves.toEqual(confirmation);
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8787/api/missions/mission-1/subscription-confirmation", expect.objectContaining({ method: "POST" }));
    fetchMock.mockRestore();
  });

  it("posts the final live-worker action only to the fixed loopback mission endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(dto), { status: 200 }));
    await expect(runSubscriptionWorker("mission-1")).resolves.toEqual(dto);
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8787/api/missions/mission-1/subscription-run", expect.objectContaining({ method: "POST" }));
    fetchMock.mockRestore();
  });

  it("posts the Google Trends capture only to its fixed loopback mission endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(dto), { status: 200 }));
    await expect(captureGoogleTrends("mission-1")).resolves.toEqual(dto);
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8787/api/missions/mission-1/google-trends-capture", expect.objectContaining({ method: "POST" }));
    fetchMock.mockRestore();
  });
});
