import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ImportError } from "../src/run-import-error.js";
import { parseLogsRequest, parseTraceRequest, DEFAULT_STRUCTURE_LIMITS } from "../src/otlp-structure.js";
import { parseStrictJson } from "../src/strict-json.js";

const TRACE = "0123456789abcdef0123456789abcdef";
const SPAN = "00000000000000a1";
const spikeDir = new URL("../docs/development/spike-2026-10-13/traces/", import.meta.url);
const load = (name: string) => parseStrictJson(readFileSync(new URL(name, spikeDir)), "parse");
const json = (value: unknown) => parseStrictJson(new TextEncoder().encode(JSON.stringify(value)), "parse");

const span = (overrides: Record<string, unknown> = {}) => ({
  traceId: TRACE, spanId: SPAN, name: "n", kind: 1, startTimeUnixNano: "100", endTimeUnixNano: "200", ...overrides,
});
const traceRequest = (spans: unknown[]) => json({ resourceSpans: [{ scopeSpans: [{ spans }] }] });
const logRequest = (logRecords: unknown[]) => json({ resourceLogs: [{ scopeLogs: [{ logRecords }] }] });

function codeOf(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    if (error instanceof ImportError) return error.code;
    throw error;
  }
}
const spanCode = (overrides: Record<string, unknown>) => codeOf(() => parseTraceRequest(traceRequest([span(overrides)])));
const attrCode = (value: unknown) =>
  codeOf(() => parseTraceRequest(traceRequest([span({ attributes: [{ key: "k", value }] })])));

describe("spike traces", () => {
  it.each([["trace-a.json", 56], ["trace-b.json", 56], ["trace-c.json", 16], ["trace-d.json", 56]])("%s parses with %i spans", (name, count) => {
    const parsed = parseTraceRequest(load(name));
    expect(parsed.spans.length).toBe(count);
    expect(parsed.spans.every((s) => /^[0-9a-f]{32}$/.test(s.traceId) && /^[0-9a-f]{16}$/.test(s.spanId))).toBe(true);
    expect(parsed.spans.filter((s) => s.parentSpanId === null).length).toBeGreaterThan(0);
  });

  it("parses the log records that go with trace d", () => {
    const parsed = parseLogsRequest(load("trace-d.logs.json"));
    expect(parsed.logs.length).toBe(28);
    // The instrumentation wrote an empty body ({}) on every record; that means "no body".
    expect(parsed.logs.every((l) => l.body === null)).toBe(true);
  });
});

