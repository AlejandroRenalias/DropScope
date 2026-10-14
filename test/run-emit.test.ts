import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ImportError } from "../src/run-import-error.js";
import { importTraceBytes } from "../src/run-import.js";
import type { RunEvent } from "../src/run-events.js";

const T1 = "11111111111111111111111111111111";
const id = (n: number) => n.toString(16).padStart(16, "0");
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const span = (n: number, overrides: Record<string, unknown> = {}) => ({
  traceId: T1, spanId: id(n), name: `s${n}`, startTimeUnixNano: "100", endTimeUnixNano: "200", ...overrides,
});
const sattr = (key: string, value: string) => ({ key, value: { stringValue: value } });
const iattr = (key: string, value: number | string) => ({ key, value: { intValue: String(value) } });
const traceFile = (spans: unknown[], scope: Record<string, unknown> = { name: "ok.scope", version: "1.0" }, resource: unknown[] = []) =>
  bytes({ resourceSpans: [{ resource: { attributes: resource }, schemaUrl: "https://opentelemetry.io/schemas/1.37.0", scopeSpans: [{ scope, spans }] }] });
const logFile = (logRecords: unknown[]) => bytes({ resourceLogs: [{ scopeLogs: [{ logRecords }] }] });

const typesOf = (events: RunEvent[]) => events.map((e) => e.type);
const ofType = <T extends RunEvent["type"]>(events: RunEvent[], type: T) =>
  events.filter((e): e is Extract<RunEvent, { type: T }> => e.type === type);
const notes = (events: RunEvent[], code: string) => ofType(events, "ImportNote").filter((n) => n.payload.code === code);

function codeOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    if (error instanceof ImportError) return error.code;
    throw error;
  }
}

describe("event stream shape", () => {
  const events = importTraceBytes({
    spans: traceFile([
      span(1, { attributes: [sattr("gen_ai.operation.name", "invoke_agent")] }),
      span(2, { parentSpanId: id(1), startTimeUnixNano: "110", endTimeUnixNano: "190", attributes: [sattr("gen_ai.operation.name", "chat"), sattr("gen_ai.request.model", "m-1"), iattr("gen_ai.usage.input_tokens", 7), iattr("gen_ai.usage.output_tokens", 3)] }),
    ]),
  });

  it("starts with RunStarted, ends with RunEnded and counts every event", () => {
    expect(events[0].type).toBe("RunStarted");
    const last = events[events.length - 1];
    expect(last.type).toBe("RunEnded");
    expect((last as Extract<RunEvent, { type: "RunEnded" }>).payload.eventCount).toBe(events.length);
    expect(events.map((e) => e.sequenceNumber)).toEqual(events.map((_, i) => i + 1));
    expect(new Set(events.map((e) => e.runId))).toEqual(new Set([T1]));
  });

  it("orders steps by time, with children after parents and ends before starts at the same time", () => {
    expect(typesOf(events).slice(1, 6)).toEqual(["StepStarted", "StepStarted", "StepEnded", "UsageRecorded", "StepEnded"]);
    const ids = events.filter((e) => e.type === "StepStarted" || e.type === "StepEnded").map((e) => `${e.type}:${(e.payload as { stepId: string }).stepId}`);
    expect(ids).toEqual([`StepStarted:${id(1)}`, `StepStarted:${id(2)}`, `StepEnded:${id(2)}`, `StepEnded:${id(1)}`]);
  });

  it("derives kind and a structural label, and records usage as decimal strings", () => {
    const started = ofType(events, "StepStarted");
    expect(started.map((s) => [s.payload.kind, s.payload.label])).toEqual([["AGENT", "AGENT invoke_agent"], ["LLM_CALL", "LLM_CALL chat m-1"]]);
    expect(ofType(events, "UsageRecorded")[0].payload).toEqual({ stepId: id(2), inputTokens: "7", outputTokens: "3" });
  });
});

