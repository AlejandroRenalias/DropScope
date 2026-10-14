import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { importTraceBytes } from "../src/run-import.js";
import { serializeRunLog } from "../src/run-store.js";

let viteServer: ViteDevServer;

test.beforeAll(async () => {
  viteServer = await createServer({ server: { host: "127.0.0.1", port: 5177 } });
  await viteServer.listen();
});

test.afterAll(async () => {
  await viteServer.close();
});

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.addStyleTag({ content: ".topbar { position: static !important; }" });
});

const demoTrace = () => new Uint8Array(readFileSync(new URL("../test/fixtures/demo-run-trace.json", import.meta.url)));

async function openRunReplay(page: Page) {
  if ((page.viewportSize()?.width ?? 1440) <= 760) {
    const toggle = page.getByRole("button", { name: /^Workspace/ });
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  }
  await page.getByRole("button", { name: "Mission Replay", exact: true }).click();
  await page.getByRole("button", { name: "Imported agent run" }).click();
  return page.getByRole("region", { name: "Agent run replay" });
}

const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test("shows the built-in demo run and keeps the mission replay one click away", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const replay = await openRunReplay(page);
  await expect(replay).toContainText("Event 42 / 42");
  await expect(replay).toContainText("Imported run · recorded replay");
  await expect(replay).toContainText("Content is withheld");
  await expect(page.locator(".run-source-card")).toContainText("Showing the built-in synthetic demo run.");
  // The mission's rails do not belong next to a run.
  await expect(page.getByRole("complementary", { name: "Mission status" })).toBeHidden();
  await page.getByRole("button", { name: "Mission history" }).click();
  await expect(page.getByRole("region", { name: "Mission Replay" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Mission state at this event" })).toBeVisible();
});

test("scrubbing rebuilds the recorded state, step by step", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const replay = await openRunReplay(page);
  const slider = replay.getByLabel("Timeline position");
  await slider.fill("1");
  await expect(replay).toContainText("Event 1 / 42");
  await expect(replay.getByRole("heading", { name: "Run imported" })).toBeVisible();
  await expect(replay.getByRole("region", { name: "Recorded state at this event" })).toContainText("0 running");

  await slider.fill("22");
  await expect(replay.getByRole("heading", { name: "Step failed" })).toBeVisible();
  await expect(replay.locator(".event-summary")).toContainText("Tool call: issue_refund ended with an error after 500 ms");
  await expect(replay.locator(".event-summary")).toContainText("withheld (");
  await expect(replay.locator(".deltas")).toContainText("Failed steps: 0 → 1");
  const failed = replay.locator(".rr-step.failed");
  await expect(failed).toHaveCount(1);
  await expect(failed).toContainText("Tool call: issue_refund");
  await expect(failed.locator(".rr-status")).toHaveText("Failed");
  await expect(replay.locator(".rr-step.not-started").first()).toContainText("Not started");

  await slider.fill("42");
  const state = replay.getByRole("region", { name: "Recorded state at this event" });
  await expect(state).toContainText("5,530 input");
  await expect(state).toContainText("785 output");
  await expect(state).toContainText("0 running");
  await expect(state).toContainText("1 failed");
  // No raw event names anywhere on the screen.
  await expect(replay).not.toContainText(/StepStarted|StepEnded|UsageRecorded|ContentRecorded|ImportNote|LLM_CALL|TOOL_CALL|gen_ai\./);
});

test("works from the keyboard and announces each position", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const replay = await openRunReplay(page);
  const slider = replay.getByLabel("Timeline position");
  await slider.fill("10");
  const current = replay.locator(".rr-ticks .tick.cur");
  await current.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(replay).toContainText("Event 9 / 42");
  await page.keyboard.press("Home");
  await expect(replay).toContainText("Event 1 / 42");
  await page.keyboard.press("End");
  await expect(replay).toContainText("Event 42 / 42");
  await expect(replay.locator("[aria-live=polite]")).toContainText("Event 42 of 42: Run ends");
  await replay.getByRole("button", { name: "Steps" }).click();
  await expect(replay.getByRole("button", { name: "Steps" })).toHaveAttribute("aria-pressed", "false");
});

test("jumps to a step or a note from the lists", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const replay = await openRunReplay(page);
  await replay.getByRole("button", { name: /Go to the start of Agent: qa-reviewer/ }).click();
  await expect(replay.getByRole("heading", { name: "Agent started" })).toBeVisible();
  await replay.getByRole("button", { name: /Go to event \d+/ }).first().click();
  await expect(replay.getByRole("heading", { name: /^Importer note:/ })).toBeVisible();
});