describe("spans", () => {
  it("normalizes ids, integers, defaults and no-parent forms", () => {
    const parsed = parseTraceRequest(traceRequest([
      span({ traceId: TRACE.toUpperCase(), parentSpanId: "0000000000000000", flags: "256", droppedEventsCount: 3 }),
      span({ spanId: "00000000000000a2", parentSpanId: "" }),
      span({ spanId: "00000000000000a3", parentSpanId: SPAN, startTimeUnixNano: 1699999999999 }),
    ]));
    const [a, b, c] = parsed.spans;
    expect(a.traceId).toBe(TRACE);
    expect(a.parentSpanId).toBeNull();
    expect(a.flags).toBe(256);
    expect(a.droppedEventsCount).toBe(3);
    expect(b.parentSpanId).toBeNull();
    expect(c.parentSpanId).toBe(SPAN);
    expect(c.startNs).toBe("1699999999999");
    expect(a.endNs).toBe("200");
    expect(a.statusCode).toBe(0);
  });

  it("treats a missing end time as null, and a zero end as zero", () => {
    const parsed = parseTraceRequest(traceRequest([
      span({ endTimeUnixNano: undefined }),
      span({ spanId: "00000000000000a2", endTimeUnixNano: "0" }),
    ]));
    expect(parsed.spans.map((s) => s.endNs)).toEqual([null, "0"]);
  });

  it("rejects bad ids", () => {
    for (const bad of [{ traceId: "0".repeat(32) }, { spanId: "0".repeat(16) }, { traceId: "abc" }, { spanId: TRACE },
      { traceId: undefined }, { spanId: "zzzzzzzzzzzzzzzz" }, { traceId: 5 }, { parentSpanId: "123" }]) {
      expect(spanCode(bad), JSON.stringify(bad)).toBe("E_ID");
    }
  });

  it("rejects bad integers", () => {
    const bad: Array<Record<string, unknown>> = [
      { startTimeUnixNano: "0" }, { startTimeUnixNano: 0 }, { startTimeUnixNano: undefined },
      { startTimeUnixNano: "-5" }, { startTimeUnixNano: "18446744073709551616" },
      { startTimeUnixNano: 9007199254740993 }, { startTimeUnixNano: 1.5 }, { startTimeUnixNano: "1e3" },
      { startTimeUnixNano: "123456789012345678901" }, { startTimeUnixNano: true },
      { endTimeUnixNano: "-1" }, { flags: "4294967296" }, { droppedAttributesCount: -1 },
    ];
    for (const overrides of bad) expect(spanCode(overrides), JSON.stringify(overrides)).toBe("E_NUMBER");
  });

  it("accepts the largest uint64 as a string", () => {
    const parsed = parseTraceRequest(traceRequest([span({ endTimeUnixNano: "18446744073709551615" })]));
    expect(parsed.spans[0].endNs).toBe("18446744073709551615");
  });

  it("accepts enum names and integers, counts the names, and rejects unknown values", () => {
    const parsed = parseTraceRequest(traceRequest([
      span({ kind: "SPAN_KIND_CLIENT", status: { code: "STATUS_CODE_ERROR", message: "boom" } }),
      span({ spanId: "00000000000000a2", kind: 5, status: { code: 1 } }),
    ]));
    expect(parsed.spans.map((s) => [s.kind, s.statusCode])).toEqual([[3, 2], [5, 1]]);
    expect(parsed.stats.enumNamesAccepted).toBe(2);
    expect(parsed.spans[0].statusMessage).toBe("boom");
    for (const bad of [{ kind: 6 }, { kind: "CLIENT" }, { kind: "__proto__" }, { kind: -1 }, { kind: 1.5 }, { kind: true },
      { status: { code: 3 } }, { status: { code: "2" } }, { status: { code: "OK" } }]) {
      expect(spanCode(bad), JSON.stringify(bad)).toBe("E_ENUM");
    }
  });

  it("keeps events, links, attribute order and duplicate attribute keys", () => {
    const parsed = parseTraceRequest(traceRequest([span({
      attributes: [{ key: "k", value: { stringValue: "1" } }, { key: "k", value: { stringValue: "2" } }],
      events: [{ timeUnixNano: "150", name: "e", attributes: [{ key: "x", value: { boolValue: true } }] }],
      links: [{ traceId: TRACE, spanId: SPAN, attributes: [] }],
    })]));
    const s = parsed.spans[0];
    expect(s.attributes.map((a) => [a.ordinal, a.key])).toEqual([[0, "k"], [1, "k"]]);
    expect(s.events[0]).toMatchObject({ ordinal: 0, timeNs: "150", name: "e" });
    expect(s.links.length).toBe(1);
  });

  it("keeps unknown span properties as tagged data and counts them", () => {
    const parsed = parseTraceRequest(traceRequest([span({ weird: { a: [1, 2.5, "x", true] }, other: "y" })]));
    expect(parsed.spans[0].unknownCount).toBe(2);
    expect(parsed.spans[0].unknownFields).toEqual({
      t: "k",
      v: [
        ["weird", { t: "k", v: [["a", { t: "a", v: [{ t: "i", v: "1" }, { t: "d", v: 2.5 }, { t: "s", v: "x" }, { t: "o", v: true }] }]] }],
        ["other", { t: "s", v: "y" }],
      ],
    });
  });

  it("fails closed on null or huge numbers inside an unknown property", () => {
    expect(spanCode({ weird: null })).toBe("E_ANYVALUE");
    expect(spanCode({ weird: [null] })).toBe("E_ANYVALUE");
    const huge = parseStrictJson(new TextEncoder().encode(
      `{"resourceSpans":[{"scopeSpans":[{"spans":[{"traceId":"${TRACE}","spanId":"${SPAN}","startTimeUnixNano":"1","weird":1e400}]}]}]}`), "parse");
    expect(codeOf(() => parseTraceRequest(huge))).toBe("E_NUMBER");
    expect(spanCode({ weird: "x", __proto__x: 1 })).toBeNull();
  });

  it("counts unknown envelope properties without storing them", () => {
    const request = json({ resourceSpans: [{ extra: 1, resource: { x: 1 }, scopeSpans: [{ scope: { y: 1 }, spans: [span()] }] }], more: 2 });
    expect(parseTraceRequest(request).stats.envelopeUnknownCount).toBe(4);
  });

  it("handles an empty request and wrong container types", () => {
    expect(parseTraceRequest(json({})).spans).toEqual([]);
    expect(codeOf(() => parseTraceRequest(json([])))).toBe("E_SYNTAX");
    expect(codeOf(() => parseTraceRequest(json({ resourceSpans: {} })))).toBe("E_SYNTAX");
    expect(spanCode({ name: 5 })).toBe("E_SYNTAX");
    expect(spanCode({ attributes: "x" })).toBe("E_SYNTAX");
    expect(codeOf(() => parseTraceRequest(traceRequest(["x"])))).toBe("E_SYNTAX");
  });
});

