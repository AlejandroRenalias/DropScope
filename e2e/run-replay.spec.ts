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
  return page.getByRole("region", { name: "Agent run replay" });
}

const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test("opens on the built-in demo run and keeps the legacy simulator one link away", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const replay = await openRunReplay(page);
  await expect(replay).toContainText("Event 42 / 42");
  await expect(replay).toContainText("Imported run · recorded replay");
  await expect(replay).toContainText("Content is withheld");
  await expect(page.locator(".run-source-card")).toContainText("Showing the built-in synthetic demo run.");
  // The mission's rails do not belong next to a run.
  await expect(page.getByRole("complementary", { name: "Mission status" })).toBeHidden();
  await page.getByRole("link", { name: "Mission simulator (legacy)" }).click();
  await expect(page.getByRole("button", { name: "Research Office" })).toBeVisible();
  await page.getByRole("link", { name: /back to agent run replay/ }).click();
  await expect(page.getByRole("region", { name: "Agent run replay" })).toBeVisible();
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
  await replay
    .getByRole("region", { name: "Importer notes" })
    .getByRole("button", { name: /Go to event \d+/ })
    .first()
    .click();
  await expect(replay.getByRole("heading", { name: /^Importer note:/ })).toBeVisible();
});

test("opens a run file the import command saved, in the browser", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const replay = await openRunReplay(page);
  const full = serializeRunLog(importTraceBytes({ spans: demoTrace(), contentMode: "FULL" }));
  await page
    .locator(".file-button input")
    .setInputFiles({ name: "stored.runlog.jsonl", mimeType: "text/plain", buffer: Buffer.from(full) });
  await expect(page.locator(".run-source-card")).toContainText("Run file stored.runlog.jsonl.");
  await expect(replay).toContainText("Content is stored as written");
  await replay.getByLabel("Timeline position").fill("3");
  await expect(replay).toContainText("Customer asks for a refund for order 1042");
  await page.getByRole("button", { name: "Back to the demo run" }).click();
  await expect(page.locator(".run-source-card")).toContainText("Showing the built-in synthetic demo run.");
});

test("says when a step type and token counts were read from names other tools use", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const replay = await openRunReplay(page);
  const trace = new Uint8Array(readFileSync(new URL("../test/fixtures/exporters/openinference.json", import.meta.url)));
  const events = importTraceBytes({ spans: trace });
  const file = serializeRunLog(events);
  await page
    .locator(".file-button input")
    .setInputFiles({ name: "openinference.runlog.jsonl", mimeType: "text/plain", buffer: Buffer.from(file) });
  await expect(page.locator(".run-source-card")).toContainText("Run file openinference.runlog.jsonl.");
  await replay.getByRole("button", { name: /Go to the start of Model call/ }).click();
  await expect(replay.getByRole("heading", { name: "Model call started" })).toBeVisible();
  await expect(replay.locator(".event-summary")).toContainText("Its type was read from the attribute openinference.span.kind");
  await page.screenshot({ path: testInfo.outputPath("mapped-kind.png"), animations: "disabled" });
  const usageEvent = events.find((e) => e.type === "UsageRecorded")?.sequenceNumber ?? 0;
  await replay.getByLabel("Timeline position").fill(String(usageEvent));
  await expect(replay.getByRole("heading", { name: "Tokens recorded" })).toBeVisible();
  await expect(replay.locator(".event-summary")).toContainText(
    "The counts were read from llm.token_count.prompt and llm.token_count.completion",
  );
});

test("offers a skip link first that moves the focus to the timeline", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const link = page.getByRole("link", { name: "Skip to the timeline" });
  await expect(link).not.toBeInViewport();
  await page.keyboard.press("Tab");
  await expect(link).toBeFocused();
  await expect(link).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.locator("#rr-timeline")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator("#rr-timeline").locator(":focus")).toHaveCount(1);
});

