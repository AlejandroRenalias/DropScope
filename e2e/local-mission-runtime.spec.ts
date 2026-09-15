import { test, expect } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { listenLocalRuntimeServer, type LocalRuntimeServerHandle } from "../src/local-runtime-server.js";
import { LocalMissionRuntime } from "../src/runtime/local-mission-runtime.js";
import type { SubscriptionPreflightResult } from "../src/subscription-runtime-preflight.js";

let runtimeServer: LocalRuntimeServerHandle;
let viteServer: ViteDevServer;
let preflightChecks = 0;
let resolvePreflight: (() => void) | undefined;
let nextPreflightResult: SubscriptionPreflightResult = { accessStatus: "CHATGPT_AUTHENTICATED", diagnosticCode: "NOT_APPLICABLE" };

test.beforeAll(async () => {
  runtimeServer = await listenLocalRuntimeServer(
    new LocalMissionRuntime({ dataRoot: await mkdtemp(join(tmpdir(), "dropscope-e2e-")), subscriptionRuntimePreflight: { check: () => new Promise((resolve) => { preflightChecks += 1; resolvePreflight = () => resolve(nextPreflightResult); }) }, subscriptionLiveWorkerRunner: { run: async (request) => ({ taskId: request.taskId, attemptId: request.attemptId, status: "COMPLETED" as const, finding: "Fixed browser pilot finding." }) }, googleTrendsSource: { capture: async () => ({ sourceUrl: "https://trends.google.com/trending/rss?geo=US" as const, geo: "US" as const, attribution: "Google Trends" as const, items: [{ query: "Desk lamps", traffic: "20K+" }] }) } }),
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
  await expect(agentDesk).toContainText("Subscription runtime · guarded pilot");
  await expect(agentDesk).toContainText("Local subscription access not checked.");
  await expect(agentDesk).toContainText("Subscription usage not itemized.");
  await expect(agentDesk).toContainText("First live worker · approval required");
  await expect(agentDesk).toContainText("One fresh thread · one turn · 90-second maximum · inline fixed pilot evidence · read-only mode · network denied · no retry.");
  await expect(agentDesk).toContainText("Confirmation is one-use, stays only in local runtime memory, and expires after 60 seconds.");
  await expect(agentDesk).toContainText("Any command, file-change, or permission request is automatically declined and ends the run.");
  expect(preflightChecks).toBe(0);
  await page.getByRole("button", { name: "Check subscription runtime" }).click();
  await expect.poll(() => preflightChecks).toBe(1);
  await expect(page.getByRole("button", { name: "Launch local mission" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Reload saved mission" })).toBeDisabled();
  resolvePreflight?.();
  await expect(page.getByRole("status")).toContainText("Subscription runtime check recorded. No worker was started.");
  await expect(agentDesk).toContainText("Local ChatGPT authentication detected. This does not authorize a worker run.");
  expect(preflightChecks).toBe(1);

  await page.getByRole("button", { name: "Mission Replay" }).click();
  await expect(page.getByRole("region", { name: "Mission Replay" }).getByText(/Persisted local mission/)).toBeVisible();
  await expect(page.getByText("TaskFailedTransient", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Tribunal Room" }).click();
  await expect(page.getByRole("region", { name: "Tribunal Room" })).toContainText("deskflow-alpha");
  await page.getByRole("button", { name: "Review Office" }).click();
  await expect(page.getByRole("region", { name: "Review Office" })).toContainText("REVISE");
  await expect(page.getByRole("region", { name: "Review Office" })).toContainText("Focused re-review returned accept");
  await page.getByRole("button", { name: "Mission Replay" }).click();
  await expect(page.getByText(/Event 36 \/ 36/)).toBeVisible();
  await expect(page.getByText("MissionCompleted", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("status")).toContainText("Reloaded the browser-saved local mission");
  await page.getByRole("button", { name: "Mission Replay" }).click();
  await expect(page.getByRole("region", { name: "Mission Replay" }).getByText(/Persisted local mission/)).toBeVisible();
  await expect(page.getByText(/Event 36 \/ 36/)).toBeVisible();
});

test("runs the isolated live-worker pilot through the injected safe browser fake", async ({ page }) => {
  nextPreflightResult = { accessStatus: "CHATGPT_AUTHENTICATED", diagnosticCode: "NOT_APPLICABLE" };
  await page.goto("/");
  await page.locator("#fixture-select").selectOption("live-worker-pilot");
  await page.getByRole("button", { name: "Launch local mission" }).click();
  await expect(page.getByRole("status")).toContainText("Mission live-worker-pilot-");

  await page.getByRole("button", { name: "Agent Desk" }).click();
  const agentDesk = page.getByRole("region", { name: "Agent Desk" });
  await expect(agentDesk).toContainText("Subscription runtime · guarded pilot");
  await expect(agentDesk).toContainText("First live worker · approval required");
  await expect(agentDesk).toContainText("Any command, file-change, or permission request is automatically declined and ends the run.");
  await expect(agentDesk.getByRole("button", { name: "Run one live worker now" })).toBeDisabled();
  expect(preflightChecks).toBe(1);

  await page.getByRole("button", { name: "Check subscription runtime" }).click();
  await expect.poll(() => preflightChecks).toBe(2);
  resolvePreflight?.();
  await expect(page.getByRole("status")).toContainText("Subscription runtime check recorded. No worker was started.");
  await expect(agentDesk.getByRole("button", { name: "Confirm one live worker" })).toBeEnabled();
  await agentDesk.getByRole("button", { name: "Confirm one live worker" }).click();
  await expect(page.locator("span.runtime-message[role=status]")).toContainText("Local confirmation recorded in memory. No worker was started.");
  await expect(agentDesk).toContainText("Confirmation status: confirmed locally · expires at");
  await expect(agentDesk.getByRole("button", { name: "Run one live worker now" })).toBeEnabled();
  await agentDesk.getByRole("button", { name: "Run one live worker now" }).click();
  await expect(page.locator("span.runtime-message[role=status]")).toContainText("One live worker finished and its closed outcome was recorded.");
  await expect(agentDesk).toContainText("Last subscription worker outcome: COMPLETED · provider usage unknown");

  await page.getByRole("button", { name: "Mission Replay" }).click();
  const replay = page.getByRole("region", { name: "Mission Replay" });
  await expect(replay).toContainText("Event 10 / 10");
  await expect(replay.getByText("SubscriptionWorkerExecutionOutcomeRecorded", { exact: true })).toBeVisible();
  await expect(replay.getByText("MissionCompleted", { exact: true })).toBeVisible();
});

test("captures Google Trends only after the explicit browser action, then reloads its persisted evidence", async ({ page }) => {
  await page.goto("/");
  await page.locator("#fixture-select").selectOption("google-trends-pilot");
  await page.getByRole("button", { name: "Launch local mission" }).click();
  await page.getByRole("button", { name: "Agent Desk" }).click();
  const agentDesk = page.getByRole("region", { name: "Agent Desk" });
  await expect(agentDesk).toContainText("Google Trends · read-only public-source pilot");
  await expect(agentDesk).toContainText("No login, worker, retry, or subscription usage.");
  await agentDesk.getByRole("button", { name: "Capture Google Trends US now" }).click();
  await expect(page.getByRole("status")).toContainText("Google Trends capture outcome and evidence were recorded locally.");
  await expect(agentDesk).toContainText("Desk lamps (20K+)");
  await page.getByRole("button", { name: "Mission Replay" }).click();
  const replay = page.getByRole("region", { name: "Mission Replay" });
  await expect(replay).toContainText("Event 8 / 8");
  await expect(replay.getByText("GoogleTrendsEvidenceCaptured", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("status")).toContainText("Reloaded the browser-saved local mission");
  await page.getByRole("button", { name: "Agent Desk" }).click();
  await expect(page.getByRole("region", { name: "Agent Desk" })).toContainText("Desk lamps (20K+)");
});

test("replays a safe account-read timeout diagnostic without starting a worker", async ({ page }) => {
  nextPreflightResult = { accessStatus: "UNAVAILABLE", diagnosticCode: "ACCOUNT_READ_TIMED_OUT" };
  await page.goto("/");
  await page.locator("#fixture-select").selectOption("live-worker-pilot");
  await page.getByRole("button", { name: "Launch local mission" }).click();
  await page.getByRole("button", { name: "Agent Desk" }).click();
  const agentDesk = page.getByRole("region", { name: "Agent Desk" });

  await page.getByRole("button", { name: "Check subscription runtime" }).click();
  await expect.poll(() => preflightChecks).toBe(3);
  resolvePreflight?.();

  await expect(page.getByRole("status")).toContainText("Subscription runtime check recorded. No worker was started.");
  await expect(agentDesk).toContainText("Codex app-server started, but did not return account status within 10 seconds. No worker was started.");
  await expect(agentDesk.getByRole("button", { name: "Confirm one live worker" })).toBeDisabled();
  await expect(agentDesk.getByRole("button", { name: "Run one live worker now" })).toBeDisabled();
});

test("replays an app-server initialization exit without starting a worker", async ({ page }) => {
  nextPreflightResult = { accessStatus: "UNAVAILABLE", diagnosticCode: "APP_SERVER_EXITED_DURING_INITIALIZATION" };
  await page.goto("/");
  await page.locator("#fixture-select").selectOption("live-worker-pilot");
  await page.getByRole("button", { name: "Launch local mission" }).click();
  await page.getByRole("button", { name: "Agent Desk" }).click();
  const agentDesk = page.getByRole("region", { name: "Agent Desk" });

  await page.getByRole("button", { name: "Check subscription runtime" }).click();
  await expect.poll(() => preflightChecks).toBe(4);
  resolvePreflight?.();

  await expect(agentDesk).toContainText("Codex app-server exited before replying to DropScope's setup request. No worker was started.");
  await expect(agentDesk.getByRole("button", { name: "Confirm one live worker" })).toBeDisabled();
  await expect(agentDesk.getByRole("button", { name: "Run one live worker now" })).toBeDisabled();
});
