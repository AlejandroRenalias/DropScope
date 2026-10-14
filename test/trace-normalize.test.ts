import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalJson, compareUtf8 } from "../src/canonical.js";
import { parseLogsRequest, parseTraceRequest } from "../src/otlp-structure.js";
import { ImportError } from "../src/run-import-error.js";
import { parseStrictJson } from "../src/strict-json.js";
import { fingerprintRun, normalizeRun, MAX_SPAN_TREE_DEPTH } from "../src/trace-normalize.js";

const T1 = "11111111111111111111111111111111";
const T2 = "22222222222222222222222222222222";
const id = (n: number) => n.toString(16).padStart(16, "0");
const enc = (value: unknown) => parseStrictJson(new TextEncoder().encode(JSON.stringify(value)), "parse");
const span = (n: number, overrides: Record<string, unknown> = {}) => ({
  traceId: T1, spanId: id(n), name: `s${n}`, startTimeUnixNano: "100", endTimeUnixNano: "200", ...overrides,
});
const request = (spans: unknown[], scope: Record<string, unknown> = {}) =>
  enc({ resourceSpans: [{ scopeSpans: [{ scope, spans }] }] });
const logRequest = (logRecords: unknown[]) => enc({ resourceLogs: [{ scopeLogs: [{ logRecords }] }] });

type Options = { select?: string; logs?: unknown[] };
function run(spans: unknown[], options: Options = {}) {
  const parsed = parseTraceRequest(request(spans));
  const logs = options.logs ? parseLogsRequest(logRequest(options.logs)) : undefined;
  return normalizeRun({
    spans: parsed.spans, spanContexts: parsed.contexts,
    logs: logs?.logs, logContexts: logs?.contexts, selectTrace: options.select,
  });
}
function codeOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    if (error instanceof ImportError) return error.code;
    throw error;
  }
}
const notesOf = (r: ReturnType<typeof run>, code: string) => r.notes.filter((n) => n.code === code);

describe("canonical JSON", () => {
  it("sorts keys, keeps array order, escapes strings and handles -0", () => {
    expect(canonicalJson({ b: [2, { z: 1, a: null }], a: "x\n\"", c: true, d: undefined })).toBe('{"a":"x\\n\\"","b":[2,{"a":null,"z":1}],"c":true}');
    expect(canonicalJson(-0)).toBe("-0");
    expect(canonicalJson(JSON.parse('{"__proto__":1}'))).toBe('{"__proto__":1}');
  });

  it("serializes very deep structures without overflowing the stack", () => {
    let value: unknown = 1;
    for (let i = 0; i < 100_000; i += 1) value = [value];
    expect(canonicalJson(value).length).toBe(200_001);
  });

  it("compares by UTF-8 bytes, which differs from UTF-16 order for astral characters", () => {
    const astral = "\u{1F600}";
    const bmp = "￿";
    expect(compareUtf8(astral, bmp)).toBeGreaterThan(0);
    expect(astral < bmp).toBe(true);
  });
});

describe("trace selection and filtering", () => {
  it("fails closed on no spans, several traces, or a missing selected trace", () => {
    expect(codeOf(() => run([]))).toBe("E_EMPTY");
    expect(codeOf(() => run([span(1), span(2, { traceId: T2 })]))).toBe("E_MULTIPLE_TRACES");
    expect(codeOf(() => run([span(1)], { select: T2 }))).toBe("E_TRACE_NOT_FOUND");
    expect(codeOf(() => run([span(1)], { select: "xyz" }))).toBe("E_ID");
  });

  it("selects explicitly, excludes other traces first, and counts them once", () => {
    const r = run([span(1), span(2, { traceId: T2 }), span(3, { traceId: T2 })], {
      select: T2.toUpperCase(),
      logs: [{ traceId: T1, spanId: id(1) }, { traceId: T2, spanId: id(2) }],
    });
    expect(r.selectedTrace).toBe("EXPLICIT");
    expect(r.spans.map((s) => s.spanId)).toEqual([id(2), id(3)]);
    expect(r.notes.filter((n) => n.code === "OTHER_TRACE_EXCLUDED")).toEqual([
      { code: "OTHER_TRACE_EXCLUDED", stepId: null, detail: { spans: 1, logs: 1 } },
    ]);
    expect(run([span(1)]).selectedTrace).toBe("ONLY");
  });

  it("does not let a conflicting duplicate in an excluded trace break the import", () => {
    const r = run([span(1), span(2, { traceId: T2 }), span(2, { traceId: T2, name: "different" })], { select: T1 });
    expect(r.spans.length).toBe(1);
  });

  it("associates logs by trace and span id and keeps the rest as orphans", () => {
    const r = run([span(1)], {
      logs: [
        { traceId: T1, spanId: id(1), body: { stringValue: "attached" } },
        { traceId: T1, spanId: id(9), body: { stringValue: "unknown span" } },
        { traceId: T1, body: { stringValue: "no span id" } },
        { spanId: id(1), body: { stringValue: "no trace id" } },
        { body: { stringValue: "nothing" } },
      ],
    });
    const byBody = Object.fromEntries(r.logs.map((l) => [(l.body as { v: string }).v, l.stepId]));
    expect(byBody).toEqual({ attached: id(1), "unknown span": null, "no span id": null, "no trace id": null, nothing: null });
  });
});