describe("privacy: HASH_ONLY keeps no content", () => {
  const SECRETS = ["SECRET-NAME", "SECRET-STATUS", "SECRET-EVENT", "SECRET-TRACESTATE", "SECRET-UNKNOWN", "SECRET-ATTRKEY", "SECRET-ATTRVAL",
    "SECRET-PROMPT", "SECRET-RESOURCE", "SECRET-SCOPEATTR", "SECRET-SCHEMA", "SECRET-LOGBODY", "SECRET-LOGATTR", "SECRET-SEVERITY", "SECRET-LOGEVENT",
    "SECRET-LINKSTATE", "SECRET-GENAIOTHER", "SECRET-BADMODEL", "SECRET-SCOPENAME", "SECRET-ENVIRONMENT"];
  const spans = traceFile([span(1, {
    name: "SECRET-NAME", traceState: "SECRET-TRACESTATE", status: { code: 2, message: "SECRET-STATUS" },
    events: [{ timeUnixNano: "150", name: "SECRET-EVENT", attributes: [sattr("SECRET-ATTRKEY", "SECRET-ATTRVAL")] }],
    links: [{ traceId: T1, spanId: id(9), traceState: "SECRET-LINKSTATE" }],
    unknownField: { note: "SECRET-UNKNOWN" },
    attributes: [
      sattr("gen_ai.operation.name", "chat"), sattr("SECRET-ATTRKEY", "SECRET-ATTRVAL"),
      sattr("gen_ai.input.messages", "SECRET-PROMPT"), sattr("gen_ai.something.else", "SECRET-GENAIOTHER"),
      sattr("gen_ai.request.model", "SECRET-BADMODEL has spaces"), sattr("server.address", "SECRET-ENVIRONMENT"),
    ],
  })], { name: "SECRET-SCOPENAME", version: "1.0", attributes: [sattr("SECRET-SCOPEATTR", "SECRET-SCOPEATTR")] }, [sattr("service.name", "SECRET-RESOURCE")]);
  const spansWithBadSchema = new TextDecoder().decode(spans).replace("https://opentelemetry.io/schemas/1.37.0", "https://SECRET-SCHEMA.example/x");
  const logs = logFile([{ traceId: T1, spanId: id(1), severityNumber: 9, severityText: "SECRET-SEVERITY", eventName: "SECRET-LOGEVENT", body: { stringValue: "SECRET-LOGBODY" }, attributes: [sattr("SECRET-LOGATTR", "SECRET-LOGATTR")] }]);

  it("leaves none of 20 planted strings anywhere in the output", () => {
    const events = importTraceBytes({ spans: new TextEncoder().encode(spansWithBadSchema), logs });
    const text = JSON.stringify(events);
    for (const secret of SECRETS) expect(text.includes(secret), secret).toBe(false);
    expect(text.includes("SECRET")).toBe(false);
  });

  it("keeps the same strings in FULL mode (proves the test can see them)", () => {
    const events = importTraceBytes({ spans: new TextEncoder().encode(spansWithBadSchema), logs, contentMode: "FULL" });
    const text = JSON.stringify(events);
    for (const secret of SECRETS) expect(text.includes(secret), secret).toBe(true);
  });

  it("records content as withheld length and hash, with matching RunStarted mode", () => {
    const events = importTraceBytes({ spans: spans, logs });
    expect(ofType(events, "RunStarted")[0].payload.contentMode).toBe("HASH_ONLY");
    const prompt = ofType(events, "ContentRecorded").find((c) => c.payload.field === "gen_ai.input.messages");
    expect(prompt?.payload.value).toEqual({ w: { n: Buffer.byteLength('{"t":"s","v":"SECRET-PROMPT"}'), h: expect.stringMatching(/^[0-9a-f]{64}$/) } });
    expect(notes(events, "WITHHELD_ATTRIBUTE").length).toBeGreaterThan(0);
  });

  it("keeps allowlisted structural values verbatim and withholds a bad pattern", () => {
    const events = importTraceBytes({ spans, logs });
    const started = ofType(events, "StepStarted")[0].payload;
    expect(started.operationName).toEqual({ v: { t: "s", v: "chat" } });
    const model = started.attributes.find((a) => "v" in a.key && a.key.v.v === "gen_ai.request.model");
    expect(model && "w" in model.value).toBe(true);
    expect(started.label).toBe("LLM_CALL chat");
  });

  it("classifies the real spike trace with content, leaving no prompt text in the output", () => {
    const file = readFileSync(new URL("../docs/development/spike-2026-10-13/traces/trace-a.json", import.meta.url));
    const original = JSON.parse(file.toString("utf8")) as { resourceSpans: Array<{ scopeSpans: Array<{ spans: Array<{ attributes: Array<{ key: string; value: { stringValue?: string } }> }> }> }> };
    const texts: string[] = [];
    for (const r of original.resourceSpans) for (const s of r.scopeSpans) for (const sp of s.spans) for (const a of sp.attributes ?? []) {
      if (/^gen_ai\.(input|output)\.messages$|^gen_ai\.tool\.call\./.test(a.key) && a.value.stringValue) texts.push(a.value.stringValue.slice(0, 30));
    }
    expect(texts.length).toBeGreaterThan(5);
    const output = JSON.stringify(importTraceBytes({ spans: new Uint8Array(file) }));
    for (const t of texts) expect(output.includes(JSON.stringify(t).slice(1, -1)), t).toBe(false);
    expect(JSON.stringify(importTraceBytes({ spans: new Uint8Array(file), contentMode: "FULL" })).includes(JSON.stringify(texts[0]).slice(1, -1))).toBe(true);
  });
});

