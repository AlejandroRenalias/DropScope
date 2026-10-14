import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ImportError } from "../src/run-import-error.js";
import { importTraceBytes } from "../src/run-import.js";
import type { RunEvent } from "../src/run-events.js";
import { createReplay, reduceRun, validateRunHistory } from "../src/run-reducer.js";

const T1 = "11111111111111111111111111111111";
const id = (n: number) => n.toString(16).padStart(16, "0");
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const span = (n: number, overrides: Record<string, unknown> = {}) => ({
  traceId: T1, spanId: id(n), name: `s${n}`, startTimeUnixNano: String(100 + n), endTimeUnixNano: String(200 + n), ...overrides,
});
const sattr = (key: string, value: string) => ({ key, value: { stringValue: value } });
const iattr = (key: string, value: number) => ({ key, value: { intValue: String(value) } });
const traceFile = (spans: unknown[]) => bytes({ resourceSpans: [{ scopeSpans: [{ scope: { name: "s", version: "1" }, spans }] }] });
const logFile = (logRecords: unknown[]) => bytes({ resourceLogs: [{ scopeLogs: [{ logRecords }] }] });

const sample = (mode: "HASH_ONLY" | "FULL" = "HASH_ONLY") => importTraceBytes({
  contentMode: mode,
  spans: traceFile([
    span(1, { attributes: [sattr("gen_ai.operation.name", "invoke_agent")] }),
    span(2, { parentSpanId: id(1), attributes: [sattr("gen_ai.operation.name", "chat"), iattr("gen_ai.usage.input_tokens", 10), iattr("gen_ai.usage.output_tokens", 4), sattr("gen_ai.input.messages", "hello")], status: { code: 2, message: "bad" } }),
    span(3, { parentSpanId: id(1), attributes: [sattr("gen_ai.operation.name", "chat"), iattr("gen_ai.usage.input_tokens", 5)] }),
  ]),
  logs: logFile([{ traceId: T1, spanId: id(2), body: { stringValue: "log" } }, { body: { stringValue: "orphan" } }]),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Mutable = any[];
const clone = (events: RunEvent[]): Mutable => JSON.parse(JSON.stringify(events));
const renumber = (events: Mutable): Mutable => events.map((e, i) => ({ ...e, sequenceNumber: i + 1 }));
// Removes events, renumbers, and fixes the RunEnded count so only the intended defect remains.
const without = (events: Mutable, drop: (e: Mutable[number], i: number) => boolean): Mutable => {
  const kept = renumber(events.filter((e, i) => !drop(e, i)));
  kept[kept.length - 1] = { ...kept[kept.length - 1], payload: { eventCount: kept.length } };
  return kept;
};
const reasonOf = (history: unknown): string | null => {
  try {
    validateRunHistory(history);
    return null;
  } catch (error) {
    if (error instanceof ImportError) return `${error.code}:${error.reason?.split(" at event")[0] ?? ""}`;
    throw error;
  }
};
const indexOfType = (events: Mutable, type: string, nth = 0): number =>
  events.map((e, i) => (e.type === type ? i : -1)).filter((i) => i >= 0)[nth];

describe("valid histories", () => {
  it("accepts an importer-produced history in both modes", () => {
    expect(reasonOf(sample())).toBeNull();
    expect(reasonOf(sample("FULL"))).toBeNull();
  });

  it("rebuilds state step by step: open and closed steps, kinds, tokens, content, errors, notes", () => {
    const replay = createReplay(sample());
    expect(replay.stateAt(1)).toMatchObject({ sequenceNumber: 1, openStepIds: [], closedStepIds: [], inputTokens: "0", ended: false });
    const final = replay.stateAt(replay.length);
    expect(final).toMatchObject({
      openStepIds: [], closedStepIds: [id(1), id(2), id(3)].sort(), stepsByKind: { LLM_CALL: 2, TOOL_CALL: 0, AGENT: 1, OTHER: 0 },
      inputTokens: "15", outputTokens: "4", errorStepIds: [id(2)], logCount: 2, ended: true,
    });
    expect(final.content["SPAN_ATTRIBUTE:gen_ai.input.messages"]).toBe(1);
    expect(final.content["LOG_RECORD:gen_ai.other"]).toBe(2);
    expect(final.notes.ORPHAN_LOG_RECORD).toBe(1);
  });

  it("has token totals that never decrease and an open-step count that matches the events", () => {
    const events = sample();
    const replay = createReplay(events);
    let previous = 0n;
    for (let n = 1; n <= replay.length; n += 1) {
      const state = replay.stateAt(n);
      expect(BigInt(state.inputTokens) >= previous).toBe(true);
      previous = BigInt(state.inputTokens);
      const started = events.slice(0, n).filter((e) => e.type === "StepStarted").length;
      const ended = events.slice(0, n).filter((e) => e.type === "StepEnded").length;
      expect(state.openStepIds.length).toBe(started - ended);
    }
  });

  it("gives the same state at step N from the checkpoints as from counting the events directly", () => {
    const many = Array.from({ length: 400 }, (_, i) => span(i + 1, { attributes: [sattr("gen_ai.operation.name", "chat"), iattr("gen_ai.usage.input_tokens", 1)] }));
    const events = importTraceBytes({ spans: traceFile(many) });
    const replay = createReplay(events);
    expect(replay.length).toBeGreaterThan(1000);
    for (const n of [1, 255, 256, 257, 511, 512, 513, 1000, replay.length]) {
      let input = 0n;
      for (const e of events.slice(0, n)) if (e.type === "UsageRecorded") input += BigInt(e.payload.inputTokens ?? "0");
      expect(replay.stateAt(n).inputTokens).toBe(input.toString());
    }
    expect(replay.stateAt(replay.length).inputTokens).toBe("400");
  });

  it("rejects an out-of-range step", () => {
    const replay = createReplay(sample());
    for (const bad of [0, -1, replay.length + 1, 1.5, Number.NaN]) expect(() => replay.stateAt(bad)).toThrow(ImportError);
  });
});

describe("real spike traces: totals match the stub server's own tally", () => {
  const dir = new URL("../docs/development/spike-2026-10-13/traces/", import.meta.url);
  it.each(["trace-a", "trace-b", "trace-c", "trace-d"])("%s", (name) => {
    const truth = JSON.parse(readFileSync(new URL(`${name}.json.truth`, dir), "utf8")) as { promptTokens: number; completionTokens: number };
    const events = importTraceBytes({ spans: new Uint8Array(readFileSync(new URL(`${name}.json`, dir))) });
    const state = reduceRun(events);
    expect(state.inputTokens).toBe(String(truth.promptTokens));
    expect(state.outputTokens).toBe(String(truth.completionTokens));
    expect(state.openStepIds).toEqual([]);
  });
});

describe("admission: every broken history is rejected", () => {
  const dup = (e: Mutable, type: string) => { const i = indexOfType(e, type); return renumber([...e.slice(0, i + 1), e[i], ...e.slice(i + 1)]); };
  const cases: Array<[string, (events: Mutable) => unknown, string]> = [
    ["empty history", () => [], "E_INVALID_LOG:EMPTY_HISTORY"],
    ["not an array", () => ({}), "E_INVALID_LOG:EMPTY_HISTORY"],
    ["first event is not RunStarted", (e) => renumber(e.slice(1)), "E_INVALID_LOG:FIRST_NOT_RUN_STARTED"],
    ["sequence skips a number", (e) => { e[2].sequenceNumber = 99; return e; }, "E_INVALID_LOG:SEQUENCE_BREAK"],
    ["sequence does not start at 1", (e) => e.map((x) => ({ ...x, sequenceNumber: x.sequenceNumber + 1 })), "E_INVALID_LOG:SEQUENCE_BREAK"],
    ["run id changes", (e) => { e[3].runId = "22222222222222222222222222222222"; return e; }, "E_INVALID_LOG:RUN_ID_MISMATCH"],
    ["second RunStarted", (e) => renumber([e[0], e[0], ...e.slice(1)]), "E_INVALID_LOG:RUN_STARTED_NOT_UNIQUE"],
    ["duplicate StepStarted", (e) => dup(e, "StepStarted"), "E_INVALID_LOG:DUPLICATE_STEP"],
    ["StepEnded twice", (e) => dup(e, "StepEnded"), "E_INVALID_LOG:STEP_ENDED_TWICE"],
    ["StepEnded for an unknown step", (e) => { e[indexOfType(e, "StepEnded")].payload.stepId = id(99); return e; }, "E_INVALID_LOG:END_WITHOUT_START"],
    ["a step is never ended", (e) => without(e, (_x, i) => i === indexOfType(e, "StepEnded", 0)), "E_INVALID_LOG:OPEN_STEPS_AT_END"],
    ["usage twice", (e) => dup(e, "UsageRecorded"), "E_INVALID_LOG:USAGE_TWICE"],
    ["usage on a non-LLM step", (e) => { e[indexOfType(e, "UsageRecorded")].payload.stepId = id(1); return e; }, "E_INVALID_LOG:USAGE_ON_NON_LLM_STEP"],
    ["usage before its step ends", (e) => {
      const u = indexOfType(e, "UsageRecorded");
      const stepId = e[u].payload.stepId;
      const [usage] = e.splice(u, 1);
      e.splice(e.findIndex((x: Mutable[number]) => x.type === "StepStarted" && x.payload.stepId === stepId) + 1, 0, usage);
      return renumber(e);
    }, "E_INVALID_LOG:USAGE_BEFORE_STEP_END"],
    ["content for an unknown step", (e) => { e[indexOfType(e, "ContentRecorded")].payload.stepId = id(99); return e; }, "E_INVALID_LOG:CONTENT_FOR_UNKNOWN_STEP"],
    ["content for an unknown log", (e) => { const c = e.findIndex((x: Mutable[number]) => x.type === "ContentRecorded" && x.payload.channel === "LOG_RECORD"); e[c].payload.logOrdinal = 77; return e; }, "E_INVALID_LOG:CONTENT_FOR_UNKNOWN_LOG"],
    ["span content with no step", (e) => { const c = e.findIndex((x: Mutable[number]) => x.type === "ContentRecorded" && x.payload.channel === "SPAN_ATTRIBUTE"); e[c].payload.stepId = null; e[c].payload.logOrdinal = 0; return e; }, "E_INVALID_LOG:CONTENT_CHANNEL_MISMATCH"],
    ["log for an unknown step", (e) => { e[indexOfType(e, "LogRecorded")].payload.stepId = id(99); return e; }, "E_INVALID_LOG:LOG_FOR_UNKNOWN_STEP"],
    ["duplicate log ordinal", (e) => { e[indexOfType(e, "LogRecorded", 1)].payload.logOrdinal = e[indexOfType(e, "LogRecorded", 0)].payload.logOrdinal; return e; }, "E_INVALID_LOG:DUPLICATE_LOG_ORDINAL"],
    ["gap in log ordinals", (e) => {
      for (const x of e) {
        if (x.type === "LogRecorded" && x.payload.logOrdinal === 1) x.payload.logOrdinal = 5;
        if (x.type === "ContentRecorded" && x.payload.logOrdinal === 1) x.payload.logOrdinal = 5;
        if (x.type === "ImportNote" && x.payload.detail.logOrdinal === 1) x.payload.detail.logOrdinal = 5;
      }
      return e;
    }, "E_INVALID_LOG:LOG_ORDINAL_GAP"],
    ["orphan log with no orphan note", (e) => without(e, (x) => x.type === "ImportNote" && x.payload.code === "ORPHAN_LOG_RECORD"), "E_INVALID_LOG:ORPHAN_LOG_WITHOUT_NOTE"],
    ["a step event after a note", (e) => {
      const note = indexOfType(e, "ImportNote");
      const [moved] = e.splice(indexOfType(e, "StepStarted"), 1);
      e.splice(note, 0, moved);
      return renumber(e);
    }, "E_INVALID_LOG"],
    ["RunEnded missing", (e) => e.slice(0, -1), "E_INVALID_LOG:MISSING_RUN_ENDED"],
    ["wrong event count", (e) => { e[e.length - 1].payload.eventCount = 3; return e; }, "E_INVALID_LOG:EVENT_COUNT_MISMATCH"],
    ["event after RunEnded", (e) => renumber([...e, e[1]]), "E_INVALID_LOG:RUN_ENDED_NOT_LAST"],
    ["unknown context", (e) => { e[indexOfType(e, "StepStarted")].payload.contextId = "c99"; return e; }, "E_INVALID_LOG:UNKNOWN_CONTEXT"],
    ["parent that never exists", (e) => { e[indexOfType(e, "StepStarted", 1)].payload.parentStepId = id(99); return e; }, "E_INVALID_LOG:PARENT_MISSING"],
    ["unknown event type", (e) => { e[1].type = "Nope"; return e; }, "E_INVALID_LOG:EVENT_SCHEMA"],
    ["the unreleased version 1", (e) => { e[1].schemaVersion = 1; return e; }, "E_INVALID_LOG:UNSUPPORTED_SCHEMA_VERSION"],
    ["a future version", (e) => { e[1].schemaVersion = 3; return e; }, "E_INVALID_LOG:UNSUPPORTED_SCHEMA_VERSION"],
    ["a version that is not a number", (e) => { e[1].schemaVersion = "2"; return e; }, "E_INVALID_LOG:EVENT_SCHEMA"],
  ];
  it.each(cases)("%s", (name, mutate, expected) => {
    const result = reasonOf(mutate(clone(sample())));
    expect(result, name).not.toBeNull();
    expect(result?.startsWith(expected), `${name}: got ${result}`).toBe(true);
  });
});

describe("admission: privacy is re-checked on read", () => {
  const verbatim = (text: string) => ({ v: { t: "s", v: text } });
  const withheld = { w: { n: 1, h: "a".repeat(64) } };
  const cases: Array<[string, (events: Mutable) => void]> = [
    ["verbatim step name", (e) => { e[indexOfType(e, "StepStarted")].payload.name = verbatim("leak"); }],
    ["verbatim trace state", (e) => { e[indexOfType(e, "StepStarted")].payload.traceState = verbatim("leak"); }],
    ["verbatim status message", (e) => { e[indexOfType(e, "StepEnded")].payload.statusMessage = verbatim("leak"); }],
    ["verbatim content value", (e) => { e[indexOfType(e, "ContentRecorded")].payload.value = verbatim("leak"); }],
    ["verbatim log severity text", (e) => { e[indexOfType(e, "LogRecorded")].payload.severityText = verbatim("leak"); }],
    ["verbatim log event name", (e) => { e[indexOfType(e, "LogRecorded")].payload.eventName = verbatim("leak"); }],
    ["verbatim attribute under an unlisted key", (e) => {
      e[indexOfType(e, "StepStarted")].payload.attributes.push({ ordinal: 9, key: verbatim("my.secret.key"), value: verbatim("x") });
    }],
    ["verbatim value that fails its pattern", (e) => {
      e[indexOfType(e, "StepStarted")].payload.attributes.push({ ordinal: 9, key: verbatim("gen_ai.request.model"), value: verbatim("has spaces") });
    }],
    ["verbatim value under a withheld key", (e) => {
      e[indexOfType(e, "StepStarted")].payload.attributes.push({ ordinal: 9, key: withheld, value: verbatim("x") });
    }],
    ["verbatim resource attribute", (e) => {
      e[0].payload.contexts[0].resource.attributes.push({ ordinal: 0, key: verbatim("gen_ai.system"), value: verbatim("openai") });
    }],
    ["verbatim operation name that fails its pattern", (e) => { e[indexOfType(e, "StepStarted")].payload.operationName = verbatim("Has Spaces!"); }],
    ["verbatim scope name that fails its pattern", (e) => { e[0].payload.contexts[0].scope.name = verbatim("Bad Scope!"); }],
  ];
  it.each(cases)("rejects a HASH_ONLY run with a %s", (name, mutate) => {
    const events = clone(sample());
    mutate(events);
    expect(reasonOf(events), name).toBe("E_INVALID_LOG:CONTENT_NOT_WITHHELD");
  });

  it("allows the same verbatim values in a FULL run", () => {
    const events = clone(sample("FULL"));
    events[indexOfType(events, "StepStarted")].payload.name = verbatim("fine");
    expect(reasonOf(events)).toBeNull();
  });

  it("cannot be bypassed by relabelling a FULL run as HASH_ONLY", () => {
    const events = clone(sample("FULL"));
    events[0].payload.contentMode = "HASH_ONLY";
    expect(reasonOf(events)).toBe("E_INVALID_LOG:CONTENT_NOT_WITHHELD");
  });
});

describe("limits", () => {
  it("handles a history of 10,000 steps quickly", () => {
    const many = Array.from({ length: 10_000 }, (_, i) => span(i + 1, { attributes: [sattr("gen_ai.operation.name", "chat"), iattr("gen_ai.usage.input_tokens", 2)] }));
    const events = importTraceBytes({ spans: traceFile(many) });
    const started = performance.now();
    const replay = createReplay(events);
    for (let n = 1; n <= replay.length; n += 997) replay.stateAt(n);
    expect(replay.stateAt(replay.length).inputTokens).toBe("20000");
    expect(performance.now() - started).toBeLessThan(5000);
  });
});
