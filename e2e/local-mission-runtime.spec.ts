import { test, expect } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { listenLocalRuntimeServer, type LocalRuntimeServerHandle } from "../src/local-runtime-server.js";
import { LocalMissionRuntime } from "../src/runtime/local-mission-runtime.js";

let runtimeServer: LocalRuntimeServerHandle;
let viteServer: ViteDevServer;

test.beforeAll(async () => {
  runtimeServer = await listenLocalRuntimeServer(
    new LocalMissionRuntime({ dataRoot: await mkdtemp(join(tmpdir(), "dropscope-e2e-")) }),
    { port: 8791 },
  );
  process.env.VITE_LOCAL_RUNTIME_BASE_URL = "http://127.0.0.1:8791";
  viteServer = await createServer({ server: { host: "127.0.0.1", port: 5177 } });
  await viteServer.listen();
});

test.afterAll(async () => {
  await Promise.all([viteServer.close(), runtimeServer.close()]);
});

test("launches, preserves retry evidence, reloads, and replays the local mission", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Synthetic demo fallback")).toBeVisible();

  await page.getByRole("button", { name: "Launch local mission" }).click();
  await expect(page.getByRole("status")).toContainText("Mission crosscurrent-workspace-market-");
  await expect(page.getByRole("status")).toContainText("launched and persisted");
  await expect(page.getByText("Local event history")).toBeVisible();

  await page.getByRole("button", { name: "Agent Desk" }).click();
  const agentDesk = page.getByRole("region", { name: "Agent Desk" });
  await expect(agentDesk).toContainText("Mission usage summary · recorded dry-run provenance");
  await expect(agentDesk).toContainText("Recorded dry-run count: 1");
  await expect(agentDesk).toContainText("Recorded dry-run provider usage: not applicable · other attempt provenance: 4 not recorded");
  await expect(agentDesk).toContainText("Mission ledger: 140 total · 0 reserved · 0 committed · 130 spent · 10 available");
  await expect(agentDesk).toContainText("Recorded dry-run · no live worker or credits used");

  await page.getByRole("button", { name: "Mission Replay" }).click();
  await expect(page.getByRole("region", { name: "Mission Replay" }).getByText(/Persisted local mission/)).toBeVisible();
  await expect(page.getByText("TaskFailedTransient", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Tribunal Room" }).click();
  await expect(page.getByRole("region", { name: "Tribunal Room" })).toContainText("deskflow-alpha");
  await page.getByRole("button", { name: "Review Office" }).click();
  await expect(page.getByRole("region", { name: "Review Office" })).toContainText("REVISE");
  await expect(page.getByRole("region", { name: "Review Office" })).toContainText("Focused re-review returned accept");
  await page.getByRole("button", { name: "Mission Replay" }).click();
  await expect(page.getByText(/Event 34 \/ 34/)).toBeVisible();
  await expect(page.getByText("MissionCompleted", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("status")).toContainText("Reloaded persisted local mission");
  await page.getByRole("button", { name: "Mission Replay" }).click();
  await expect(page.getByRole("region", { name: "Mission Replay" }).getByText(/Persisted local mission/)).toBeVisible();
  await expect(page.getByText(/Event 34 \/ 34/)).toBeVisible();
});