describe("content, logs and orphans", () => {
  it("records span content ordered by field name then ordinal, after the step end", () => {
    const events = importTraceBytes({ spans: traceFile([span(1, { attributes: [
      sattr("gen_ai.output.messages", "o"), sattr("gen_ai.input.messages", "i2"), sattr("gen_ai.input.messages", "i1"),
    ] })]) });
    const content = ofType(events, "ContentRecorded");
    expect(content.map((c) => [c.payload.field, c.payload.ordinal])).toEqual([["gen_ai.input.messages", 1], ["gen_ai.input.messages", 2], ["gen_ai.output.messages", 0]]);
    expect(typesOf(events).indexOf("ContentRecorded")).toBeGreaterThan(typesOf(events).indexOf("StepEnded"));
  });

  it("attaches logs after the step they belong to and puts orphan logs after all steps", () => {
    const events = importTraceBytes({
      spans: traceFile([span(1, { attributes: [sattr("gen_ai.operation.name", "chat")] }), span(2, { startTimeUnixNano: "300", endTimeUnixNano: "400" })]),
      logs: logFile([
        { traceId: T1, spanId: id(1), timeUnixNano: "5", body: { stringValue: "a" } },
        { body: { stringValue: "orphan" } },
        { traceId: T1, spanId: id(1), observedTimeUnixNano: "4", attributes: [sattr("gen_ai.completion", "x")] },
      ]),
    });
    const t = typesOf(events);
    const endOfOne = events.findIndex((e) => e.type === "StepEnded" && e.payload.stepId === id(1));
    expect(t.slice(endOfOne, endOfOne + 6)).toEqual(["StepEnded", "LogRecorded", "ContentRecorded", "LogRecorded", "ContentRecorded", "StepStarted"]);
    const logs = ofType(events, "LogRecorded");
    expect(logs.map((l) => [l.payload.logOrdinal, l.payload.stepId])).toEqual([[0, id(1)], [1, id(1)], [2, null]]);
    const lastStepEvent = Math.max(...events.map((e, i) => (e.type === "StepEnded" ? i : -1)));
    expect(events.findIndex((e) => e.type === "LogRecorded" && e.payload.stepId === null)).toBeGreaterThan(lastStepEvent);
    expect(notes(events, "ORPHAN_LOG_RECORD")[0].payload.detail).toEqual({ logOrdinal: 2 });
    const bodyContent = ofType(events, "ContentRecorded").filter((c) => c.payload.channel === "LOG_RECORD");
    expect(bodyContent.every((c) => c.payload.stepId === null && c.payload.logOrdinal !== null)).toBe(true);
  });

  it("notes missing content on LLM and tool steps, and counts it as present when a log carries it", () => {
    const spans = traceFile([
      span(1, { attributes: [sattr("gen_ai.operation.name", "chat")] }),
      span(2, { startTimeUnixNano: "300", endTimeUnixNano: "400", attributes: [sattr("gen_ai.operation.name", "execute_tool")] }),
      span(3, { startTimeUnixNano: "500", endTimeUnixNano: "600" }),
    ]);
    const without = importTraceBytes({ spans });
    expect(notes(without, "CONTENT_ABSENT").map((n) => n.payload.stepId)).toEqual([id(1), id(2)]);
    const withLog = importTraceBytes({ spans, logs: logFile([{ traceId: T1, spanId: id(1), body: { stringValue: "x" } }]) });
    expect(notes(withLog, "CONTENT_ABSENT").map((n) => n.payload.stepId)).toEqual([id(2)]);
  });
});