test("opens a run file the import command saved, in the browser", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const replay = await openRunReplay(page);
  const full = serializeRunLog(importTraceBytes({ spans: demoTrace(), contentMode: "FULL" }));
  await page.locator(".file-button input").setInputFiles({ name: "stored.runlog.jsonl", mimeType: "text/plain", buffer: Buffer.from(full) });
  await expect(page.locator(".run-source-card")).toContainText("Run file stored.runlog.jsonl.");
  await expect(replay).toContainText("Content is stored as written");
  await replay.getByLabel("Timeline position").fill("3");
  await expect(replay).toContainText("Customer asks for a refund for order 1042");
  await page.getByRole("button", { name: "Back to the demo run" }).click();
  await expect(page.locator(".run-source-card")).toContainText("Showing the built-in synthetic demo run.");
});

test("refuses broken and tampered files with a sentence that never repeats their content", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRunReplay(page);
  const input = page.locator(".file-button input");
  await input.setInputFiles({ name: "junk.txt", mimeType: "text/plain", buffer: Buffer.from("SECRET-JUNK-TEXT not json\n") });
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("not a valid DropScope run file");
  await expect(alert).not.toContainText("SECRET-JUNK-TEXT");

  const hashed = Buffer.from(serializeRunLog(importTraceBytes({ spans: demoTrace() })));
  const lines = hashed.toString("utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  lines.find((l) => l.type === "StepStarted").payload.name = { v: { t: "s", v: "LEAKED-NAME" } };
  const { canonicalJson } = await import("../src/canonical.js");
  const tampered = `${lines.map((l) => canonicalJson(l)).join("\n")}\n`;
  await input.setInputFiles({ name: "tampered.runlog.jsonl", mimeType: "text/plain", buffer: Buffer.from(tampered) });
  await expect(alert).toContainText("changed after it was saved");
  await expect(alert).not.toContainText("LEAKED-NAME");
  // The demo run is still on screen.
  await expect(page.getByRole("region", { name: "Agent run replay" })).toContainText("Event 42 / 42");
});

test("stays usable on a run with thousands of steps", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const replay = await openRunReplay(page);
  const T = "1".repeat(32);
  const spans = Array.from({ length: 3000 }, (_, i) => ({
    traceId: T, spanId: (i + 1).toString(16).padStart(16, "0"), name: "n", startTimeUnixNano: String(1000 + i * 10), endTimeUnixNano: String(1015 + i * 10),
    attributes: [{ key: "gen_ai.operation.name", value: { stringValue: "chat" } }, { key: "gen_ai.usage.input_tokens", value: { intValue: "5" } }],
  }));
  const big = serializeRunLog(importTraceBytes({ spans: new TextEncoder().encode(JSON.stringify({ resourceSpans: [{ scopeSpans: [{ spans }] }] })) }));
  await page.locator(".file-button input").setInputFiles({ name: "big.runlog.jsonl", mimeType: "text/plain", buffer: Buffer.from(big) });
  await expect(replay).toContainText("Event 12003 / 12003", { timeout: 30_000 });
  await expect(replay.locator(".rr-hidden-note").first()).toContainText("Showing");
  const rows = await replay.locator(".rr-step").count();
  expect(rows).toBeGreaterThan(0);
  expect(rows).toBeLessThan(400);
  await expect(replay.locator(".rr-note-list li")).toHaveCount(100);
  const slider = replay.getByLabel("Timeline position");
  const started = Date.now();
  await slider.fill("6000");
  await expect(replay.getByRole("region", { name: "Recorded state at this event" })).toContainText("tokens", { ignoreCase: true });
  await slider.fill("1");
  await expect(replay).toContainText("Event 1 /");
  expect(Date.now() - started).toBeLessThan(10_000);
  expect(await replay.locator(".rr-ticks .tick").count()).toBeLessThanOrEqual(120);
  expect(await noOverflow(page)).toBe(true);
});

for (const width of [1440, 768, 375]) {
  test(`has no horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const replay = await openRunReplay(page);
    await replay.getByLabel("Timeline position").fill("22");
    await expect(replay.getByRole("heading", { name: "Step failed" })).toBeVisible();
    expect(await noOverflow(page)).toBe(true);
  });
}
