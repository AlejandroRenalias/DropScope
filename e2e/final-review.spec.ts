// Browser checks added after the final whole-project review (Opus 5.5 and Sol 6.1, commit 99bc048) and its fix review.
import { expect, test, type Locator, type Page } from "@playwright/test";
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

// Files whose name starts with "hold-" are not read until the test releases them, so a test decides exactly when an
// older read finishes relative to a newer choice (no timers racing the page).
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const held: Array<() => void> = [];
    (window as unknown as { __held: Array<() => void> }).__held = held;
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function (this: File) {
      if (this.name.startsWith("hold-")) await new Promise<void>((resolve) => { held.push(resolve); });
      return original.call(this);
    };
  });
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

const waitHeld = (page: Page, count: number) =>
  page.waitForFunction((n) => (window as unknown as { __held: unknown[] }).__held.length === n, count);
async function release(page: Page, index: number) {
  await page.evaluate((i) => (window as unknown as { __held: Array<() => void> }).__held[i](), index);
  // Give the released read time to finish and (wrongly) update the screen; a correct screen ignores it.
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 400)));
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
const file = (name: string, buffer: Buffer, mimeType = "application/x-ndjson") => ({ name, mimeType, buffer });
const BAD_RUN = Buffer.from("this is not a run file");
const BAD_UTF8 = Buffer.from([0xff, 0xfe, 0xfd]);