describe("usage rules", () => {
  const usageFor = (attributes: unknown[], operation = "chat") =>
    importTraceBytes({ spans: traceFile([span(1, { attributes: [sattr("gen_ai.operation.name", operation), ...attributes] })]) });

  it("sums nothing for non-LLM spans and notes it", () => {
    const events = usageFor([iattr("gen_ai.usage.input_tokens", 5)], "execute_tool");
    expect(ofType(events, "UsageRecorded").length).toBe(0);
    expect(notes(events, "USAGE_NOT_SUMMED").length).toBe(1);
  });

  it("treats absent as null, not zero, and zero as zero", () => {
    expect(ofType(usageFor([iattr("gen_ai.usage.output_tokens", 0)]), "UsageRecorded")[0].payload).toMatchObject({ inputTokens: null, outputTokens: "0" });
    expect(ofType(usageFor([]), "UsageRecorded").length).toBe(0);
  });

  it("merges equal duplicate keys and refuses disagreeing, negative, fractional or string-typed values", () => {
    expect(ofType(usageFor([iattr("gen_ai.usage.input_tokens", 4), iattr("gen_ai.usage.input_tokens", 4)]), "UsageRecorded")[0].payload.inputTokens).toBe("4");
    const disagree = usageFor([iattr("gen_ai.usage.input_tokens", 4), iattr("gen_ai.usage.input_tokens", 5)]);
    expect(ofType(disagree, "UsageRecorded").length).toBe(0);
    expect(notes(disagree, "UNUSABLE_USAGE")[0].payload.detail).toEqual({ count: 1 });
    for (const bad of [iattr("gen_ai.usage.input_tokens", -1), sattr("gen_ai.usage.input_tokens", "7"), { key: "gen_ai.usage.input_tokens", value: { doubleValue: 7.5 } }, iattr("gen_ai.usage.input_tokens", "9007199254740993")]) {
      const events = usageFor([bad]);
      expect(ofType(events, "UsageRecorded").length).toBe(0);
      expect(notes(events, "UNUSABLE_USAGE").length).toBe(1);
    }
  });
});

describe("notes and identity", () => {
  it("emits notes after all other events, sorted, without repeats", () => {
    const events = importTraceBytes({ spans: traceFile([span(1, { parentSpanId: id(77), endTimeUnixNano: undefined, kind: "SPAN_KIND_CLIENT", extra: 1 }), span(1, { parentSpanId: id(77), endTimeUnixNano: undefined, kind: "SPAN_KIND_CLIENT", extra: 1 })]) });
    const t = typesOf(events);
    const firstNote = t.indexOf("ImportNote");
    expect(t.slice(firstNote).every((x) => x === "ImportNote" || x === "RunEnded")).toBe(true);
    const codes = ofType(events, "ImportNote").map((n) => n.payload.code);
    expect(codes).toEqual([...codes].sort());
    expect(new Set(codes.map((c, i) => `${c}${JSON.stringify(ofType(events, "ImportNote")[i].payload)}`)).size).toBe(codes.length);
    expect(codes).toEqual(expect.arrayContaining(["DUPLICATE_SPAN_COLLAPSED", "ENUM_NAME_ACCEPTED", "MISSING_PARENT", "UNFINISHED_SPAN_CLOSED", "UNKNOWN_FIELD"]));
  });

  it("is identical for identical input and changes artifactId with the mode or the input bytes", () => {
    const spans = traceFile([span(1)]);
    const a = importTraceBytes({ spans });
    expect(JSON.stringify(importTraceBytes({ spans }))).toBe(JSON.stringify(a));
    const id1 = ofType(a, "RunStarted")[0].payload.artifactId;
    expect(ofType(importTraceBytes({ spans, contentMode: "FULL" }), "RunStarted")[0].payload.artifactId).not.toBe(id1);
    expect(ofType(importTraceBytes({ spans: new Uint8Array([...spans, 0x20]) }), "RunStarted")[0].payload.artifactId).not.toBe(id1);
  });

  it("reports scanner counts for secret-like content without echoing the matches", () => {
    const events = importTraceBytes({ spans: traceFile([span(1, { attributes: [sattr("gen_ai.input.messages", "key AKIAABCDEFGHIJKLMNOP and bob@example.com and Bearer abcdefghijklmnopqrstuvwxyz0123")] })]) });
    const note = notes(events, "SECRET_PATTERN_COUNT")[0];
    expect(note.payload.detail).toEqual({ awsAccessKey: 1, bearerToken: 1, email: 1 });
    expect(JSON.stringify(events)).not.toContain("AKIAABCDEFGHIJKLMNOP");
    expect(JSON.stringify(events)).not.toContain("bob@example.com");
  });

  it("flags schema URL problems per context", () => {
    const events = importTraceBytes({ spans: bytes({ resourceSpans: [{ scopeSpans: [{ spans: [span(1)] }] }] }) });
    expect(notes(events, "SCHEMA_URL_ABSENT").length).toBe(1);
    const mismatch = new TextDecoder().decode(traceFile([span(1)])).replace("1.37.0", "1.20.0");
    expect(notes(importTraceBytes({ spans: new TextEncoder().encode(mismatch) }), "SCHEMA_URL_MISMATCH").length).toBe(1);
  });
});

