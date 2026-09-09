import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LocalMissionRuntime } from "../src/runtime/local-mission-runtime.js";

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
});