test("can be used with the keyboard alone", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const replay = await openRunReplay(page);
  const focusedName = () =>
    page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const style = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      const label = el.getAttribute("aria-label") ?? el.labels?.[0]?.textContent ?? el.textContent ?? "";
      return {
        id: el.id,
        label: label.trim().replace(/\s+/g, " "),
        onScreen: box.width > 0 && box.height > 0,
        ring: (style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0) || style.boxShadow !== "none",
      };
    });

  // Walk the whole page with Tab: every stop is on screen and shows where the focus is, and the key controls are reachable.
  const labels: string[] = [];
  const ids: string[] = [];
  for (let i = 0; i < 150; i++) {
    await page.keyboard.press("Tab");
    const stop = await focusedName();
    if (stop === null) break;
    expect(stop.onScreen, `stop ${i + 1} (${stop.label}) is on screen`).toBe(true);
    // Focus rings may fade in, so look again for a moment before saying there is none.
    await expect.poll(async () => (await focusedName())?.ring, { message: `stop ${i + 1} (${stop.label}) shows focus` }).toBe(true);
    labels.push(stop.label);
    ids.push(stop.id);
  }
  expect(labels.length).toBeGreaterThan(30);
  expect(ids).toContain("rr-position");
  for (const wanted of [
    /^Open a run file/,
    /^Try an example \(4,000 tokens\)/,
    /^Compare with the demo variant/,
    /^Go to the start of Agent/,
    /^Inspect event [0-9]+:/,
  ]) {
    expect(
      labels.some((label) => wanted.test(label)),
      `reaches ${wanted}`,
    ).toBe(true);
  }
  // The 42 chronology buttons are told apart by name.
  const inspect = labels.filter((label) => label.startsWith("Inspect event"));
  expect(new Set(inspect).size).toBe(inspect.length);

  // Operate it without a pointer: the scrub bar, a step, a budget example and the run comparison.
  await page.locator("#rr-position").focus();
  await page.keyboard.press("Home");
  await expect(replay).toContainText("Event 1 / 42");
  await page.keyboard.press("ArrowRight");
  await expect(replay).toContainText("Event 2 / 42");
  await replay
    .getByRole("button", { name: /Go to the start of Tool call: issue_refund/ })
    .first()
    .focus();
  await page.keyboard.press("Enter");
  await expect(replay.getByRole("heading", { name: "Tool call started" })).toBeVisible();
  await replay.getByRole("button", { name: /Try an example \(4,000 tokens\)/ }).focus();
  await page.keyboard.press("Space");
  await expect(replay.locator(".bp-result")).toContainText("would have stopped this run at event 31 of 42");
  await replay.getByRole("button", { name: "Compare with the demo variant" }).focus();
  await page.keyboard.press("Enter");
  const fold = replay
    .getByRole("region", { name: "Compare with another run" })
    .getByRole("button", { name: /steps that match in both runs/ })
    .first();
  await fold.focus();
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Enter");
  await expect(fold).toHaveAttribute("aria-expanded", "true");
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
  const lines = hashed
    .toString("utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
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
    traceId: T,
    spanId: (i + 1).toString(16).padStart(16, "0"),
    name: "n",
    startTimeUnixNano: String(1000 + i * 10),
    endTimeUnixNano: String(1015 + i * 10),
    attributes: [
      { key: "gen_ai.operation.name", value: { stringValue: "chat" } },
      { key: "gen_ai.usage.input_tokens", value: { intValue: "5" } },
    ],
  }));
  const big = serializeRunLog(
    importTraceBytes({ spans: new TextEncoder().encode(JSON.stringify({ resourceSpans: [{ scopeSpans: [{ spans }] }] })) }),
  );
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