describe("duplicates", () => {
  it("collapses identical spans and logs and counts them", () => {
    const r = run([span(1), span(1), span(1)], { logs: [{ traceId: T1, spanId: id(1), timeUnixNano: "5" }, { traceId: T1, spanId: id(1), timeUnixNano: "5" }, { traceId: T1, spanId: id(1), timeUnixNano: "6" }] });
    expect(r.spans.length).toBe(1);
    expect(r.logs.length).toBe(2);
    expect(notesOf(r, "DUPLICATE_SPAN_COLLAPSED")[0].detail).toEqual({ count: 2 });
    expect(notesOf(r, "DUPLICATE_LOG_COLLAPSED")[0].detail).toEqual({ count: 1 });
  });

  it("fails closed when the same span id has different content", () => {
    expect(codeOf(() => run([span(1), span(1, { name: "other" })]))).toBe("E_CONFLICTING_DUPLICATE");
    expect(codeOf(() => run([span(1), span(1, { attributes: [{ key: "k", value: { stringValue: "v" } }] })]))).toBe("E_CONFLICTING_DUPLICATE");
  });

  it("treats the same span in a different scope as a conflict", () => {
    const a = parseTraceRequest(enc({ resourceSpans: [{ scopeSpans: [{ scope: { name: "a" }, spans: [span(1)] }, { scope: { name: "b" }, spans: [span(1)] }] }] }));
    expect(codeOf(() => normalizeRun({ spans: a.spans, spanContexts: a.contexts }))).toBe("E_CONFLICTING_DUPLICATE");
  });
});

describe("parent repair", () => {
  it("makes a span with a missing parent a root", () => {
    const r = run([span(1, { parentSpanId: id(99) }), span(2, { parentSpanId: id(1) })]);
    expect(r.spans.map((s) => [s.spanId, s.parentStepId, s.depth])).toEqual([[id(1), null, 0], [id(2), id(1), 1]]);
    expect(notesOf(r, "MISSING_PARENT").map((n) => n.stepId)).toEqual([id(1)]);
  });

  it("breaks a cycle at the smallest span id, including self-parents", () => {
    const r = run([span(3, { parentSpanId: id(5) }), span(4, { parentSpanId: id(3) }), span(5, { parentSpanId: id(4) }), span(7, { parentSpanId: id(7) }), span(8, { parentSpanId: id(7) })]);
    expect(r.spans.find((s) => s.spanId === id(3))?.parentStepId).toBeNull();
    expect(r.spans.find((s) => s.spanId === id(4))?.parentStepId).toBe(id(3));
    expect(r.spans.find((s) => s.spanId === id(7))?.parentStepId).toBeNull();
    expect(r.spans.find((s) => s.spanId === id(8))?.depth).toBe(1);
    expect(notesOf(r, "PARENT_CYCLE_BROKEN").map((n) => n.stepId).sort()).toEqual([id(3), id(7)]);
  });

  it("computes depth for long chains without recursion and enforces the depth limit", () => {
    const chain = (length: number) => Array.from({ length }, (_, i) => span(i + 1, i === 0 ? {} : { parentSpanId: id(i) }));
    const ok = run(chain(MAX_SPAN_TREE_DEPTH + 1));
    expect(ok.spans[MAX_SPAN_TREE_DEPTH].depth).toBe(MAX_SPAN_TREE_DEPTH);
    expect(codeOf(() => run(chain(MAX_SPAN_TREE_DEPTH + 2)))).toBe("E_LIMIT");
  });
});

