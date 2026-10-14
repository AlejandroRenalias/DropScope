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

test.describe("run diff", () => {
  test("asks for a second run first and says what a difference means", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const replay = await openRunReplay(page);
    const panel = replay.getByRole("region", { name: "Compare with another run" });
    await expect(panel).toContainText("A difference means the recordings differ, not that either run is right");
    await expect(panel).toContainText("sent nowhere");
    await expect(panel).toContainText("Choose a second run to compare");
    await expect(panel.getByRole("button", { name: "Clear run B" })).toBeDisabled();
  });

  test("the demo kept with content and the demo kept as fingerprints only are the same recording", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const replay = await openRunReplay(page);
    const panel = replay.getByRole("region", { name: "Compare with another run" });
    await panel.getByRole("button", { name: "Compare with the demo run kept with content" }).click();
    await expect(panel.locator(".cc-summary")).toContainText("the runs match step for step");
    await expect(panel.locator(".rd-differs")).toHaveCount(0);
    await expect(panel.locator(".rd-row.rd-changed, .rd-row.rd-onlyA, .rd-row.rd-onlyB")).toHaveCount(0);
    await expect(panel.locator(".rd-fold")).toContainText("Show 10 steps that match in both runs");
    await panel.getByText("What this does and does not tell you").click();
    await expect(panel.locator(".bp-caveats[open]")).toContainText("compared by fingerprint");
  });

  test("shows where the demo and its variant first differ, and jumps to that event in run A", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const replay = await openRunReplay(page);
    const panel = replay.getByRole("region", { name: "Compare with another run" });
    await panel.getByRole("button", { name: "Compare with the demo variant" }).click();
    await expect(panel.locator(".cc-summary")).toContainText("the runs first differ at step 7");
    await expect(panel.locator(".rd-counts")).toContainText("changed: 2; only in A: 0; only in B: 0");
    // Matching steps are folded: 6 before the first difference, 2 between the differences.
    await expect(panel.locator(".rd-fold")).toHaveCount(2);
    await expect(panel.locator(".rd-fold").first()).toContainText("Show 6 steps that match in both runs");
    await expect(panel.locator(".rd-fold").nth(1)).toContainText("Show 2 steps that match in both runs");
    await expect(panel.locator(".rd-row.rd-same")).toHaveCount(0);
    await expect(panel.locator(".rd-row.rd-changed")).toHaveCount(2);
    const first = panel.locator(".rd-row.rd-first");
    await expect(first).toContainText("First difference");
    await expect(first.locator(".rd-chip")).toHaveText("Changed");
    await expect(first).toContainText("Tool call: issue_refund");
    await expect(first).toContainText("Failed in B, succeeded in A");
    await expect(first.locator(".rd-why")).toHaveAttribute("title", /it succeeded in run A but failed in run B/);
    await expect(first.locator(".rd-tag")).toHaveText("failed");
    await expect(panel.locator(".rd-row.rd-changed").nth(1)).toContainText("Input tokens 2,010 → 2,190");
    await panel.locator(".rd-fold").first().click();
    await expect(panel.locator(".rd-fold").first()).toContainText("Hide 6 steps that match in both runs");
    await expect(panel.locator(".rd-row.rd-same")).toHaveCount(6);
    await panel.locator(".rd-fold").first().click();
    await expect(panel.locator(".rd-row.rd-same")).toHaveCount(0);
    const failed = panel.locator(".rd-totals tr", { hasText: "Failed steps" });
    await expect(failed.locator("td").nth(0)).toHaveText("1");
    await expect(failed.locator("td").nth(1)).toHaveText("2");
    await expect(panel.locator(".rd-totals tr", { hasText: "Time" })).not.toHaveClass(/rd-differs/);
    await expect(replay.locator(".replay-position")).toContainText("Event 42 / 42");
    await first.getByRole("button", { name: "Go to event 24" }).click();
    await expect(replay.locator(".replay-position")).toContainText("Event 24 / 42");
    await expect(replay.locator(".event-card")).toContainText("Tool call: issue_refund");
    await panel.getByRole("button", { name: "Clear run B" }).click();
    await expect(panel.locator(".cc-summary")).toHaveCount(0);
  });

  test("compares against a run file you open, and refuses a file that is not a run", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const replay = await openRunReplay(page);
    const panel = replay.getByRole("region", { name: "Compare with another run" });
    const T = "2".repeat(32);
    const trace = { resourceSpans: [{ resource: { attributes: [] }, scopeSpans: [{ scope: { name: "t" }, spans: [{
      traceId: T, spanId: "00000000000000b1", name: "only tool", startTimeUnixNano: "1000000000", endTimeUnixNano: "2000000000",
      attributes: [{ key: "gen_ai.operation.name", value: { stringValue: "execute_tool" } }, { key: "gen_ai.tool.name", value: { stringValue: "weather" } }],
    }] }] }] };
    const bytes = serializeRunLog(importTraceBytes({ spans: new TextEncoder().encode(JSON.stringify(trace)) }));
    const input = panel.locator(".cc-file-button input");
    await input.setInputFiles({ name: "other.runlog.jsonl", mimeType: "application/x-ndjson", buffer: Buffer.from(bytes) });
    await expect(panel.locator(".rd-who").first()).toContainText("Run B: Run file other.runlog.jsonl");
    await expect(panel.locator(".cc-summary")).toContainText("the runs first differ");
    await expect(panel.locator(".rd-onlyA").first()).toContainText("No matching step in run B");
    await input.setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
    await expect(panel.getByRole("alert")).toContainText("not a valid DropScope run file");
    // The earlier comparison stays; a bad file does not replace it.
    await expect(panel.locator(".cc-summary")).toContainText("the runs first differ");
  });

  test("shows run titles as plain text", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const replay = await openRunReplay(page);
    const panel = replay.getByRole("region", { name: "Compare with another run" });
    const T = "3".repeat(32);
    const trace = { resourceSpans: [{ resource: { attributes: [] }, scopeSpans: [{ scope: { name: "t" }, spans: [{
      traceId: T, spanId: "00000000000000c1", name: "x", startTimeUnixNano: "1000000000", endTimeUnixNano: "2000000000",
      attributes: [{ key: "gen_ai.operation.name", value: { stringValue: "execute_tool" } }, { key: "gen_ai.tool.name", value: { stringValue: "<img src=x onerror=alert(1)>" } }],
    }] }] }] };
    const bytes = serializeRunLog(importTraceBytes({ spans: new TextEncoder().encode(JSON.stringify(trace)), contentMode: "FULL" }));
    await panel.locator(".cc-file-button input").setInputFiles({ name: "html.runlog.jsonl", mimeType: "application/x-ndjson", buffer: Buffer.from(bytes) });
    await expect(panel.locator(".rd-steps")).toContainText("<img src=x onerror=alert(1)>");
    await expect(panel.locator(".rd-steps img, .rd-steps b")).toHaveCount(0);
  });

  test("fits a phone screen", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const replay = await openRunReplay(page);
    const panel = replay.getByRole("region", { name: "Compare with another run" });
    await panel.getByRole("button", { name: "Compare with the demo variant" }).click();
    await expect(panel.locator(".rd-totals")).toBeVisible();
    expect(await noOverflow(page)).toBe(true);
  });

  test("looks the same as its approved picture", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const replay = await openRunReplay(page);
    const panel = replay.getByRole("region", { name: "Compare with another run" });
    await panel.getByRole("button", { name: "Compare with the demo variant" }).click();
    await expect(panel.locator(".rd-totals")).toBeVisible();
    await expect(panel).toHaveScreenshot("run-diff-panel.png", { animations: "disabled" });
  });

  test("looks the same with steps that exist in only one run", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const replay = await openRunReplay(page);
    const panel = replay.getByRole("region", { name: "Compare with another run" });
    const trace = { resourceSpans: [{ resource: { attributes: [] }, scopeSpans: [{ scope: { name: "t" }, spans: [{
      traceId: "4".repeat(32), spanId: "00000000000000d1", name: "only tool", startTimeUnixNano: "1000000000", endTimeUnixNano: "2000000000",
      attributes: [{ key: "gen_ai.operation.name", value: { stringValue: "execute_tool" } }, { key: "gen_ai.tool.name", value: { stringValue: "weather" } }],
    }] }] }] };
    const bytes = serializeRunLog(importTraceBytes({ spans: new TextEncoder().encode(JSON.stringify(trace)) }));
    await panel.locator(".cc-file-button input").setInputFiles({ name: "other.runlog.jsonl", mimeType: "application/x-ndjson", buffer: Buffer.from(bytes) });
    await expect(panel.locator(".rd-onlyB")).toHaveCount(1);
    await expect(panel.locator(".rd-onlyB .rd-chip")).toHaveText("Only in B");
    await expect(panel.getByText("First difference", { exact: true })).toHaveCount(1);
    await expect(panel.locator(".rd-first")).toHaveCount(1);
    await expect(panel).toHaveScreenshot("run-diff-panel-one-sided.png", { animations: "disabled" });
  });
});