test.describe("budget replay", () => {
  test("says plainly that it is a what-if, opens with a ready example, and shows nothing once the limits are cleared", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const replay = await openRunReplay(page);
    const panel = replay.getByRole("region", { name: "Budget replay" });
    await expect(panel).toContainText("Counterfactual");
    await expect(panel).toContainText("DropScope never controls an agent");
    await expect(panel.getByRole("textbox", { name: "Total tokens" })).toHaveValue("4000");
    await expect(panel).toContainText("This is the example limit");
    await expect(panel.getByRole("status")).toContainText("would have stopped this run");
    await expect(replay.locator(".tick.rr-breach")).toHaveCount(1);
    await panel.getByRole("button", { name: "Clear limits" }).click();
    await expect(panel).toContainText("Type one or more limits");
    await expect(panel.getByRole("status")).toHaveCount(0);
    await expect(replay.locator(".tick.rr-breach")).toHaveCount(0);
  });

  test("re-applies a token limit: names the event, marks the timeline, jumps there, and follows the scrubber", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const replay = await openRunReplay(page);
    const panel = replay.getByRole("region", { name: "Budget replay" });
    await panel.getByRole("button", { name: /Try an example/ }).click();
    await expect(panel.getByRole("textbox", { name: "Total tokens" })).toHaveValue("4000");
    const result = panel.locator(".bp-result");
    await expect(result).toContainText("would have stopped this run at event 31 of 42");
    await expect(result).toContainText("After Model call: chat sim-model-1 finished");
    await expect(result).toContainText("over your limit of 4,000 tokens");
    await expect(result).toContainText("What would not have happened");
    await expect(result).toContainText("1 step would never have started");
    await expect(result).toContainText("already running and could not have been recalled");
    await expect(replay.locator(".tick.rr-breach")).toHaveCount(1);
    await expect(replay.locator(".rr-breach-legend")).toContainText("event 31");

    // Gauges follow the position: at the end the limit is over, in words as well as colour.
    await expect(panel.locator(".bp-gauge.over")).toContainText("6,315 tokens of 4,000 tokens · over the limit");
    await replay.getByLabel("Timeline position").fill("1");
    await expect(panel.locator(".bp-gauge")).toContainText("0 tokens of 4,000 tokens");
    await expect(panel.locator(".bp-gauge.over")).toHaveCount(0);

    await panel.getByRole("button", { name: "Go to event 31" }).click();
    await expect(replay).toContainText("Event 31 / 42");
    await expect(panel.locator(".bp-gauge.over")).toContainText("4,065 tokens of 4,000 tokens · over the limit");
  });

  test("handles several limits, a time limit and a cost limit with your own prices", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const replay = await openRunReplay(page);
    const panel = replay.getByRole("region", { name: "Budget replay" });
    await panel.getByRole("textbox", { name: "Model calls" }).fill("2");
    await panel.getByRole("textbox", { name: "Time limit (seconds)" }).fill("5");
    await expect(panel.locator(".bp-result")).toContainText("would have stopped this run at event");
    await expect(panel.locator(".bp-others")).toContainText("Model calls: exceeded at event");
    await expect(panel.locator(".bp-others")).toContainText("Time: exceeded at event");

    await panel.getByText("Add a cost limit").click();
    await panel.getByRole("textbox", { name: "Cost limit" }).fill("0.01");
    await panel.getByRole("textbox", { name: "Input price per million tokens" }).fill("3");
    await panel.getByRole("textbox", { name: "Output price per million tokens" }).fill("15");
    await expect(panel.locator(".bp-others")).toContainText("Cost: exceeded at event");
    await expect(panel.locator(".bp-gauges")).toContainText("USD");
    await panel.getByRole("button", { name: "Clear limits" }).click();
    await expect(panel.locator(".bp-result")).toHaveCount(0);
    await expect(replay.locator(".tick.rr-breach")).toHaveCount(0);
  });

  test("reports a run that fits, and explains bad input without guessing", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const replay = await openRunReplay(page);
    const panel = replay.getByRole("region", { name: "Budget replay" });
    const tokens = panel.getByRole("textbox", { name: "Total tokens" });
    await tokens.fill("1,000,000");
    await expect(panel.locator(".bp-result")).toContainText("No limit would have been exceeded");
    await tokens.fill("abc");
    await expect(panel.locator(".bp-errors")).toContainText("Total tokens must be a whole number");
    await expect(panel.locator(".bp-result")).toHaveCount(0);
    await tokens.fill("-5");
    await expect(panel.locator(".bp-errors")).toContainText("whole number");
    await tokens.fill("0");
    await expect(panel.locator(".bp-result")).toContainText("would have stopped this run at event");
    await panel.getByRole("textbox", { name: "Model calls" }).fill("1");
    await tokens.fill("");
    await panel.getByText("Add a cost limit").click();
    await panel.getByRole("textbox", { name: "Cost limit" }).fill("1");
    await expect(panel.locator(".bp-errors")).toContainText("needs both an input price and an output price");
  });

  test("works for a file you open, and says when token counts are missing", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const replay = await openRunReplay(page);
    const T = "1".repeat(32);
    const spans = [
      {
        traceId: T,
        spanId: "00000000000000a1",
        name: "a",
        startTimeUnixNano: "1000000000",
        endTimeUnixNano: "2000000000",
        attributes: [
          { key: "gen_ai.operation.name", value: { stringValue: "chat" } },
          { key: "gen_ai.usage.input_tokens", value: { intValue: "900" } },
          { key: "gen_ai.usage.output_tokens", value: { intValue: "100" } },
        ],
      },
      {
        traceId: T,
        spanId: "00000000000000a2",
        name: "b",
        startTimeUnixNano: "2000000000",
        endTimeUnixNano: "3000000000",
        attributes: [{ key: "gen_ai.operation.name", value: { stringValue: "chat" } }],
      },
    ];
    const file = serializeRunLog(
      importTraceBytes({ spans: new TextEncoder().encode(JSON.stringify({ resourceSpans: [{ scopeSpans: [{ spans }] }] })) }),
    );
    await page
      .locator(".file-button input")
      .setInputFiles({ name: "missing-usage.runlog.jsonl", mimeType: "text/plain", buffer: Buffer.from(file) });
    const panel = replay.getByRole("region", { name: "Budget replay" });
    await panel.getByRole("textbox", { name: "Total tokens" }).fill("500");
    await expect(panel.locator(".bp-result")).toContainText("1,000 tokens, over your limit of 500 tokens");
    await panel.getByText("What this does and does not tell you").click();
    await expect(panel.locator(".bp-caveats")).toContainText("1 model call reported no token counts");
  });

  for (const width of [1440, 768, 375]) {
    test(`has no horizontal overflow at ${width}px with a result showing`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const replay = await openRunReplay(page);
      const panel = replay.getByRole("region", { name: "Budget replay" });
      await panel.getByRole("button", { name: /Try an example/ }).click();
      await expect(panel.locator(".bp-result")).toContainText("would have stopped");
      await panel.getByText("What this does and does not tell you").click();
      expect(await noOverflow(page)).toBe(true);
    });
  }
});

