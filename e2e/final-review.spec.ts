// Browser checks added after the final whole-project review (Opus 5.5 and Sol 6.1, commit 99bc048).
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
  await page.getByRole("button", { name: "Mission Replay", exact: true }).click();
  await page.getByRole("button", { name: "Imported agent run" }).click();
  return page.getByRole("region", { name: "Agent run replay" });
}

const MARKER = "UNIQUE-PRIVATE-MARKER-7f3a91";
function runFile(tool: string, result: string, trace: string): Buffer {
  const doc = { resourceSpans: [{ resource: { attributes: [] }, scopeSpans: [{ scope: { name: "t" }, spans: [{
    traceId: trace.repeat(32), spanId: "00000000000000e1", name: "x", startTimeUnixNano: "1000000000", endTimeUnixNano: "2000000000",
    attributes: [
      { key: "gen_ai.operation.name", value: { stringValue: "execute_tool" } },
      { key: "gen_ai.tool.name", value: { stringValue: tool } },
      { key: "gen_ai.tool.call.result", value: { stringValue: result } },
    ],
  }] }] }] };
  return Buffer.from(serializeRunLog(importTraceBytes({ spans: new TextEncoder().encode(JSON.stringify(doc)), contentMode: "FULL" })));
}

test.describe("final review: browser", () => {
  test("a slow older file never replaces the file chosen after it", async ({ page }) => {
    // Files whose name starts with "slow-" take a while to be read, so the second file finishes first.
    await page.addInitScript(() => {
      const original = File.prototype.arrayBuffer;
      File.prototype.arrayBuffer = async function (this: File) {
        if (this.name.startsWith("slow-")) await new Promise((resolve) => setTimeout(resolve, 1200));
        return original.call(this);
      };
    });
    await page.goto("/");
    await page.addStyleTag({ content: ".topbar { position: static !important; }" });
    const replay = await openRunReplay(page);
    const input = page.locator(".run-source-card .file-button input");
    await input.setInputFiles({ name: "slow-first.runlog.jsonl", mimeType: "application/x-ndjson", buffer: runFile("alpha", "one", "5") });
    await input.setInputFiles({ name: "fast-second.runlog.jsonl", mimeType: "application/x-ndjson", buffer: runFile("beta", "two", "6") });
    await expect(page.locator(".run-source-card")).toContainText("Run file fast-second.runlog.jsonl");
    await page.waitForTimeout(2000);
    await expect(page.locator(".run-source-card")).toContainText("Run file fast-second.runlog.jsonl");
    await expect(page.locator(".run-source-card")).not.toContainText("slow-first");
    await expect(replay).toBeVisible();
  });

  test("a run file that is still being read cannot overwrite the demo chosen meanwhile", async ({ page }) => {
    await page.addInitScript(() => {
      const original = File.prototype.arrayBuffer;
      File.prototype.arrayBuffer = async function (this: File) {
        if (this.name.startsWith("slow-")) await new Promise((resolve) => setTimeout(resolve, 1200));
        return original.call(this);
      };
    });
    await page.goto("/");
    await page.addStyleTag({ content: ".topbar { position: static !important; }" });
    await openRunReplay(page);
    await page.locator(".run-source-card .file-button input").setInputFiles({ name: "slow-late.runlog.jsonl", mimeType: "application/x-ndjson", buffer: runFile("alpha", "one", "5") });
    await page.getByRole("button", { name: "Demo run with content stored" }).click();
    await page.waitForTimeout(2000);
    await expect(page.locator(".run-source-card")).toContainText("Demo run with content stored.");
    await expect(page.locator(".run-source-card")).not.toContainText("slow-late");
  });

  test("an uploaded run's content is not written to browser storage", async ({ page }) => {
    const messages: string[] = [];
    page.on("console", (m) => messages.push(m.text()));
    const replay = await openRunReplay(page);
    await page.locator(".run-source-card .file-button input").setInputFiles({ name: "marker.runlog.jsonl", mimeType: "application/x-ndjson", buffer: runFile("marker-tool", MARKER, "7") });
    await expect(page.locator(".run-source-card")).toContainText("Run file marker.runlog.jsonl");
    // Also through the comparison and claims panels.
    await replay.getByRole("region", { name: "Compare with another run" }).locator(".cc-file-button input")
      .setInputFiles({ name: "marker-b.runlog.jsonl", mimeType: "application/x-ndjson", buffer: runFile("marker-tool", MARKER, "8") });
    await replay.getByRole("region", { name: "Claim check" }).locator(".cc-file-button input")
      .setInputFiles({ name: "claims.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify([{ id: "c", text: "t", tool: "marker-tool", mustContain: [MARKER] }])) });
    await page.getByRole("button", { name: "Back to the demo run" }).click();
    for (const step of ["after upload", "after reload"]) {
      if (step === "after reload") await page.reload();
      const stored = await page.evaluate(async () => {
        const parts: string[] = [JSON.stringify({ ...localStorage }), JSON.stringify({ ...sessionStorage }), document.cookie];
        const databases = (await indexedDB.databases?.()) ?? [];
        parts.push(JSON.stringify(databases));
        for (const name of await caches.keys()) parts.push(name);
        return parts.join("\n");
      });
      expect(stored, step).not.toContain(MARKER);
      expect(stored, step).not.toContain("marker-tool");
    }
    expect(messages.join("\n")).not.toContain(MARKER);
  });
});