test.describe("final review: an older read never overwrites a newer choice", () => {
  test("main file picker: a held valid file, then another file", async ({ page }) => {
    await openRunReplay(page);
    const input = page.locator(".run-source-card .file-button input");
    await input.setInputFiles(file("hold-first.runlog.jsonl", runFile("alpha", "one", "5")));
    await waitHeld(page, 1);
    await input.setInputFiles(file("second.runlog.jsonl", runFile("beta", "two", "6")));
    await expect(page.locator(".run-source-card")).toContainText("Run file second.runlog.jsonl");
    await release(page, 0);
    await expect(page.locator(".run-source-card")).toContainText("Run file second.runlog.jsonl");
    await expect(page.locator(".run-source-card")).not.toContainText("hold-first");
  });

  test("main file picker: a held valid file, then the demo", async ({ page }) => {
    await openRunReplay(page);
    await page.locator(".run-source-card .file-button input").setInputFiles(file("hold-late.runlog.jsonl", runFile("alpha", "one", "5")));
    await waitHeld(page, 1);
    await page.getByRole("button", { name: "Demo run with content stored" }).click();
    await release(page, 0);
    await expect(page.locator(".run-source-card")).toContainText("Demo run with content stored.");
    await expect(page.locator(".run-source-card")).not.toContainText("hold-late");
  });

  test("main file picker: a held broken file shows no error after a newer good file", async ({ page }) => {
    await openRunReplay(page);
    const input = page.locator(".run-source-card .file-button input");
    await input.setInputFiles(file("hold-broken.runlog.jsonl", BAD_RUN));
    await waitHeld(page, 1);
    await input.setInputFiles(file("good.runlog.jsonl", runFile("beta", "two", "6")));
    await expect(page.locator(".run-source-card")).toContainText("Run file good.runlog.jsonl");
    await release(page, 0);
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("comparison panel: a held valid file, then another file", async ({ page }) => {
    const replay = await openRunReplay(page);
    const panel = replay.getByRole("region", { name: "Compare with another run" });
    const input = panel.locator(".cc-file-button input");
    await input.setInputFiles(file("hold-b1.runlog.jsonl", runFile("alpha", "one", "5")));
    await waitHeld(page, 1);
    await input.setInputFiles(file("b2.runlog.jsonl", runFile("beta", "two", "6")));
    await expect(panel.locator(".rd-who").first()).toContainText("Run file b2.runlog.jsonl");
    await release(page, 0);
    await expect(panel.locator(".rd-who").first()).toContainText("Run file b2.runlog.jsonl");
  });

  test("comparison panel: a held valid file, then a demo run B", async ({ page }) => {
    const replay = await openRunReplay(page);
    const panel = replay.getByRole("region", { name: "Compare with another run" });
    await panel.locator(".cc-file-button input").setInputFiles(file("hold-b1.runlog.jsonl", runFile("alpha", "one", "5")));
    await waitHeld(page, 1);
    await panel.getByRole("button", { name: "Compare with the demo variant" }).click();
    await release(page, 0);
    await expect(panel.locator(".rd-who").first()).toContainText("Demo variant");
  });

  test("comparison panel: a held broken file shows no error after a newer good file", async ({ page }) => {
    const replay = await openRunReplay(page);
    const panel = replay.getByRole("region", { name: "Compare with another run" });
    const input = panel.locator(".cc-file-button input");
    await input.setInputFiles(file("hold-bad.runlog.jsonl", BAD_RUN));
    await waitHeld(page, 1);
    await input.setInputFiles(file("b2.runlog.jsonl", runFile("beta", "two", "6")));
    await expect(panel.locator(".rd-who").first()).toContainText("Run file b2.runlog.jsonl");
    await release(page, 0);
    await expect(panel.getByRole("alert")).toHaveCount(0);
  });

  const claimsBox = (replay: Locator) => replay.getByRole("region", { name: "Claim check" });

  test("claims panel: a held claims file never replaces text typed or filled afterwards", async ({ page }) => {
    const replay = await openRunReplay(page);
    const panel = claimsBox(replay);
    const held = JSON.stringify({ claims: [{ id: "heldclaim", text: "t", tool: "lookup_order", mustContain: ["x"] }] });
    await panel.locator(".cc-file-button input").setInputFiles(file("hold-claims.json", Buffer.from(held), "application/json"));
    await waitHeld(page, 1);
    await panel.getByRole("button", { name: "Try an example (3 claims)" }).click();
    await expect(panel.getByRole("textbox")).toHaveValue(/order-total/);
    await release(page, 0);
    await expect(panel.getByRole("textbox")).toHaveValue(/order-total/);
    await expect(panel.getByRole("textbox")).not.toHaveValue(/heldclaim/);
  });

  test("claims panel: a held file that is not valid text shows no error after a newer action", async ({ page }) => {
    const replay = await openRunReplay(page);
    const panel = claimsBox(replay);
    await panel.locator(".cc-file-button input").setInputFiles(file("hold-bad.json", BAD_UTF8, "application/json"));
    await waitHeld(page, 1);
    await panel.getByRole("button", { name: "Try an example (3 claims)" }).click();
    await release(page, 0);
    await expect(panel.getByRole("alert")).toHaveCount(0);
  });
});

// Everything the page could have kept: web storage, cookies, every record of every database, every cached response.
async function storedText(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const parts: string[] = [JSON.stringify({ ...localStorage }), JSON.stringify({ ...sessionStorage }), document.cookie];
    const databases = (await indexedDB.databases?.()) ?? [];
    for (const info of databases) {
      parts.push(String(info.name));
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(info.name as string);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      for (const store of Array.from(db.objectStoreNames)) {
        const records = await new Promise<unknown[]>((resolve, reject) => {
          const request = db.transaction(store).objectStore(store).getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        parts.push(JSON.stringify(records));
      }
      db.close();
    }
    for (const name of await caches.keys()) {
      parts.push(name);
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        parts.push(request.url);
        const response = await cache.match(request);
        if (response) parts.push(await response.clone().text());
      }
    }
    parts.push(JSON.stringify((await navigator.serviceWorker?.getRegistrations?.()) ?? []));
    return parts.join("\n");
  });
}

test.describe("final review: uploaded content is not kept by the browser", () => {
  test("the scan can see a marker hidden in a database record and a cached response (positive control)", async ({ page }) => {
    await page.evaluate(async (marker) => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("control", 1);
        request.onupgradeneeded = () => { request.result.createObjectStore("records", { autoIncrement: true }); };
        request.onsuccess = () => {
          const tx = request.result.transaction("records", "readwrite");
          tx.objectStore("records").add({ hidden: marker });
          tx.oncomplete = () => { request.result.close(); resolve(); };
        };
        request.onerror = () => reject(request.error);
      });
      await (await caches.open("control")).put("/control", new Response(marker));
    }, MARKER);
    const text = await storedText(page);
    expect(text.split(MARKER).length - 1).toBe(2);
  });

  test("uploads to all three panels leave nothing behind, before and after a reload", async ({ page }) => {
    const messages: string[] = [];
    page.on("console", (m) => messages.push(m.text()));
    page.on("pageerror", (e) => messages.push(e.message));
    const replay = await openRunReplay(page);
    await page.locator(".run-source-card .file-button input").setInputFiles(file("marker.runlog.jsonl", runFile("marker-tool", MARKER, "7")));
    await expect(page.locator(".run-source-card")).toContainText("Run file marker.runlog.jsonl");
    await replay.getByRole("region", { name: "Compare with another run" }).locator(".cc-file-button input")
      .setInputFiles(file("marker-b.runlog.jsonl", runFile("marker-tool", MARKER, "8")));
    const claims = replay.getByRole("region", { name: "Claim check" });
    const claimsFile = JSON.stringify({ claims: [{ id: "markerclaim", text: "the marker was recorded", tool: "marker-tool", mustContain: [MARKER] }] });
    await claims.locator(".cc-file-button input").setInputFiles(file("claims.json", Buffer.from(claimsFile), "application/json"));
    // A valid claim that the uploaded run supports: the claim path really read the private text.
    await expect(claims.locator(".cc-summary")).toContainText("1 supported");
    const before = await storedText(page);
    expect(before).not.toContain(MARKER);
    expect(before).not.toContain("marker-tool");
    await page.getByRole("button", { name: "Back to the demo run" }).click();
    await page.reload();
    const after = await storedText(page);
    expect(after).not.toContain(MARKER);
    expect(after).not.toContain("marker-tool");
    expect(messages.join("\n")).not.toContain(MARKER);
  });
});
