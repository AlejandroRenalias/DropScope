import { test, expect, type Page } from "@playwright/test";
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
const comparisonCsv = "Category: All categories\nWeek,desk cable organizer: (United States),under-desk cable tray: (United States),cable management box: (United States)\n2026-01-04,12,24,36\n2026-01-11,18,30,42";

async function openMissionControls(page: Page) {
  const trigger = page.getByRole("button", { name: "Mission controls" });
  if (await trigger.getAttribute("aria-expanded") !== "true") await trigger.click();
}

test.beforeAll(async () => {
  runtimeServer = await listenLocalRuntimeServer(
    new LocalMissionRuntime({ dataRoot: await mkdtemp(join(tmpdir(), "dropscope-e2e-")), subscriptionRuntimePreflight: { check: () => new Promise((resolve) => { preflightChecks += 1; resolvePreflight = () => resolve(nextPreflightResult); }) }, subscriptionLiveWorkerRunner: { run: async (request) => ({ taskId: request.taskId, attemptId: request.attemptId, status: "COMPLETED" as const, finding: "Fixed browser pilot finding." }) }, googleTrendsSource: { capture: async () => ({ sourceUrl: "https://trends.google.com/trending/rss?geo=US" as const, geo: "US" as const, attribution: "Google Trends" as const, items: [{ query: "Desk lamps", traffic: "20K+" }] }) } }),
    { port: 8791, trustedUiOrigin: "http://127.0.0.1:5177" },
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
  await expect(page.locator(".source-label")).toHaveText("Synthetic demo · recorded replay");
  await openMissionControls(page);
  const firstMissionSetup = page.getByRole("region", { name: "First mission setup" });
  await expect(firstMissionSetup).toContainText("Record a mission before you inspect it.");
  await expect(firstMissionSetup).toContainText("npm.cmd run runtime:dev");
  await expect(firstMissionSetup).toContainText("Launching a fixture does not start a live worker or use a subscription.");
  await openMissionControls(page);

  await page.getByRole("button", { name: "Launch local mission" }).click();
  await expect(page.getByRole("status")).toContainText("Mission crosscurrent-workspace-market-");
  await expect(page.getByRole("status")).toContainText("launched and persisted");
  await expect(page.locator(".source-label")).toHaveText("Synthetic demo · recorded replay");

  await page.getByRole("button", { name: "Inspect evidence" }).click();
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
  await openMissionControls(page);
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
  await expect(page.locator(".replay-chronology").getByText("Task failed transient", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Tribunal Room" }).click();
  await expect(page.getByRole("region", { name: "Tribunal Room" })).toContainText("deskflow-alpha");
  await page.getByRole("button", { name: "Review Office" }).click();
  await expect(page.getByRole("region", { name: "Review Office" })).toContainText("REVISE");
  await expect(page.getByRole("region", { name: "Review Office" })).toContainText("Focused re-review returned accept");
  await page.getByRole("button", { name: "Mission Replay" }).click();
  await expect(page.getByRole("region", { name: "Mission Replay" }).getByText(/Event 36 \/ 36/)).toBeVisible();
  await expect(page.locator(".replay-chronology").getByText("Mission completed", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("status")).toContainText("Reloaded the browser-saved local mission");
  await page.getByRole("button", { name: "Mission Replay" }).click();
  await expect(page.getByRole("region", { name: "Mission Replay" }).getByText(/Persisted local mission/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Mission Replay" }).getByText(/Event 36 \/ 36/)).toBeVisible();
});

test("runs the isolated live-worker pilot through the injected safe browser fake", async ({ page }) => {
  nextPreflightResult = { accessStatus: "CHATGPT_AUTHENTICATED", diagnosticCode: "NOT_APPLICABLE" };
  await page.goto("/");
  await openMissionControls(page);
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
  await expect(replay.locator(".replay-chronology").getByText("Subscription worker execution outcome recorded", { exact: true })).toBeVisible();
  await expect(replay.locator(".replay-chronology").getByText("Mission completed", { exact: true })).toBeVisible();
});

test("captures Google Trends only after the explicit browser action, then reloads its persisted evidence", async ({ page }) => {
  await page.goto("/");
  await openMissionControls(page);
  await page.locator("#fixture-select").selectOption("google-trends-pilot");
  await page.getByRole("button", { name: "Launch local mission" }).click();
  await page.getByRole("button", { name: "Agent Desk" }).click();
  const agentDesk = page.getByRole("region", { name: "Agent Desk" });
  await expect(agentDesk).toContainText("Google Trends · read-only public-source pilot");
  await expect(agentDesk).toContainText("No login, worker, retry, or subscription usage.");
  await agentDesk.getByRole("button", { name: "Capture Google Trends US now" }).click();
  await expect(page.getByRole("status")).toContainText("Google Trends capture outcome and evidence were recorded locally.");
  await expect(agentDesk).toContainText("Desk lamps (20K+)");
  await expect(agentDesk).toContainText("https://trends.google.com/trending/rss?geo=US");
  await expect(agentDesk).toContainText("attribution: Google Trends.");
  await page.getByRole("button", { name: "Mission Replay" }).click();
  const replay = page.getByRole("region", { name: "Mission Replay" });
  await expect(replay).toContainText("Event 8 / 8");
  await expect(replay.locator(".replay-chronology").getByText("Google trends evidence captured", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Final Report", exact: true }).click();
  const finalReport = page.getByRole("region", { name: "Final Report" });
  await expect(finalReport).toContainText("External signal context · not scored");
  await expect(finalReport).toContainText("It does not change any score, ranking, gate, or recommendation");
  await expect(finalReport).toContainText("Desk lamps · 20K+");
  await page.reload();
  await expect(page.getByRole("status")).toContainText("Reloaded the browser-saved local mission");
  await page.getByRole("button", { name: "Agent Desk" }).click();
  await expect(page.getByRole("region", { name: "Agent Desk" })).toContainText("Desk lamps (20K+)");
  await expect(page.getByRole("region", { name: "Agent Desk" })).toContainText("https://trends.google.com/trending/rss?geo=US");
});

test("imports one selected Google Trends comparison CSV as replayed unscored context", async ({ page }) => {
  await page.goto("/");
  await openMissionControls(page);
  await page.locator("#fixture-select").selectOption("google-trends-comparison-pilot");
  await page.getByRole("button", { name: "Launch local mission" }).click();
  await page.getByRole("button", { name: "Agent Desk" }).click();
  const agentDesk = page.getByRole("region", { name: "Agent Desk" });
  await expect(agentDesk).toContainText("Google Trends · manual comparison context");
  await expect(agentDesk).toContainText("DropScope never contacts Google, stores the raw CSV, runs a worker, retries, polls, or uses a subscription.");
  await agentDesk.getByLabel("Choose Google Trends comparison CSV").setInputFiles({ name: "google-trends-comparison.csv", mimeType: "text/csv", buffer: Buffer.from(comparisonCsv) });
  await expect(page.getByRole("status")).toContainText("Google Trends comparison context was imported locally. The raw CSV was not stored.");
  await expect(agentDesk).toContainText("Imported week timeline: 2 periods · US · Google Trends");
  await expect(agentDesk.getByRole("figure", { name: /Google Trends comparison timeline/ })).toBeVisible();
  await expect(agentDesk).toContainText("desk cable organizer");
  await expect(agentDesk).toContainText("under-desk cable tray");
  await expect(agentDesk).toContainText("cable management box");
  await page.getByRole("button", { name: "Mission Replay" }).click();
  const replay = page.getByRole("region", { name: "Mission Replay" });
  await expect(replay).toContainText("Event 8 / 8");
  await expect(replay.locator(".replay-chronology").getByText("Google trends comparison imported", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Final Report", exact: true }).click();
  const finalReport = page.getByRole("region", { name: "Final Report" });
  await expect(finalReport).toContainText("Manual comparison context · not scored");
  await expect(finalReport).toContainText("It does not change any score, ranking, gate, or recommendation");
  await expect(finalReport).toContainText("desk cable organizer · 2 normalized points");
  await expect(finalReport.getByRole("figure", { name: /Google Trends comparison timeline/ })).toBeVisible();
  await expect(finalReport).toContainText("2 week periods · context only · not scored");
  await page.reload();
  await expect(page.getByRole("status")).toContainText("Reloaded the browser-saved local mission");
  await page.getByRole("button", { name: "Agent Desk" }).click();
  await expect(page.getByRole("region", { name: "Agent Desk" })).toContainText("Imported week timeline: 2 periods · US · Google Trends");
});

test("replays the fixed Failure Autopsy through the shared local mission runtime", async ({ page }) => {
  await page.goto("/");
  await openMissionControls(page);
  await page.locator("#fixture-select").selectOption("failure-autopsy-pilot");
  await page.getByRole("button", { name: "Launch local mission" }).click();
  await page.getByRole("button", { name: "Mission Replay" }).click();
  const replay = page.getByRole("region", { name: "Mission Replay" });
  await expect(replay).toContainText("Mission mode declared");
  await expect(replay).toContainText("Mission terminated");
  await page.getByRole("button", { name: "Tribunal Room" }).click();
  await expect(page.getByRole("region", { name: "Tribunal Room" })).toContainText("STOP");
  await page.getByRole("button", { name: "Final Report", exact: true }).click();
  const finalReport = page.getByRole("region", { name: "Final Report" });
  await expect(finalReport).toContainText("Failure Autopsy");
  await expect(finalReport).toContainText("What would change this conclusion");
  await expect(finalReport).toContainText("STOP: the fixed concept does not clear evidence or safety gates.");
});

test("replays Product Investigation with automatic Failure Autopsy pressure", async ({ page }) => {
  await page.goto("/");
  await openMissionControls(page);
  await page.locator("#fixture-select").selectOption("product-investigation-pilot");
  await page.getByRole("button", { name: "Launch local mission" }).click();
  await page.getByRole("button", { name: "Tribunal Room" }).click();
  await expect(page.getByRole("region", { name: "Tribunal Room" })).toContainText("CAUTION");
  await page.getByRole("button", { name: "Final Report", exact: true }).click();
  const finalReport = page.getByRole("region", { name: "Final Report" });
  await expect(finalReport).toContainText("Product Investigation");
  await expect(finalReport).toContainText("modular-desk-organizer");
  await expect(finalReport).toContainText("Automatic failure-autopsy pressure");
  await expect(finalReport).toContainText("CAUTION: the fixed priority remains eligible");
});

test("replays a safe account-read timeout diagnostic without starting a worker", async ({ page }) => {
  nextPreflightResult = { accessStatus: "UNAVAILABLE", diagnosticCode: "ACCOUNT_READ_TIMED_OUT" };
  await page.goto("/");
  await openMissionControls(page);
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
  await openMissionControls(page);
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
