import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { importTraceBytes } from "../src/run-import.js";
import { importNoteCodeSchema } from "../src/run-events.js";
import { serializeRunLog } from "../src/run-store.js";
import {
  buildRunModel,
  buildTimeAxis,
  categoryOf,
  contentByStep,
  describeContent,
  describeField,
  describeNote,
  describeRunEvent,
  formatBytes,
  formatDuration,
  formatNumber,
  formatOffset,
  loadRunFromBytes,
  stepSpan,
  stepStatusAt,
  timeTicks,
} from "../src/frontend/run-replay-model.js";

const asset = (name: string) => new URL(`../src/frontend/assets/${name}`, import.meta.url);
const demoBytes = () => new Uint8Array(readFileSync(asset("demo-run.runlog.jsonl")));
const demoTrace = () => new Uint8Array(readFileSync(new URL("./fixtures/demo-run-trace.json", import.meta.url)));

describe("demo run", () => {
  it("is exactly what the real importer produces from the committed source trace", () => {
    const fresh = serializeRunLog(importTraceBytes({ spans: demoTrace() }));
    expect(Buffer.compare(Buffer.from(fresh), Buffer.from(demoBytes())), "run: npx tsx test/fixtures/make-demo-run.ts").toBe(0);
  });
});

describe("demo run with content stored", () => {
  it("is exactly what the real importer produces from the same source trace in FULL mode", () => {
    const fresh = serializeRunLog(importTraceBytes({ spans: demoTrace(), contentMode: "FULL" }));
    const committed = new Uint8Array(readFileSync(asset("demo-run-full.runlog.jsonl")));
    expect(Buffer.compare(Buffer.from(fresh), Buffer.from(committed)), "run: npx tsx test/fixtures/make-demo-run.ts").toBe(0);
    expect(loadRunFromBytes(committed).contentMode).toBe("FULL");
  });
});

describe("demo run variant (for the run diff screen)", () => {
  it("is exactly what the real importer produces from its committed source trace in FULL mode", () => {
    const source = new Uint8Array(readFileSync(new URL("./fixtures/demo-run-variant-trace.json", import.meta.url)));
    const fresh = serializeRunLog(importTraceBytes({ spans: source, contentMode: "FULL" }));
    const committed = new Uint8Array(readFileSync(asset("demo-run-variant.runlog.jsonl")));
    expect(Buffer.compare(Buffer.from(fresh), Buffer.from(committed)), "run: npx tsx test/fixtures/make-demo-run.ts").toBe(0);
    expect(loadRunFromBytes(committed).contentMode).toBe("FULL");
  });
});

