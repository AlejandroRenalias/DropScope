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
const useStoredDemo = async (page: Page) => {
  await page.getByRole("button", { name: "Demo run with content stored" }).click();
  await expect(page.locator(".run-source-card")).toContainText("Demo run with content stored.");
};

test.describe("claim check", () => {
  test("says what it checks, and that a run without content cannot be checked", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const replay = await openRunReplay(page);
    const panel = replay.getByRole("region", { name: "Claim check" });
    await expect(panel).toContainText("It never asks a model to judge");
    await expect(panel).toContainText("This run keeps no content");
    await expect(panel).toContainText("Write or open some claims");
    await panel.getByRole("button", { name: /Try an example/ }).click();
    await expect(panel.locator(".cc-summary")).toContainText("0 supported, 0 not supported, 3 cannot be checked (of 3)");
    await expect(panel.locator(".cc-result.cannot-check")).toHaveCount(3);
    await expect(panel.locator(".cc-result").first()).toContainText("imported without content");
  });

  test("checks claims against a run with content stored, and jumps to the evidence", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const replay = await openRunReplay(page);
    await useStoredDemo(page);
    const panel = replay.getByRole("region", { name: "Claim check" });
    await expect(panel).not.toContainText("This run keeps no content");
    await panel.getByRole("button", { name: /Try an example/ }).click();
    await expect(panel.locator(".cc-summary")).toContainText("2 supported, 1 not supported, 0 cannot be checked (of 3)");
    const total = panel.locator(".cc-result", { hasText: "order-total" });
    await expect(total.locator(".cc-verdict")).toHaveText("Supported");
    await expect(total).toContainText("appears in the recorded result of Tool call: lookup_order");
    const refund = panel.locator(".cc-result", { hasText: "refund-accepted" });
    await expect(refund).toContainText("2 steps matched; this is the first that supports it");
    const delivered = panel.locator(".cc-result", { hasText: "order-delivered" });
    await expect(delivered.locator(".cc-verdict")).toHaveText("Not supported");
    await expect(delivered).toContainText('this text does not appear in it: "\\"delivered\\":true"');

    await expect(replay.locator(".replay-position")).toContainText("Event 42 / 42");
    await total.getByRole("button", { name: /Go to event/ }).click();
    await expect(replay.locator(".replay-position")).not.toContainText("Event 42 / 42");
    // The destination really is the recorded evidence: the tool result of lookup_order.
    await expect(replay.locator(".event-card")).toContainText("Tool result recorded");
    await expect(replay.locator(".event-card")).toContainText("Tool call: lookup_order");
    await panel.getByText("What this does and does not tell you").click();
    await expect(panel.locator(".bp-caveats[open]")).toContainText("does not prove the claim is true");
  });

  test("explains a bad claims text without guessing, and shows claim text as plain text", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const replay = await openRunReplay(page);
    await useStoredDemo(page);
    const panel = replay.getByRole("region", { name: "Claim check" });
    const box = panel.getByRole("textbox", { name: "Claims (JSON)" });
    await box.fill('{"claims": [');
    await expect(panel.locator(".bp-errors")).toContainText("not valid JSON");
    await expect(panel.locator(".cc-result")).toHaveCount(0);
    await box.fill('{"claims":[{"id":"a","text":"t","tool":"lookup_order","mustContains":["59"]}]}');
    await expect(panel.locator(".bp-errors")).toContainText('Claim 1 (a): a field name is not allowed (did you mean "mustContain"?)');
    await expect(panel.locator(".cc-result")).toHaveCount(0);
    await box.fill(JSON.stringify({ claims: [{ id: "html", text: "<img src=x onerror=alert(1)> <b>bold</b>", tool: "nothing_here", mustContain: ["x"] }] }));
    await expect(panel.locator(".cc-result.not-supported")).toContainText("<img src=x onerror=alert(1)> <b>bold</b>");
    await expect(panel.locator(".cc-result img, .cc-result b")).toHaveCount(0);
    await expect(panel.locator(".cc-result")).toContainText('Tools in this run: "lookup_order"');
    await panel.getByRole("button", { name: "Clear claims" }).click();
    await expect(box).toHaveValue("");
    await expect(panel.locator(".bp-errors")).toHaveCount(0);
  });

  test("opens a claims file, and refuses one that is not text or is too big", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const replay = await openRunReplay(page);
    await useStoredDemo(page);
    const panel = replay.getByRole("region", { name: "Claim check" });
    const input = panel.locator(".cc-file-button input");
    await input.setInputFiles({ name: "claims.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ claims: [{ id: "policy", text: "Undelivered orders are refundable", tool: "search_policy", mustContain: ["refundable in full"] }] })) });
    await expect(panel.getByRole("textbox", { name: "Claims (JSON)" })).toHaveValue(/search_policy/);
    await expect(panel.locator(".cc-result.supported")).toContainText("policy");
    await input.setInputFiles({ name: "binary.json", mimeType: "application/json", buffer: Buffer.from([0x7b, 0xff, 0xfe, 0x7d]) });
    await expect(panel.getByRole("alert")).toContainText("not valid UTF-8");
    await input.setInputFiles({ name: "big.json", mimeType: "application/json", buffer: Buffer.alloc(1024 * 1024 + 1, 32) });
    await expect(panel.getByRole("alert")).toContainText("larger than 1 MiB");
  });

  test("treats a leading byte order mark the same way as the command line: one is accepted, two are refused", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const replay = await openRunReplay(page);
    await useStoredDemo(page);
    const panel = replay.getByRole("region", { name: "Claim check" });
    const input = panel.locator(".cc-file-button input");
    const body = Buffer.from(JSON.stringify({ claims: [{ id: "order-total", text: "The order total was 59.00", tool: "lookup_order", mustContain: ["59.0"] }] }));
    const mark = Buffer.from([0xef, 0xbb, 0xbf]);
    await input.setInputFiles({ name: "one-mark.json", mimeType: "application/json", buffer: Buffer.concat([mark, body]) });
    await expect(panel.locator(".cc-result.supported")).toContainText("order-total");
    await input.setInputFiles({ name: "two-marks.json", mimeType: "application/json", buffer: Buffer.concat([mark, mark, body]) });
    await expect(panel.locator(".bp-errors")).toContainText("not valid JSON");
    await expect(panel.locator(".cc-result")).toHaveCount(0);
  });

  test("uses the run file you opened, not the demo", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const replay = await openRunReplay(page);
    const T = "1".repeat(32);
    const spans = [{
      traceId: T, spanId: "00000000000000a1", name: "a", startTimeUnixNano: "1000000000", endTimeUnixNano: "2000000000",
      attributes: [
        { key: "gen_ai.operation.name", value: { stringValue: "execute_tool" } }, { key: "gen_ai.tool.name", value: { stringValue: "weather" } },
        { key: "gen_ai.tool.call.result", value: { stringValue: "sunny, 21 degrees" } },
      ],
    }];
    const stored = serializeRunLog(importTraceBytes({ spans: new TextEncoder().encode(JSON.stringify({ resourceSpans: [{ scopeSpans: [{ spans }] }] })), contentMode: "FULL" }));
    await page.locator(".file-button input").setInputFiles({ name: "weather.runlog.jsonl", mimeType: "text/plain", buffer: Buffer.from(stored) });
    const panel = replay.getByRole("region", { name: "Claim check" });
    await expect(panel).not.toContainText("This run keeps no content");
    await panel.getByRole("textbox", { name: "Claims (JSON)" }).fill(JSON.stringify({ claims: [
      { id: "sunny", text: "It was sunny", tool: "weather", mustContain: ["sunny"] },
      { id: "rain", text: "It rained", tool: "weather", mustContain: ["rain"] },
    ] }));
    await expect(panel.locator(".cc-summary")).toContainText("1 supported, 1 not supported, 0 cannot be checked (of 2)");
  });

  for (const width of [1440, 768, 375]) {
    test(`has no horizontal overflow at ${width}px with results showing`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const replay = await openRunReplay(page);
      await useStoredDemo(page);
      const panel = replay.getByRole("region", { name: "Claim check" });
      await panel.getByRole("button", { name: /Try an example/ }).click();
      await expect(panel.locator(".cc-result")).toHaveCount(3);
      await panel.getByText("How to write a claim").click();
      await panel.getByText("What this does and does not tell you").click();
      expect(await noOverflow(page)).toBe(true);
    });
  }
});