describe("worst-case inputs", () => {
  it("scans long adversarial strings quickly", () => {
    const hostile = "a".repeat(200_000) + "@" + "b".repeat(200_000) + "AKIA".repeat(50_000) + "eyJ" + "a".repeat(100_000);
    const started = performance.now();
    importTraceBytes({ spans: traceFile([span(1, { attributes: [sattr("gen_ai.input.messages", hostile)] })]) });
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it("imports 10,000 spans in reasonable time", () => {
    const many = Array.from({ length: 10_000 }, (_, i) => span(i + 1, { startTimeUnixNano: String(100 + i), endTimeUnixNano: String(200 + i), attributes: [sattr("gen_ai.operation.name", "chat"), iattr("gen_ai.usage.input_tokens", 1)] }));
    const started = performance.now();
    const events = importTraceBytes({ spans: traceFile(many) });
    expect(performance.now() - started).toBeLessThan(8000);
    expect(ofType(events, "StepStarted").length).toBe(10_000);
  });

  it("rejects bad input with closed codes", () => {
    expect(codeOf(() => importTraceBytes({ spans: bytes({}) }))).toBe("E_EMPTY");
    expect(codeOf(() => importTraceBytes({ spans: new TextEncoder().encode("{") }))).toBe("E_SYNTAX");
  });
});

describe("real spike traces end to end", () => {
  const dir = new URL("../docs/development/spike-2026-10-13/traces/", import.meta.url);
  const read = (name: string) => new Uint8Array(readFileSync(new URL(name, dir)));

  it.each([["trace-a.json", undefined], ["trace-b.json", undefined], ["trace-c.json", undefined], ["trace-d.json", "trace-d.logs.json"]])(
    "%s imports in both modes with the same event structure and totals", (name, logs) => {
      const request = { spans: read(name), logs: logs ? read(logs) : undefined };
      const hashed = importTraceBytes({ ...request, contentMode: "HASH_ONLY" });
      const full = importTraceBytes({ ...request, contentMode: "FULL" });
      const noNotes = (events: RunEvent[]) => events.filter((e) => e.type !== "ImportNote" && e.type !== "RunEnded").map((e) => e.type);
      expect(noNotes(hashed)).toEqual(noNotes(full));
      expect(notes(hashed, "WITHHELD_ATTRIBUTE").length).toBeGreaterThan(0);
      expect(notes(full, "WITHHELD_ATTRIBUTE").length).toBe(0);
      const total = (events: RunEvent[]) => ofType(events, "UsageRecorded").reduce((n, e) => n + BigInt(e.payload.inputTokens ?? "0") + BigInt(e.payload.outputTokens ?? "0"), 0n);
      expect(total(hashed)).toBe(total(full));
      expect(total(hashed) > 0n).toBe(true);
      expect(ofType(hashed, "StepStarted").length).toBe(ofType(hashed, "StepEnded").length);
    });
});
