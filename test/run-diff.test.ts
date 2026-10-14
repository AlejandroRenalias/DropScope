import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { buildRunModel } from "../src/frontend/run-replay-model.js";
import { DIFF_LIMITS, diffRuns } from "../src/run-diff.js";
import { diffReportLines } from "../src/run-diff-report.js";
import { importTraceBytes } from "../src/run-import.js";
import { parseRunLog } from "../src/run-log-format.js";

// ---- building runs through the real importer ----
type Step = {
  op?: "chat" | "execute_tool"; tool?: string; start: number; end: number; input?: number; output?: number;
  failed?: boolean; result?: string; parent?: number;
};
const BASE = 1_700_000_000_000_000_000n;
const ns = (seconds: number): string => (BASE + BigInt(Math.round(seconds * 1e9))).toString();
const id = (n: number) => (n + 1).toString(16).padStart(16, "0");

function modelOf(steps: Step[], options: { trace?: string; full?: boolean } = {}) {
  const spans = steps.map((s, i) => ({
    traceId: (options.trace ?? "1").repeat(32), spanId: id(i), ...(s.parent !== undefined ? { parentSpanId: id(s.parent) } : {}), name: `s${i}`,
    startTimeUnixNano: ns(s.start), endTimeUnixNano: ns(s.end), ...(s.failed ? { status: { code: 2 } } : {}),
    attributes: [
      ...(s.op ? [{ key: "gen_ai.operation.name", value: { stringValue: s.op } }] : []),
      ...(s.tool ? [{ key: "gen_ai.tool.name", value: { stringValue: s.tool } }] : []),
      ...(s.input === undefined ? [] : [{ key: "gen_ai.usage.input_tokens", value: { intValue: String(s.input) } }]),
      ...(s.output === undefined ? [] : [{ key: "gen_ai.usage.output_tokens", value: { intValue: String(s.output) } }]),
      ...(s.result === undefined ? [] : [{ key: "gen_ai.tool.call.result", value: { stringValue: s.result } }]),
    ],
  }));
  const bytes = new TextEncoder().encode(JSON.stringify({ resourceSpans: [{ scopeSpans: [{ spans }] }] }));
  return buildRunModel(importTraceBytes({ spans: bytes, contentMode: options.full ? "FULL" : "HASH_ONLY" }));
}

const base = (): Step[] => [
  { op: "chat", start: 0, end: 1, input: 100, output: 50 },
  { op: "execute_tool", tool: "search", start: 1, end: 2, result: "found 3 items" },
  { op: "chat", start: 2, end: 4, input: 200, output: 100 },
  { op: "execute_tool", tool: "write", start: 4, end: 5, result: "saved" },
];

describe("run diff: structure", () => {
  it("says two identical recordings are identical, even when the timing and ids differ", () => {
    const a = modelOf(base());
    const later = base().map((s) => ({ ...s, start: s.start + 100, end: s.end + 103 }));
    const b = modelOf(later, { trace: "2" });
    const r = diffRuns(a, b);
    expect(r.identical).toBe(true);
    expect(r.first).toBeNull();
    expect(r.firstIndex).toBe(-1);
    expect(r.counts).toEqual({ same: 4, changed: 0, onlyA: 0, onlyB: 0 });
    expect(r.totals.a.durationNs).not.toBe(r.totals.b.durationNs);
  });

  it("finds the first step where a different tool was called", () => {
    const changed = base();
    changed[1] = { ...changed[1], tool: "browse" };
    const r = diffRuns(modelOf(base()), modelOf(changed));
    expect(r.identical).toBe(false);
    expect(r.firstIndex).toBe(1);
    expect(r.first?.status).toBe("onlyA");
    expect(r.items.map((i) => i.status)).toEqual(["same", "onlyA", "onlyB", "same", "same"]);
    expect(r.tools).toEqual([{ tool: "Tool call: browse", a: 0, b: 1 }, { tool: "Tool call: search", a: 1, b: 0 }]);
  });

  it("does not make every later step look different when one step is missing", () => {
    const shorter = base();
    shorter.splice(1, 1);
    const r = diffRuns(modelOf(base()), modelOf(shorter));
    expect(r.counts).toEqual({ same: 3, changed: 0, onlyA: 1, onlyB: 0 });
    expect(r.items[r.firstIndex].a?.title).toBe("Tool call: search");
  });

  it("reports a step that exists only in run B", () => {
    const longer = [...base(), { op: "chat" as const, start: 5, end: 6, input: 10, output: 5 }];
    const r = diffRuns(modelOf(base()), modelOf(longer));
    expect(r.counts).toMatchObject({ same: 4, onlyB: 1, onlyA: 0 });
    expect(r.first?.b?.title).toBe("Model call: chat");
  });

  it("matches by name in tree order, not by span id", () => {
    const a = modelOf([{ op: "chat", start: 0, end: 1, input: 1, output: 1 }, { op: "execute_tool", tool: "t", start: 1, end: 2 }]);
    const reversedIds = [{ op: "chat" as const, start: 0, end: 1, input: 1, output: 1 }, { op: "execute_tool" as const, tool: "t", start: 1, end: 2 }];
    const b = modelOf(reversedIds, { trace: "3" });
    expect(diffRuns(a, b).identical).toBe(true);
  });
});