describe("AnyValue", () => {
  it("converts every arm", () => {
    const parsed = parseTraceRequest(traceRequest([span({
      attributes: [
        { key: "s", value: { stringValue: "x" } },
        { key: "b", value: { boolValue: false } },
        { key: "i", value: { intValue: "-9223372036854775808" } },
        { key: "i2", value: { intValue: 42 } },
        { key: "d", value: { doubleValue: 1.5 } },
        { key: "n", value: { doubleValue: "NaN" } },
        { key: "y", value: { bytesValue: "aGk=" } },
        { key: "a", value: { arrayValue: { values: [{ intValue: "1" }, { arrayValue: {} }] } } },
        { key: "m", value: { kvlistValue: { values: [{ key: "dup", value: { stringValue: "1" } }, { key: "dup", value: { stringValue: "2" } }] } } },
      ],
    })]));
    expect(parsed.spans[0].attributes.map((a) => a.value)).toEqual([
      { t: "s", v: "x" }, { t: "o", v: false }, { t: "i", v: "-9223372036854775808" }, { t: "i", v: "42" },
      { t: "d", v: 1.5 }, { t: "d", v: "NaN" }, { t: "b", v: "aGk=" },
      { t: "a", v: [{ t: "i", v: "1" }, { t: "a", v: [] }] },
      { t: "k", v: [["dup", { t: "s", v: "1" }], ["dup", { t: "s", v: "2" }]] },
    ]);
  });

  it("rejects no arm, several arms, unknown arms and wrong arm types", () => {
    for (const bad of [{}, { stringValue: "a", intValue: "1" }, { floatValue: 1 }, { stringValue: 5 }, { boolValue: "true" },
      { bytesValue: "abc" }, { arrayValue: [] }, { arrayValue: { values: {} } }, { arrayValue: { values: [], x: 1 } },
      { kvlistValue: { values: [{ key: "k" }] } }, { kvlistValue: { values: [{ value: { stringValue: "a" } }] } },
      { kvlistValue: { values: [{ key: "k", value: { stringValue: "a" }, extra: 1 }] } }, "str", null, 5]) {
      expect(attrCode(bad), JSON.stringify(bad)).toBe("E_ANYVALUE");
    }
    expect(codeOf(() => parseTraceRequest(traceRequest([span({ attributes: [{ key: "k" }] })])))).toBe("E_ANYVALUE");
  });

  it("rejects bad numbers in values", () => {
    for (const bad of [{ intValue: "9223372036854775808" }, { intValue: 1.5 }, { intValue: "x" }, { doubleValue: "inf" },
      { doubleValue: true }]) {
      expect(attrCode(bad), JSON.stringify(bad)).toBe("E_NUMBER");
    }
  });

  it("converts a deeply nested value without recursion", () => {
    let value: unknown = { stringValue: "leaf" };
    for (let i = 0; i < 16; i += 1) value = { arrayValue: { values: [value] } };
    expect(attrCode(value)).toBeNull();
  });

  it("rejects a double too large for a finite number", () => {
    const raw = `{"resourceSpans":[{"scopeSpans":[{"spans":[{"traceId":"${TRACE}","spanId":"${SPAN}","startTimeUnixNano":"1","attributes":[{"key":"k","value":{"doubleValue":1e400}}]}]}]}]}`;
    expect(codeOf(() => parseTraceRequest(parseStrictJson(new TextEncoder().encode(raw), "parse")))).toBe("E_NUMBER");
  });

  it("stores __proto__ keys as plain data", () => {
    const parsed = parseTraceRequest(traceRequest([span({
      attributes: [{ key: "__proto__", value: { kvlistValue: { values: [{ key: "__proto__", value: { stringValue: "x" } }] } } }],
    })]));
    expect(parsed.spans[0].attributes[0].key).toBe("__proto__");
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
});

describe("log records", () => {
  it("reads fields, body and optional ids", () => {
    const parsed = parseLogsRequest(logRequest([
      { timeUnixNano: "5", severityNumber: 9, severityText: "INFO", body: { stringValue: "hi" }, traceId: TRACE.toUpperCase(), spanId: SPAN, eventName: "gen_ai.choice" },
      { body: { kvlistValue: { values: [] } } },
    ]));
    expect(parsed.logs[0]).toMatchObject({ traceId: TRACE, spanId: SPAN, timeNs: "5", severityNumber: 9, eventName: "gen_ai.choice" });
    expect(parsed.logs[1]).toMatchObject({ traceId: null, spanId: null, timeNs: "0", observedTimeNs: "0" });
  });

  it("rejects all-zero ids, bad severity and bad bodies, and keeps unknown properties", () => {
    const code = (record: unknown) => codeOf(() => parseLogsRequest(logRequest([record])));
    expect(code({ traceId: "0".repeat(32) })).toBe("E_ID");
    expect(code({ spanId: "0".repeat(16) })).toBe("E_ID");
    expect(code({ severityNumber: 25 })).toBe("E_NUMBER");
    expect(code({ body: {} })).toBeNull();
    expect(code({ body: { stringValue: "a", intValue: "1" } })).toBe("E_ANYVALUE");
    expect(code({ body: { nope: 1 } })).toBe("E_ANYVALUE");
    expect(code({ body: "text" })).toBe("E_ANYVALUE");
    expect(parseLogsRequest(logRequest([{ extra: 1 }])).logs[0].unknownCount).toBe(1);
  });
});

describe("limits", () => {
  it("enforces span, log, group and per-object limits", () => {
    const tiny = { ...DEFAULT_STRUCTURE_LIMITS, maxSpans: 2, maxLogRecords: 1, maxResourceGroups: 1, maxScopeGroups: 2, maxPerObject: 2 };
    const manySpans = [span(), span({ spanId: "00000000000000a2" }), span({ spanId: "00000000000000a3" })];
    expect(codeOf(() => parseTraceRequest(traceRequest(manySpans), "s", tiny))).toBe("E_LIMIT");
    expect(codeOf(() => parseLogsRequest(logRequest([{}, {}]), "s", tiny))).toBe("E_LIMIT");
    expect(codeOf(() => parseTraceRequest(json({ resourceSpans: [{}, {}] }), "s", tiny))).toBe("E_LIMIT");
    expect(codeOf(() => parseTraceRequest(json({ resourceSpans: [{ scopeSpans: [{}, {}, {}] }] }), "s", tiny))).toBe("E_LIMIT");
    const attrs = [1, 2, 3].map((n) => ({ key: `k${n}`, value: { intValue: n } }));
    expect(codeOf(() => parseTraceRequest(traceRequest([span({ attributes: attrs })]), "s", tiny))).toBe("E_LIMIT");
  });
});