describe("run model", () => {
  const model = loadRunFromBytes(demoBytes());

  it("reads the demo run: steps, tree order, depth, titles from structural data", () => {
    expect(model.steps.length).toBe(10);
    expect(model.steps.map((s) => [s.depth, s.title])).toEqual([
      [0, "Agent: support-agent"],
      [1, "Model call: chat sim-model-1"],
      [1, "Tool call: lookup_order"],
      [1, "Tool call: search_policy"],
      [1, "Model call: chat sim-model-1"],
      [1, "Tool call: issue_refund"],
      [1, "Tool call: issue_refund"],
      [1, "Agent: qa-reviewer"],
      [2, "Model call: chat sim-model-1"],
      [1, "Model call: chat sim-model-1"],
    ]);
    expect(model.contentMode).toBe("HASH_ONLY");
    expect(model.durationLabel).toBe("9.10 s");
    expect(model.steps.filter((s) => s.failed).map((s) => s.title)).toEqual(["Tool call: issue_refund"]);
  });

  it("gives every step a status that follows the position and agrees with the reducer", () => {
    for (const position of [1, 10, 20, model.events.length]) {
      const state = model.replay.stateAt(position);
      const running = model.steps
        .filter((s) => stepStatusAt(s, position) === "running")
        .map((s) => s.stepId)
        .sort();
      expect(running, `position ${position}`).toEqual(state.openStepIds);
      const done = model.steps
        .filter((s) => ["finished", "failed"].includes(stepStatusAt(s, position)))
        .map((s) => s.stepId)
        .sort();
      expect(done).toEqual(state.closedStepIds);
      const failed = model.steps
        .filter((s) => stepStatusAt(s, position) === "failed")
        .map((s) => s.stepId)
        .sort();
      expect(failed).toEqual(state.errorStepIds);
    }
  });

  it("describes every event in plain words, never with raw event names", () => {
    const raw =
      /StepStarted|StepEnded|UsageRecorded|ContentRecorded|LogRecorded|ImportNote|RunStarted|RunEnded|LLM_CALL|TOOL_CALL|gen_ai\./;
    for (const event of model.events) {
      const d = describeRunEvent(event, model);
      expect(d.title.length, `event ${event.sequenceNumber}`).toBeGreaterThan(3);
      expect(d.title + d.summary, `event ${event.sequenceNumber}`).not.toMatch(raw);
      expect(categoryOf(event)).toBe(d.category);
    }
  });

  it("shows withheld content as withheld, with size and a short fingerprint", () => {
    const content = model.events.find((e) => e.type === "ContentRecorded" && e.payload.field === "gen_ai.input.messages");
    const text = describeRunEvent(content as never, model).summary;
    expect(text).toMatch(/Model input for .*: withheld \(\d+ bytes?, fingerprint [0-9a-f]{8}\)/);
    expect(text).not.toContain("Customer asks");
  });

  it("shows stored content only when the run says it was stored", () => {
    const full = loadRunFromBytes(serializeRunLog(importTraceBytes({ spans: demoTrace(), contentMode: "FULL" })));
    expect(full.contentMode).toBe("FULL");
    const content = full.events.find((e) => e.type === "ContentRecorded" && e.payload.field === "gen_ai.input.messages");
    expect(describeRunEvent(content as never, full).summary).toContain("Customer asks for a refund");
  });

  it("reports token totals and the failure in the final state", () => {
    const final = model.replay.stateAt(model.events.length);
    expect(final.inputTokens).toBe("5530");
    expect(final.outputTokens).toBe("785");
    expect(final.errorStepIds.length).toBe(1);
  });

  it("explains every importer note code in a sentence", () => {
    const details: Record<string, Record<string, unknown>> = {
      OTHER_TRACE_EXCLUDED: { spans: 1, logs: 2 },
      DUPLICATE_SPAN_COLLAPSED: { count: 2 },
      DUPLICATE_LOG_COLLAPSED: { count: 1 },
      ORPHAN_LOG_RECORD: { logOrdinal: 3 },
      UNKNOWN_FIELD: { count: 2 },
      USAGE_NOT_SUMMED: { count: 1, scope: "log" },
      UNUSABLE_USAGE: { count: 1 },
      ENUM_NAME_ACCEPTED: { role: "spans", count: 1 },
      WITHHELD_ATTRIBUTE: { count: 2, bytes: 100 },
      SECRET_PATTERN_COUNT: { email: 1 },
    };
    for (const code of importNoteCodeSchema.options) {
      const text = describeNote(code, details[code] ?? {});
      expect(text.length, code).toBeGreaterThan(20);
      expect(text, code).not.toMatch(/undefined|\[object/);
      expect(text, code).not.toBe(code);
    }
    expect(model.notes.map((n) => n.code)).toContain("SECRET_PATTERN_COUNT");
  });

  it("cannot hang on a parent loop in a hand-edited history", () => {
    const events = JSON.parse(JSON.stringify(model.events)) as Array<{
      type: string;
      payload: { stepId?: string; parentStepId: string | null };
    }>;
    const starts = events.filter((e) => e.type === "StepStarted");
    starts[0].payload.parentStepId = starts[starts.length - 1].payload.stepId as string;
    const looped = buildRunModel(events);
    expect(looped.steps.length).toBe(10);
    expect(new Set(looped.steps.map((s) => s.stepId)).size).toBe(10);
  });

  it("rejects anything the reducer rejects", () => {
    expect(() => buildRunModel(model.events.slice(0, -1))).toThrow();
    expect(() => loadRunFromBytes(new TextEncoder().encode("not a run log\n"))).toThrow();
  });
});

describe("formatting", () => {
  it("formats sizes, durations, numbers and fields", () => {
    expect(formatBytes(1)).toBe("1 byte");
    expect(formatBytes(2048)).toBe("2.0 KiB");
    expect(formatDuration("1000000000", "1800000000")).toBe("800 ms");
    expect(formatDuration("0", "12345000000")).toBe("12.3 s");
    expect(formatNumber("1234567")).toBe("1,234,567");
    expect(describeField({ v: { t: "s", v: "hello" } })).toEqual({ withheld: false, text: "hello" });
    expect(describeField({ w: { n: 5, h: `abcdef01${"0".repeat(56)}` } }).text).toBe("withheld (5 bytes, fingerprint abcdef01)");
    expect(describeField({ v: { t: "s", v: "x".repeat(1000) } }, 10).text).toMatch(/^x{10}… \(/);
  });
});

describe("waterfall time axis", () => {
  const model = loadRunFromBytes(demoBytes());
  const axis = buildTimeAxis(model);

  it("spans the run from the first step start to the last step end", () => {
    expect(axis.spanNs).toBe(9_100_000_000);
    const root = stepSpan(model.steps[0], axis);
    expect(root.start).toBe(0);
    expect(root.end).toBe(9_100_000_000);
  });

  it("gives every event a recorded time that never goes back, from 0 to the end of the run", () => {
    expect(axis.timeAt[1]).toBe(0);
    for (let n = 2; n <= model.events.length; n += 1) expect(axis.timeAt[n]).toBeGreaterThanOrEqual(axis.timeAt[n - 1]);
    expect(axis.timeAt[model.events.length]).toBe(axis.spanNs);
    // At the start of a step the cursor sits at that step's start.
    for (const step of model.steps) expect(axis.timeAt[step.startSequence]).toBeGreaterThanOrEqual(stepSpan(step, axis).start);
  });

  it("chooses round ticks and short labels", () => {
    expect(timeTicks(9_100_000_000, 6)).toEqual({ step: 2_000_000_000, ticks: [0, 2e9, 4e9, 6e9, 8e9] });
    expect(timeTicks(0)).toEqual({ step: 0, ticks: [0] });
    expect(timeTicks(450_000, 4).ticks).toEqual([0, 200_000, 400_000]);
    expect(formatOffset(0)).toBe("0");
    expect(formatOffset(200_000, 100_000)).toBe("200 µs");
    expect(formatOffset(40_000_000, 10_000_000)).toBe("40 ms");
    expect(formatOffset(1_500_000_000, 500_000_000)).toBe("1.5 s");
    expect(formatOffset(4_000_000_000, 2_000_000_000)).toBe("4 s");
  });

  it("lists the content of each step, withheld as size and fingerprint only", () => {
    const content = contentByStep(model.events);
    const total = [...content.values()].reduce((a, list) => a + list.length, 0);
    expect(total).toBe(model.events.filter((e) => e.type === "ContentRecorded" && e.payload.stepId !== null).length);
    const first = model.events[[...content.values()][0][0] - 1];
    if (first.type !== "ContentRecorded") throw new Error("not content");
    const shown = describeContent(first);
    expect(shown.withheld?.fingerprint).toMatch(/^[0-9a-f]{8}$/);
    expect(shown.text).toBe("");
  });
});

describe("browser safety", () => {
  // The replay screen runs in the browser, so nothing it imports may need Node.
  const root = path.resolve(import.meta.dirname, "..", "src");
  const closure = (entry: string): string[] => {
    const seen = new Set<string>();
    const queue = [path.resolve(entry)];
    while (queue.length > 0) {
      const file = queue.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/from\s+"(\.[^"]+)"/g)) {
        const base = path.resolve(path.dirname(file), match[1].replace(/\.js$/, ""));
        for (const ext of [".ts", ".tsx"]) if (existsSync(base + ext)) queue.push(base + ext);
      }
    }
    return [...seen];
  };
  const entries = ["frontend/run-replay-model.ts", "frontend/run-replay.tsx", "frontend/replay-screen.tsx"]
    .map((e) => path.join(root, e))
    .filter(existsSync);

  it("the replay screen's import graph uses no Node modules, Buffer or process", () => {
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      for (const file of closure(entry)) {
        const text = readFileSync(file, "utf8").replace(/\/\/.*$/gm, "");
        expect(/from\s+"node:/.test(text), `${path.relative(root, file)} imports a node: module`).toBe(false);
        expect(/\bBuffer\b|\bprocess\./.test(text), `${path.relative(root, file)} uses Buffer or process`).toBe(false);
      }
    }
  });
});