describe("run diff: outcome, tokens and content", () => {
  it("flags a step that failed in one run only, and different token counts", () => {
    const changed = base();
    changed[0] = { ...changed[0], failed: true, input: 120 };
    const r = diffRuns(modelOf(base()), modelOf(changed));
    expect(r.firstIndex).toBe(0);
    expect(r.first?.status).toBe("changed");
    expect(r.first?.changes.map((c) => c.code)).toEqual(["STATUS", "INPUT_TOKENS"]);
    expect(r.first?.changes[1]).toMatchObject({ a: "100", b: "120" });
    expect(r.totals.b.failedSteps).toBe(1);
    expect(r.totals.b.inputTokens - r.totals.a.inputTokens).toBe(20n);
  });

  it("compares a token count the trace did not report as different from one that it did", () => {
    const changed = base();
    delete changed[2].output;
    const r = diffRuns(modelOf(base()), modelOf(changed));
    expect(r.items[2].changes).toEqual([{ code: "OUTPUT_TOKENS", a: "100", b: "not reported", fields: [] }]);
  });

  it("detects different recorded content in two runs that kept only fingerprints", () => {
    const changed = base();
    changed[1] = { ...changed[1], result: "found 4 items" };
    const r = diffRuns(modelOf(base()), modelOf(changed));
    expect(r.contentComparable).toBe(true);
    expect(r.first?.changes).toEqual([{ code: "CONTENT", a: "", b: "", fields: ["gen_ai.tool.call.result"] }]);
  });

  it("treats equal content as equal across the two content modes", () => {
    const r = diffRuns(modelOf(base()), modelOf(base(), { full: true }));
    expect(r.identical).toBe(true);
    const changed = base();
    changed[3] = { ...changed[3], result: "saved!" };
    expect(diffRuns(modelOf(base()), modelOf(changed, { full: true })).firstIndex).toBe(3);
  });

  it("says when neither run recorded any content", () => {
    const plain = base().map(({ result: _result, ...rest }) => rest);
    expect(diffRuns(modelOf(plain), modelOf(plain)).contentComparable).toBe(false);
  });
});

describe("run diff: limits and reports", () => {
  it("refuses runs above the step limit without comparing", () => {
    const many = Array.from({ length: DIFF_LIMITS.maxSteps + 1 }, (_v, i) => ({ op: "chat" as const, start: i, end: i + 0.5, input: 1, output: 1 }));
    const big = modelOf(many);
    const r = diffRuns(big, big);
    expect(r.tooLarge).toBe(true);
    expect(r.identical).toBe(false);
    expect(diffReportLines(r, { a: "a", b: "b" }).join("\n")).toContain("too many steps");
  }, 60_000);

  it("falls back to removed-and-added when the middle is too large to align, and still finds the first difference", () => {
    const n = 2100;
    const a = Array.from({ length: n }, (_v, i) => ({ op: "execute_tool" as const, tool: `a${i}`, start: i, end: i + 0.5 }));
    const b = Array.from({ length: n }, (_v, i) => ({ op: "execute_tool" as const, tool: `b${i}`, start: i, end: i + 0.5 }));
    const r = diffRuns(modelOf(a), modelOf(b));
    expect(r.fullyAligned).toBe(false);
    expect(r.firstIndex).toBe(0);
    expect(r.counts).toMatchObject({ same: 0, onlyA: n, onlyB: n });
  }, 60_000);

  it("writes a plain-language report with the first difference, totals and notes", () => {
    const changed = base();
    changed[1] = { ...changed[1], tool: "browse" };
    const text = diffReportLines(diffRuns(modelOf(base()), modelOf(changed)), { a: "run-a", b: "run-b" }).join("\n");
    expect(text).toContain("the runs first differ at step 2");
    expect(text).toContain('Run A has "Tool call: search" where run B has "Tool call: browse".');
    expect(text).toContain("Input tokens: 300 in run A, 300 in run B (same)");
    expect(text).toContain("not treated as a difference");
    const same = diffReportLines(diffRuns(modelOf(base()), modelOf(base())), { a: "x", b: "y" }).join("\n");
    expect(same).toContain("match step for step");
  });

  it("caps the listed differences and counts the rest", () => {
    const a = Array.from({ length: 40 }, (_v, i) => ({ op: "execute_tool" as const, tool: `a${i}`, start: i, end: i + 0.5 }));
    const b = Array.from({ length: 40 }, (_v, i) => ({ op: "execute_tool" as const, tool: `b${i}`, start: i, end: i + 0.5 }));
    const text = diffReportLines(diffRuns(modelOf(a), modelOf(b)), { a: "x", b: "y" }, 5).join("\n");
    expect(text).toContain("... and 35 more.");
    expect(text).toContain("... and 75 more tools.");
    expect(text).toContain('Run A has "Tool call: a0" where run B has "Tool call: b0".');
  });
});

describe("run diff: the built-in demo runs", () => {
  const load = (name: string) => buildRunModel(parseRunLog(new Uint8Array(fs.readFileSync(new URL(`../src/frontend/assets/${name}`, import.meta.url)))));

  it("treats the demo kept with content and the demo kept as fingerprints only as the same recording", () => {
    const r = diffRuns(load("demo-run.runlog.jsonl"), load("demo-run-full.runlog.jsonl"));
    expect(r.identical).toBe(true);
    expect(r.contentComparable).toBe(true);
    expect(r.totals.a.steps).toBe(10);
  });
});
