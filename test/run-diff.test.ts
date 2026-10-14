import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { buildRunModel } from "../src/frontend/run-replay-model.js";
import { DIFF_LIMITS, diffRuns } from "../src/run-diff.js";
import { DIFF_TEXT_LIMIT, diffReportLines } from "../src/run-diff-report.js";
import { importTraceBytes } from "../src/run-import.js";
import { parseRunLog } from "../src/run-log-format.js";
import { serializeRunLog } from "../src/run-store.js";

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

  it("prints DIFF_TEXT_LIMIT differences by default (the number the screen's notice quotes)", () => {
    const a = Array.from({ length: 40 }, (_v, i) => ({ op: "execute_tool" as const, tool: `a${i}`, start: i, end: i + 0.5 }));
    const b = Array.from({ length: 40 }, (_v, i) => ({ op: "execute_tool" as const, tool: `b${i}`, start: i, end: i + 0.5 }));
    const lines = diffReportLines(diffRuns(modelOf(a), modelOf(b)), { a: "x", b: "y" });
    expect(lines.filter((l) => l.startsWith("  Run A has "))).toHaveLength(DIFF_TEXT_LIMIT);
    expect(DIFF_TEXT_LIMIT).toBe(25);
    expect(lines).toContain(`  ... and ${40 - DIFF_TEXT_LIMIT} more.`);
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

describe("run diff: the demo variant", () => {
  const load = (name: string) => buildRunModel(parseRunLog(new Uint8Array(fs.readFileSync(new URL(`../src/frontend/assets/${name}`, import.meta.url)))));
  it("differs from the demo kept with content: the second refund fails and the final answer says so", () => {
    const r = diffRuns(load("demo-run-full.runlog.jsonl"), load("demo-run-variant.runlog.jsonl"));
    expect(r.identical).toBe(false);
    expect(r.counts).toMatchObject({ onlyA: 0, onlyB: 0 });
    expect(r.counts.changed).toBe(2);
    expect(r.first?.changes.map((c) => c.code)).toContain("STATUS");
    expect(r.totals.a.failedSteps).toBe(1);
    expect(r.totals.b.failedSteps).toBe(2);
  });

  it("cannot be compared on content with the demo kept as fingerprints only without losing the structural difference", () => {
    const r = diffRuns(load("demo-run.runlog.jsonl"), load("demo-run-variant.runlog.jsonl"));
    expect(r.identical).toBe(false);
    expect(r.counts.changed).toBe(2);
  });

  it("prints exactly this report for the demo and its variant (whole output, so whitespace and ordering are pinned)", () => {
    const lines = diffReportLines(diffRuns(load("demo-run-full.runlog.jsonl"), load("demo-run-variant.runlog.jsonl")), { a: "A", b: "B" });
    expect(lines).toEqual([
      "Run A: A",
      "Run B: B",
      "",
      "Result: the runs first differ at step 7 of the aligned list.",
      "  Look at: run A event 24, run B event 24 (use the state command with --at to see each run there).",
      "  Steps in both and unchanged: 8; changed: 2; only in A: 0; only in B: 0.",
      "Differences:",
      "  \"Tool call: issue_refund\" is in both runs, but it succeeded in run A but failed in run B; its status or failure message differs; recorded content differs (gen_ai.tool.call.result).",
      "  \"Model call: chat sim-model-1\" is in both runs, but input tokens: 2010 in run A, 2190 in run B; output tokens: 240 in run A, 260 in run B; recorded content differs (gen_ai.output.messages).",
      "Totals:",
      "  Steps: 10 in run A, 10 in run B (same)",
      "  Model calls: 4 in run A, 4 in run B (same)",
      "  Tool calls: 4 in run A, 4 in run B (same)",
      "  Failed steps: 1 in run A, 2 in run B",
      "  Input tokens: 5,530 in run A, 5,710 in run B",
      "  Output tokens: 785 in run A, 805 in run B",
      "  Time: 9.1 s in run A, 9.1 s in run B (same)",
      "Notes:",
      "  - Steps are matched by what they are (kind, operation, model name, and tool or agent name, using the full recorded values) in tree order, not by id, because ids differ between runs. A difference means the two recordings differ, not that either run is right.",
      "  - Not compared: how long each step took, step events, log record times and severities, log records that carry no content, attributes that are neither a name used for matching nor recorded content, and content of log records that belong to no step.",
      "  - Time is shown in the totals only: two honest runs never take exactly as long, so it is not treated as a difference.",
      "  - Recorded content is compared by fingerprint, so a run kept with its content and one kept without it can still be compared.",
    ]);
  });

  it("prints exactly this report for two runs that match (whole output)", () => {
    const lines = diffReportLines(diffRuns(load("demo-run.runlog.jsonl"), load("demo-run-full.runlog.jsonl")), { a: "A", b: "B" });
    expect(lines).toEqual([
      "Run A: A",
      "Run B: B",
      "",
      "Result: the runs match step for step in step names, nesting, outcome, status messages, token counts and recorded content (see the notes for what is not compared).",
      "Totals:",
      "  Steps: 10 in run A, 10 in run B (same)",
      "  Model calls: 4 in run A, 4 in run B (same)",
      "  Tool calls: 4 in run A, 4 in run B (same)",
      "  Failed steps: 1 in run A, 1 in run B (same)",
      "  Input tokens: 5,530 in run A, 5,530 in run B (same)",
      "  Output tokens: 785 in run A, 785 in run B (same)",
      "  Time: 9.1 s in run A, 9.1 s in run B (same)",
      "Notes:",
      "  - Steps are matched by what they are (kind, operation, model name, and tool or agent name, using the full recorded values) in tree order, not by id, because ids differ between runs. A difference means the two recordings differ, not that either run is right.",
      "  - Not compared: how long each step took, step events, log record times and severities, log records that carry no content, attributes that are neither a name used for matching nor recorded content, and content of log records that belong to no step.",
      "  - Time is shown in the totals only: two honest runs never take exactly as long, so it is not treated as a difference.",
      "  - Recorded content is compared by fingerprint, so a run kept with its content and one kept without it can still be compared.",
    ]);
  });
});

// ---- review round 1: things that must NOT compare as identical ----
describe("run diff: review round 1", () => {
  type Raw = Record<string, unknown>;
  const T = "1".repeat(32);
  const sAttr = (key: string, value: string) => ({ key, value: { stringValue: value } });
  const span = (i: number, attrs: Raw[], extra: Raw = {}, parent?: number): Raw => ({
    traceId: T, spanId: id(i), ...(parent === undefined ? {} : { parentSpanId: id(parent) }), name: `s${i}`,
    startTimeUnixNano: ns(i), endTimeUnixNano: ns(i + 0.5), attributes: attrs, ...extra,
  });
  const tool = (i: number, name: string, parent?: number, extra: Raw = {}, more: Raw[] = []) =>
    span(i, [sAttr("gen_ai.operation.name", "execute_tool"), sAttr("gen_ai.tool.name", name), ...more], extra, parent);
  const enc = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
  const events = (spans: Raw[], logs?: Raw[]) => importTraceBytes({
    spans: enc({ resourceSpans: [{ scopeSpans: [{ spans }] }] }),
    ...(logs ? { logs: enc({ resourceLogs: [{ scopeLogs: [{ logRecords: logs }] }] }) } : {}),
    contentMode: "FULL",
  });
  const model = (spans: Raw[], logs?: Raw[]) => buildRunModel(events(spans, logs));

  it("does not treat tool names that differ only after the 80th character as the same", () => {
    const r = diffRuns(model([tool(0, `${"x".repeat(80)}a`)]), model([tool(0, `${"x".repeat(80)}b`)]));
    expect(r.identical).toBe(false);
  });

  it("does not treat two different agent operations with the same name as the same", () => {
    const agent = (op: string) => span(0, [sAttr("gen_ai.operation.name", op), sAttr("gen_ai.agent.name", "researcher")]);
    const r = diffRuns(model([agent("create_agent")]), model([agent("invoke_agent")]));
    expect(r.identical).toBe(false);
  });

  it("tells apart steps whose operation is one the importer does not recognise", () => {
    const odd = (op: string) => span(0, [sAttr("gen_ai.operation.name", op)]);
    expect(diffRuns(model([odd("frobnicate")]), model([odd("polish")])).identical).toBe(false);
    expect(diffRuns(model([odd("frobnicate")]), model([odd("frobnicate")])).identical).toBe(true);
  });

  it("notices when a step moved to a different parent", () => {
    const agent = span(0, [sAttr("gen_ai.operation.name", "invoke_agent"), sAttr("gen_ai.agent.name", "boss")]);
    const nested = model([agent, tool(1, "search", 0)]);
    const flat = model([agent, tool(1, "search")]);
    const r = diffRuns(nested, flat);
    expect(r.identical).toBe(false);
    expect(r.items.flatMap((i) => i.changes.map((c) => c.code))).toEqual(["PARENT"]);
    expect(diffRuns(nested, model([agent, tool(1, "search", 0)])).identical).toBe(true);
  });

  it("notices repeated content records for the same key", () => {
    const base = events([tool(0, "search", undefined, {}, [sAttr("gen_ai.tool.call.result", "final")])]);
    const content = base.findIndex((e) => e.type === "ContentRecorded");
    const copy = structuredClone(base[content]) as typeof base[number] & { payload: { value: unknown } };
    copy.payload.value = { v: { t: "s", v: "earlier" } };
    const doubled = structuredClone([...base.slice(0, content), copy, ...base.slice(content)]).map((e, k) => ({ ...e, sequenceNumber: k + 1 })) as typeof base;
    const end = doubled[doubled.length - 1];
    if (end.type === "RunEnded") end.payload.eventCount = doubled.length;
    const reread = buildRunModel(parseRunLog(serializeRunLog(doubled)));
    expect(diffRuns(reread, buildRunModel(base)).identical).toBe(false);
  });

  it("notices a different log body on the same step", () => {
    const log = (text: string) => [{ traceId: T, spanId: id(0), timeUnixNano: ns(0.2), observedTimeUnixNano: ns(0.2), body: { stringValue: text } }];
    const spans = [span(0, [sAttr("gen_ai.operation.name", "chat")])];
    expect(diffRuns(model(spans, log("answer A")), model(spans, log("answer B"))).identical).toBe(false);
    expect(diffRuns(model(spans, log("answer A")), model(spans, log("answer A"))).identical).toBe(true);
  });

  it("notices a different failure message", () => {
    const failing = (message: string) => [tool(0, "search", undefined, { status: { code: 2, message } })];
    const r = diffRuns(model(failing("disk full")), model(failing("timeout")));
    expect(r.identical).toBe(false);
    expect(r.first?.changes.map((c) => c.code)).toEqual(["STATUS_MESSAGE"]);
  });

  it("distinguishes custom content keys that hold the same value", () => {
    const withKey = (key: string) => [tool(0, "search", undefined, {}, [sAttr(key, "same value")])];
    const r = diffRuns(model(withKey("gen_ai.custom_one")), model(withKey("gen_ai.custom_two")));
    expect(r.identical).toBe(false);
  });

  it("still trims a large shared start and end so a small change in the middle is found without the fallback", () => {
    const n = 4000;
    const list = (middle: string) => Array.from({ length: n }, (_v, i) => tool(i, i === n / 2 ? middle : `t${i}`));
    const r = diffRuns(model(list("left")), model(list("right")));
    expect(r.fullyAligned).toBe(true);
    expect(r.firstIndex).toBe(n / 2);
    expect(r.counts).toEqual({ same: n - 1, changed: 0, onlyA: 1, onlyB: 1 });
  }, 60_000);

  it("says in the report what was and was not compared", () => {
    const r = diffRuns(model([tool(0, "a")]), model([tool(0, "a")]));
    const text = diffReportLines(r, { a: "x", b: "y" }).join("\n");
    expect(text).toContain("step names, nesting");
    expect(text).toContain("Not compared:");
  });

  it("describes partly reported token counts truthfully", () => {
    const partial = model([span(0, [sAttr("gen_ai.operation.name", "chat"), { key: "gen_ai.usage.input_tokens", value: { intValue: "100" } }])]);
    const text = diffReportLines(diffRuns(partial, partial), { a: "x", b: "y" }).join("\n");
    expect(text).toContain("missing an input or an output token count");
    expect(text).not.toContain("had no token count");
  });
});

// ---- review round 2 ----
describe("run diff: review round 2", () => {
  type Raw = Record<string, unknown>;
  const T = "1".repeat(32);
  const sAttr = (key: string, value: string) => ({ key, value: { stringValue: value } });
  const span = (i: number, attrs: Raw[], parent?: number): Raw => ({
    traceId: T, spanId: id(i), ...(parent === undefined ? {} : { parentSpanId: id(parent) }), name: `s${i}`,
    startTimeUnixNano: ns(i), endTimeUnixNano: ns(i + 0.5), attributes: attrs,
  });
  const tool = (i: number, name: string, parent?: number, more: Raw[] = []) =>
    span(i, [sAttr("gen_ai.operation.name", "execute_tool"), sAttr("gen_ai.tool.name", name), ...more], parent);
  const enc = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
  const eventsOf = (spans: Raw[], logs?: Raw[]) => importTraceBytes({
    spans: enc({ resourceSpans: [{ scopeSpans: [{ spans }] }] }),
    ...(logs ? { logs: enc({ resourceLogs: [{ scopeLogs: [{ logRecords: logs }] }] }) } : {}),
    contentMode: "FULL",
  });
  const model = (spans: Raw[], logs?: Raw[]) => buildRunModel(eventsOf(spans, logs));

  /** The run's events with the first content record replaced by one record per value (same key), in the order given. */
  function modelWithValues(values: string[]) {
    const base = eventsOf([tool(0, "search", undefined, [sAttr("gen_ai.tool.call.result", "x")])]);
    const at = base.findIndex((e) => e.type === "ContentRecorded");
    const copies = values.map((v) => {
      const copy = structuredClone(base[at]) as (typeof base)[number] & { payload: { value: unknown } };
      copy.payload.value = { v: { t: "s", v } };
      return copy;
    });
    const all = structuredClone([...base.slice(0, at), ...copies, ...base.slice(at + 1)]).map((e, k) => ({ ...e, sequenceNumber: k + 1 })) as typeof base;
    const end = all[all.length - 1];
    if (end.type === "RunEnded") end.payload.eventCount = all.length;
    return buildRunModel(parseRunLog(serializeRunLog(all)));
  }

  it("keeps log records whole: an attribute moving from one record to another is a difference", () => {
    const log = (t: number, body: string, extra: Raw[] = []) => ({ traceId: T, spanId: id(0), timeUnixNano: ns(t), observedTimeUnixNano: ns(t), body: { stringValue: body }, attributes: extra });
    const spans = [span(0, [sAttr("gen_ai.operation.name", "chat")])];
    const a = model(spans, [log(0.1, "A", [sAttr("gen_ai.custom", "value")]), log(0.2, "B")]);
    const b = model(spans, [log(0.1, "A"), log(0.2, "B", [sAttr("gen_ai.custom", "value")])]);
    const r = diffRuns(a, b);
    expect(r.identical).toBe(false);
    expect(r.first?.changes).toEqual([{ code: "CONTENT", a: "", b: "", fields: ["log records"] }]);
    expect(diffRuns(a, model(spans, [log(0.1, "A", [sAttr("gen_ai.custom", "value")]), log(0.2, "B")])).identical).toBe(true);
  });

  it("does not report a moved parent it could not check when the runs are too different to line up", () => {
    const n = 2100;
    const side = (prefix: string, first: string) => [
      tool(0, first), tool(1, "p"),
      ...Array.from({ length: n }, (_v, i) => tool(2 + i, `${prefix}${i}`, 1)),
      tool(2 + n, "tail", 1),
    ];
    const r = diffRuns(model(side("a", "firstA")), model(side("b", "firstB")));
    expect(r.fullyAligned).toBe(false);
    const tail = r.items.find((i) => i.a?.title === "Tool call: tail");
    expect(tail?.changes).toEqual([]);
    expect(r.unverifiedNesting).toBe(1);
    expect(diffReportLines(r, { a: "x", b: "y" }).join("\n")).toContain("whether their nesting changed was not checked");
  }, 60_000);

  describe("nesting when the runs are too different to line up", () => {
    const n = 2100;
    const many = (prefix: string, parent: number | undefined, from: number) =>
      Array.from({ length: n }, (_v, i) => tool(from + i, `${prefix}${i}`, parent));

    it("reports a change that is proved because one step is top-level and the other is not, in both directions", () => {
      const side = (prefix: string, first: string, tailTop: boolean) => [
        tool(0, first), tool(1, "p"), ...many(prefix, 1, 2), tool(2 + n, "tail", tailTop ? undefined : 1),
      ];
      const a = model(side("a", "firstA", false));
      const b = model(side("b", "firstB", true));
      for (const r of [diffRuns(a, b), diffRuns(b, a)]) {
        expect(r.fullyAligned).toBe(false);
        const tail = r.items.find((i) => (i.a ?? i.b)?.title === "Tool call: tail");
        expect(tail?.changes.map((c) => c.code)).toEqual(["PARENT"]);
        expect(r.unverifiedNesting).toBe(0);
      }
    });

    it("reports a change that is proved because one parent is paired and the other run's parent is not", () => {
      // Steps are compared in tree order. Both runs start with the shared step "p" and end with the shared step "tail".
      // In run A the tail is the last child of "p" (a paired parent); in run B it is a child of the last step only run B has.
      const a = model([tool(0, "p"), ...many("a", 0, 1), tool(1 + n, "tail", 0)]);
      const b = model([tool(0, "p"), ...many("b", 0, 1), tool(1 + n, "tail", n)]);
      for (const r of [diffRuns(a, b), diffRuns(b, a)]) {
        expect(r.fullyAligned).toBe(false);
        const tail = r.items.find((i) => (i.a ?? i.b)?.title === "Tool call: tail");
        expect(tail?.changes.map((c) => c.code)).toEqual(["PARENT"]);
        expect(r.unverifiedNesting).toBe(0);
      }
    });

    it("counts each step whose nesting could not be checked, so two children of one unmatched parent count twice", () => {
      const side = (prefix: string, first: string, parentName: string) => [
        tool(0, first), ...many(prefix, undefined, 1), tool(1 + n, parentName),
        tool(2 + n, "t1", 1 + n), tool(3 + n, "t2", 1 + n),
      ];
      const r = diffRuns(model(side("a", "firstA", "pA")), model(side("b", "firstB", "pB")));
      expect(r.fullyAligned).toBe(false);
      expect(r.items.filter((i) => i.status === "same").length).toBe(2);
      expect(r.unverifiedNesting).toBe(2);
    });
  });

  it("compares repeated content in one log record in order", () => {
    const logModel = (values: string[]) => {
      const base = eventsOf([span(0, [sAttr("gen_ai.operation.name", "chat")])],
        [{ traceId: T, spanId: id(0), timeUnixNano: ns(0.1), observedTimeUnixNano: ns(0.1), body: { stringValue: "x" } }]);
      const at = base.findIndex((e) => e.type === "ContentRecorded");
      const copies = values.map((v) => {
        const copy = structuredClone(base[at]) as (typeof base)[number] & { payload: { value: unknown } };
        copy.payload.value = { v: { t: "s", v } };
        return copy;
      });
      const all = structuredClone([...base.slice(0, at), ...copies, ...base.slice(at + 1)]).map((e, k) => ({ ...e, sequenceNumber: k + 1 })) as typeof base;
      const end = all[all.length - 1];
      if (end.type === "RunEnded") end.payload.eventCount = all.length;
      return buildRunModel(parseRunLog(serializeRunLog(all)));
    };
    expect(diffRuns(logModel(["early", "final"]), logModel(["final", "early"])).identical).toBe(false);
    expect(diffRuns(logModel(["early", "final"]), logModel(["early", "final"])).identical).toBe(true);
    // The same value recorded twice is not the same as recorded once.
    expect(diffRuns(logModel(["same", "same"]), logModel(["same"])).identical).toBe(false);
  });

  it("still reports a real moved parent when the runs line up in full", () => {
    const agent = span(0, [sAttr("gen_ai.operation.name", "invoke_agent"), sAttr("gen_ai.agent.name", "boss")]);
    const r = diffRuns(model([agent, tool(1, "search", 0)]), model([agent, tool(1, "search")]));
    expect(r.fullyAligned).toBe(true);
    expect(r.unverifiedNesting).toBe(0);
    expect(r.items.flatMap((i) => i.changes.map((c) => c.code))).toEqual(["PARENT"]);
  });

  it("reports a changed parent when the old parent exists only in one run and the runs line up in full", () => {
    const agent = span(0, [sAttr("gen_ai.operation.name", "invoke_agent"), sAttr("gen_ai.agent.name", "boss")]);
    const r = diffRuns(model([agent, tool(1, "search", 0)]), model([tool(0, "search")]));
    expect(r.fullyAligned).toBe(true);
    const search = r.items.find((i) => i.a?.title === "Tool call: search");
    expect(search?.changes.map((c) => c.code)).toEqual(["PARENT"]);
    expect(r.unverifiedNesting).toBe(0);
  });

  it("reports a changed parent when both parents are different steps and the runs line up in full", () => {
    const r = diffRuns(model([tool(0, "pA"), tool(1, "child", 0)]), model([tool(0, "pB"), tool(1, "child", 0)]));
    expect(r.fullyAligned).toBe(true);
    const child = r.items.find((i) => i.a?.title === "Tool call: child");
    expect(child?.changes.map((c) => c.code)).toEqual(["PARENT"]);
    expect(r.unverifiedNesting).toBe(0);
  });

  it("tells apart operations the importer folds into the same label", () => {
    const op = (o: string) => [span(0, [sAttr("gen_ai.operation.name", o)])];
    const r = diffRuns(model(op("custom-op")), model(op("other-op")));
    expect(r.identical).toBe(false);
  });

  it("tells apart two agents by name when everything else is equal", () => {
    const agent = (name: string) => [span(0, [sAttr("gen_ai.operation.name", "invoke_agent"), sAttr("gen_ai.agent.name", name)])];
    expect(diffRuns(model(agent("alpha")), model(agent("beta"))).identical).toBe(false);
    expect(diffRuns(model(agent("alpha")), model(agent("alpha"))).identical).toBe(true);
  });

  it("tells apart two models for the same operation, and says model names are compared", () => {
    const chat = (m: string) => [span(0, [sAttr("gen_ai.operation.name", "chat"), sAttr("gen_ai.request.model", m)])];
    const r = diffRuns(model(chat("model-a")), model(chat("model-b")));
    expect(r.identical).toBe(false);
    const text = diffReportLines(r, { a: "x", b: "y" }).join("\n");
    expect(text).toContain("model name");
    expect(text).not.toContain("attributes other than the names above");
  });

  it("compares repeated content records in order, and counts every record", () => {
    expect(diffRuns(modelWithValues(["early", "final"]), modelWithValues(["final", "early"])).identical).toBe(false);
    expect(diffRuns(modelWithValues(["same", "same"]), modelWithValues(["same"])).identical).toBe(false);
    expect(diffRuns(modelWithValues(["early", "final"]), modelWithValues(["early", "final"])).identical).toBe(true);
    expect(diffRuns(modelWithValues(["early", "final"]), modelWithValues(["final"])).identical).toBe(false);
  });
});