test("keeps the scrub bar in view while scrolling, and the jump list leads to each section", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const replay = await openRunReplay(page);
  await page.addStyleTag({ content: ".topbar { position: sticky !important; }" });
  const nav = replay.getByRole("navigation", { name: "On this page" });
  await nav.getByRole("link", { name: "Compare runs" }).click();
  await expect(replay.getByRole("region", { name: "Compare with another run" })).toBeInViewport();
  const slider = replay.getByLabel("Timeline position");
  await expect(slider).toBeInViewport();
  await replay.getByRole("link", { name: "Chronology" }).click();
  await expect(replay.getByRole("region", { name: "Event chronology" })).toBeInViewport();
  await expect(slider).toBeInViewport();
  await expect(replay.locator(".rr-dock")).toContainText("Event 42 / 42");
});

test("keeps the product name and the legacy link in the top bar at 390 px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".brand-name")).toBeVisible();
  const legacy = page.getByRole("link", { name: "Legacy simulator" });
  await expect(legacy).toBeVisible();
  const [brand, link] = await Promise.all([page.locator(".brand").boundingBox(), legacy.boundingBox()]);
  expect(brand && link && link.x >= brand.x + brand.width + 8).toBe(true);
  expect(link && link.height < 44).toBe(true);
  expect(await noOverflow(page)).toBe(true);
});

for (const width of [1440, 1280, 768, 390]) {
  test(`the budget marker legend sits below the tick numbers at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const replay = await openRunReplay(page);
    const legend = replay.locator(".rr-breach-legend");
    await expect(legend).toBeVisible();
    const numbers = await replay.locator(".rr-ticks .tick .num").evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().bottom));
    expect(numbers.length).toBeGreaterThan(0);
    const legendTop = (await legend.boundingBox())!.y;
    expect(legendTop).toBeGreaterThanOrEqual(Math.max(...numbers));
    expect(await noOverflow(page)).toBe(true);
  });
}