describe("time repair", () => {
  it("uses the largest valid time for unfinished spans and ignores them when computing it", () => {
    const r = run([
      span(1, { startTimeUnixNano: "100", endTimeUnixNano: undefined }),
      span(2, { startTimeUnixNano: "300", endTimeUnixNano: "900" }),
      span(3, { startTimeUnixNano: "50", endTimeUnixNano: "0" }),
    ]);
    expect(r.maxNs).toBe("900");
    expect(r.spans.map((s) => s.endEffectiveNs)).toEqual(["900", "900", "900"]);
    expect(notesOf(r, "UNFINISHED_SPAN_CLOSED").map((n) => n.stepId)).toEqual([id(1), id(3)]);
  });

  it("clamps an end before its start without letting it raise the maximum", () => {
    const r = run([span(1, { startTimeUnixNano: "500", endTimeUnixNano: "400" }), span(2, { startTimeUnixNano: "100", endTimeUnixNano: "200" })]);
    expect(r.spans[0].endEffectiveNs).toBe("500");
    expect(r.maxNs).toBe("500");
    expect(notesOf(r, "NEGATIVE_DURATION_CLAMPED").map((n) => n.stepId)).toEqual([id(1)]);
  });

  it("gives an unfinished span of the latest start zero duration", () => {
    const r = run([span(1, { startTimeUnixNano: "700", endTimeUnixNano: undefined })]);
    expect(r.spans[0].endEffectiveNs).toBe("700");
  });

  it("notes a child outside its parent's interval", () => {
    const r = run([
      span(1, { startTimeUnixNano: "100", endTimeUnixNano: "200" }),
      span(2, { parentSpanId: id(1), startTimeUnixNano: "150", endTimeUnixNano: "250" }),
      span(3, { parentSpanId: id(1), startTimeUnixNano: "200", endTimeUnixNano: "210" }),
      span(4, { parentSpanId: id(1), startTimeUnixNano: "120", endTimeUnixNano: "180" }),
      span(5, { parentSpanId: id(1), startTimeUnixNano: "90", endTimeUnixNano: "95" }),
    ]);
    expect(notesOf(r, "CHILD_OUTSIDE_PARENT_INTERVAL").map((n) => n.stepId)).toEqual([id(2), id(3)]);
  });

  it("handles the largest uint64 times exactly", () => {
    const r = run([span(1, { startTimeUnixNano: "18446744073709551614", endTimeUnixNano: "18446744073709551615" })]);
    expect(r.maxNs).toBe("18446744073709551615");
  });
});

describe("contexts and determinism", () => {
  it("shares one context id between spans and logs with the same content, and drops unused contexts", () => {
    const spans = parseTraceRequest(enc({ resourceSpans: [{ scopeSpans: [
      { scope: { name: "used" }, spans: [span(1)] },
      { scope: { name: "excluded" }, spans: [span(2, { traceId: T2 })] },
    ] }] }));
    const logs = parseLogsRequest(enc({ resourceLogs: [{ scopeLogs: [{ scope: { name: "used" }, logRecords: [{ traceId: T1, spanId: id(1) }] }] }] }));
    const r = normalizeRun({ spans: spans.spans, spanContexts: spans.contexts, logs: logs.logs, logContexts: logs.contexts, selectTrace: T1 });
    expect(r.contexts.length).toBe(1);
    expect(r.spans[0].contextId).toBe(r.logs[0].contextId);
  });

  const shuffle = <T,>(items: T[], seed: number): T[] => {
    const copy = [...items];
    let state = seed;
    for (let i = copy.length - 1; i > 0; i -= 1) {
      state = (state * 1103515245 + 12345) % 2147483648;
      const j = state % (i + 1);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };

  it("gives the same result for any input order, with messy data", () => {
    const messy = [
      span(1), span(2, { parentSpanId: id(1), endTimeUnixNano: undefined }), span(3, { parentSpanId: id(77) }),
      span(4, { parentSpanId: id(5) }), span(5, { parentSpanId: id(4) }), span(6, { startTimeUnixNano: "300", endTimeUnixNano: "250" }),
      span(1), span(9, { traceId: T2 }),
    ];
    const logs = [{ traceId: T1, spanId: id(1), timeUnixNano: "9" }, { traceId: T1, spanId: id(2), timeUnixNano: "3" }, { traceId: T1, spanId: id(1), timeUnixNano: "9" }, { body: { stringValue: "o" } }];
    const baseline = fingerprintRun(run(messy, { select: T1, logs }));
    for (let seed = 1; seed <= 25; seed += 1) {
      expect(fingerprintRun(run(shuffle(messy, seed), { select: T1, logs: shuffle(logs, seed + 100) }))).toBe(baseline);
    }
  });
});

describe("real spike traces", () => {
  const dir = new URL("../docs/development/spike-2026-10-13/traces/", import.meta.url);
  const load = (name: string) => parseStrictJson(readFileSync(new URL(name, dir)), "parse");

  it("normalizes trace d with its logs, associating every log with a step", () => {
    const spans = parseTraceRequest(load("trace-d.json"));
    const logs = parseLogsRequest(load("trace-d.logs.json"));
    const r = normalizeRun({ spans: spans.spans, spanContexts: spans.contexts, logs: logs.logs, logContexts: logs.contexts });
    expect(r.spans.length).toBe(56);
    expect(r.logs.length).toBe(28);
    expect(r.logs.filter((l) => l.stepId === null).length).toBe(0);
    expect(r.spans.filter((s) => s.parentStepId === null).length).toBeGreaterThan(0);
  });

  it.each(["trace-a.json", "trace-b.json", "trace-c.json"])("normalizes %s", (name) => {
    const spans = parseTraceRequest(load(name));
    const r = normalizeRun({ spans: spans.spans, spanContexts: spans.contexts });
    expect(r.spans.length).toBe(spans.spans.length);
  });
});
