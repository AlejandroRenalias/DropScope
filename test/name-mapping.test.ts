import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ImportError } from "../src/run-import-error.js";
import { importTraceBytes } from "../src/run-import.js";
import type { RunEvent } from "../src/run-events.js";
import { parseRunLog } from "../src/run-log-format.js";
import { reduceRun, validateRunHistory } from "../src/run-reducer.js";

// Contract v1.1 (schema version 3): kinds and token counts from the names of other common emitters, with the source of
// each recorded in the step.
const T1 = "11111111111111111111111111111111";
const id = (n: number) => n.toString(16).padStart(16, "0");
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const sattr = (key: string, value: string) => ({ key, value: { stringValue: value } });
const iattr = (key: string, value: number | string) => ({ key, value: { intValue: String(value) } });
const spanOf = (n: number, attributes: unknown[]) => ({
  traceId: T1,
  spanId: id(n),
  name: `s${n}`,
  startTimeUnixNano: String(100 + n),
  endTimeUnixNano: String(200 + n),
  attributes,
});
const trace = (spans: unknown[]) =>
  bytes({ resourceSpans: [{ resource: { attributes: [] }, scopeSpans: [{ scope: { name: "ok.scope", version: "1.0" }, spans }] }] });
const run = (spans: unknown[]) => importTraceBytes({ spans: trace(spans) });
const started = (events: RunEvent[]) => events.filter((e): e is Extract<RunEvent, { type: "StepStarted" }> => e.type === "StepStarted");
const usage = (events: RunEvent[]) => events.filter((e): e is Extract<RunEvent, { type: "UsageRecorded" }> => e.type === "UsageRecorded");
const notes = (events: RunEvent[], code: string) => events.filter((e) => e.type === "ImportNote" && e.payload.code === code);
const reasonOf = (fn: () => unknown): string => {
  try {
    fn();
    return "OK";
  } catch (error) {
    return error instanceof ImportError ? `${error.code}:${(error.reason ?? "").split(" ")[0]}` : String(error);
  }
};

describe("kind from other names", () => {
  const kindOf = (attributes: unknown[]) => {
    const [step] = started(run([spanOf(1, attributes)]));
    return [step.payload.kind, step.payload.kindSource] as const;
  };

  it.each([
    ["openinference.span.kind", "LLM", "LLM_CALL"],
    ["openinference.span.kind", "EMBEDDING", "LLM_CALL"],
    ["openinference.span.kind", "TOOL", "TOOL_CALL"],
    ["openinference.span.kind", "AGENT", "AGENT"],
    ["traceloop.span.kind", "agent", "AGENT"],
    ["traceloop.span.kind", "tool", "TOOL_CALL"],
    ["langsmith.span.kind", "llm", "LLM_CALL"],
    ["langsmith.span.kind", "tool", "TOOL_CALL"],
    ["llm.request.type", "chat", "LLM_CALL"],
    ["llm.request.type", "completion", "LLM_CALL"],
  ])("%s = %s is %s, and the key is recorded", (key, value, kind) => {
    expect(kindOf([sattr(key, value)])).toEqual([kind, key]);
  });

  it.each([
    ["openinference.span.kind", "CHAIN"],
    ["openinference.span.kind", "RETRIEVER"],
    ["traceloop.span.kind", "workflow"],
    ["traceloop.span.kind", "task"],
    ["langsmith.span.kind", "chain"],
    ["llm.request.type", "rerank"],
    ["openinference.span.kind", "llm"],
    ["traceloop.span.kind", "TOOL"],
  ])("%s = %s stays OTHER with no source", (key, value) => {
    expect(kindOf([sattr(key, value)])).toEqual(["OTHER", null]);
  });

  it("lets the standard operation name win, and never overrides a present but unmapped one", () => {
    expect(kindOf([sattr("gen_ai.operation.name", "chat"), sattr("traceloop.span.kind", "tool")])).toEqual([
      "LLM_CALL",
      "gen_ai.operation.name",
    ]);
    const events = run([spanOf(1, [sattr("gen_ai.operation.name", "agent_handoff"), sattr("openinference.span.kind", "LLM")])]);
    expect([started(events)[0].payload.kind, started(events)[0].payload.kindSource]).toEqual(["OTHER", null]);
    expect(notes(events, "UNRECOGNIZED_OPERATION")).toHaveLength(1);
  });

  it("uses the first known key in a fixed order when several are present", () => {
    expect(
      kindOf([sattr("llm.request.type", "chat"), sattr("langsmith.span.kind", "tool"), sattr("traceloop.span.kind", "agent")]),
    ).toEqual(["AGENT", "traceloop.span.kind"]);
    expect(kindOf([sattr("llm.request.type", "chat"), sattr("openinference.span.kind", "TOOL")])).toEqual([
      "TOOL_CALL",
      "openinference.span.kind",
    ]);
    // A key that maps to OTHER does not stop the search.
    expect(kindOf([sattr("traceloop.span.kind", "task"), sattr("llm.request.type", "chat")])).toEqual(["LLM_CALL", "llm.request.type"]);
  });

  it("ignores a value that is not a string", () => {
    expect(kindOf([iattr("llm.request.type", 1)])).toEqual(["OTHER", null]);
  });

  it("builds the label from kind and model, with the OpenInference model name", () => {
    const events = run([spanOf(1, [sattr("openinference.span.kind", "LLM"), sattr("llm.model_name", "model-x")])]);
    expect(started(events)[0].payload.label).toBe("LLM_CALL model-x");
  });
});

describe("token counts from other names", () => {
  const usageOf = (attributes: unknown[]) => {
    const events = run([spanOf(1, [sattr("gen_ai.operation.name", "chat"), ...attributes])]);
    return { events, payload: usage(events)[0]?.payload };
  };

  it("reads the OpenLLMetry legacy names and records them", () => {
    const { payload } = usageOf([iattr("gen_ai.usage.prompt_tokens", 120), iattr("gen_ai.usage.completion_tokens", 30)]);
    expect(payload).toMatchObject({
      inputTokens: "120",
      outputTokens: "30",
      inputSource: "gen_ai.usage.prompt_tokens",
      outputSource: "gen_ai.usage.completion_tokens",
    });
  });

  it("reads the OpenInference names and records them", () => {
    const { payload } = usageOf([
      iattr("llm.token_count.prompt", 5),
      iattr("llm.token_count.completion", 6),
      iattr("llm.token_count.total", 11),
    ]);
    expect(payload).toMatchObject({
      inputTokens: "5",
      outputTokens: "6",
      inputSource: "llm.token_count.prompt",
      outputSource: "llm.token_count.completion",
    });
  });

  it("prefers the standard names, and takes each metric from its own first key", () => {
    const { payload } = usageOf([
      iattr("gen_ai.usage.prompt_tokens", 1),
      iattr("gen_ai.usage.input_tokens", 2),
      iattr("llm.token_count.completion", 3),
    ]);
    expect(payload).toMatchObject({
      inputTokens: "2",
      outputTokens: "3",
      inputSource: "gen_ai.usage.input_tokens",
      outputSource: "llm.token_count.completion",
    });
  });

  it("does not fall back to another key when the first one present is unusable", () => {
    const { events, payload } = usageOf([
      sattr("gen_ai.usage.input_tokens", "many"),
      iattr("gen_ai.usage.prompt_tokens", 9),
      iattr("gen_ai.usage.output_tokens", 4),
    ]);
    expect(payload).toMatchObject({ inputTokens: null, outputTokens: "4", inputSource: null, outputSource: "gen_ai.usage.output_tokens" });
    expect(notes(events, "UNUSABLE_USAGE")).toHaveLength(1);
  });

  it("records no sources when a metric is absent, and no event when both are", () => {
    expect(usageOf([iattr("llm.token_count.prompt", 5)]).payload).toMatchObject({
      inputTokens: "5",
      outputTokens: null,
      outputSource: null,
    });
    expect(usageOf([]).payload).toBeUndefined();
  });

  it("does not sum usage on a span that is not a model call, whatever the names", () => {
    const events = run([
      spanOf(1, [sattr("openinference.span.kind", "AGENT"), iattr("llm.token_count.prompt", 5), iattr("llm.token_count.completion", 6)]),
    ]);
    expect(usage(events)).toHaveLength(0);
    expect(notes(events, "USAGE_NOT_SUMMED")).toHaveLength(1);
  });

  it("totals a whole trace in the state", () => {
    const state = reduceRun(
      run([
        spanOf(1, [sattr("openinference.span.kind", "LLM"), iattr("llm.token_count.prompt", 10), iattr("llm.token_count.completion", 1)]),
        spanOf(2, [sattr("llm.request.type", "chat"), iattr("gen_ai.usage.prompt_tokens", 20), iattr("gen_ai.usage.completion_tokens", 2)]),
        spanOf(3, [sattr("gen_ai.operation.name", "chat"), iattr("gen_ai.usage.input_tokens", 30), iattr("gen_ai.usage.output_tokens", 3)]),
      ]),
    );
    expect([state.inputTokens, state.outputTokens]).toEqual(["60", "6"]);
  });
});

describe("privacy", () => {
  it("keeps the mapped values verbatim and every other value withheld", () => {
    const events = run([
      spanOf(1, [
        sattr("openinference.span.kind", "LLM"),
        sattr("input.value", "SECRET PROMPT TEXT"),
        sattr("llm.input_messages.0.message.content", "SECRET PROMPT TEXT"),
        sattr("traceloop.entity.input", "SECRET PROMPT TEXT"),
        sattr("gen_ai.prompt.0.content", "SECRET PROMPT TEXT"),
      ]),
    ]);
    expect(JSON.stringify(events)).not.toContain("SECRET PROMPT TEXT");
    expect(JSON.stringify(started(events)[0].payload.attributes)).toContain("openinference.span.kind");
  });

  it("withholds a kind value that is not an enumerated word, and then does not map it", () => {
    const events = run([spanOf(1, [sattr("traceloop.span.kind", "Some Free Text!")])]);
    expect(started(events)[0].payload.kind).toBe("OTHER");
    expect(JSON.stringify(events)).not.toContain("Some Free Text");
  });
});

describe("admission of version 3 files", () => {
  const base = () =>
    structuredClone(
      run([
        spanOf(1, [sattr("llm.request.type", "chat"), iattr("gen_ai.usage.prompt_tokens", 1), iattr("gen_ai.usage.completion_tokens", 2)]),
      ]),
    ) as RunEvent[];
  const edit = (change: (events: any[]) => void) => {
    const events = base() as any[];
    change(events);
    return reasonOf(() => validateRunHistory(events));
  };
  const find = (events: any[], type: string) => events.find((e) => e.type === type);

  it("accepts what the importer writes", () => {
    expect(edit(() => {})).toBe("OK");
  });

  it("requires the kind source, and refuses a source that the step does not show", () => {
    expect(edit((e) => delete find(e, "StepStarted").payload.kindSource)).toBe("E_INVALID_LOG:KIND_SOURCE_MISSING");
    expect(edit((e) => (find(e, "StepStarted").payload.kindSource = "openinference.span.kind"))).toBe("E_INVALID_LOG:KIND_SOURCE_MISMATCH");
    expect(edit((e) => (find(e, "StepStarted").payload.kindSource = null))).toBe("E_INVALID_LOG:KIND_WITHOUT_SOURCE");
    expect(
      edit((e) => {
        find(e, "StepStarted").payload.kind = "TOOL_CALL";
        find(e, "StepStarted").payload.label = "TOOL_CALL";
      }),
    ).toBe("E_INVALID_LOG:KIND_SOURCE_MISMATCH");
  });

  it("requires the usage sources, which must match the metrics they explain", () => {
    expect(edit((e) => delete find(e, "UsageRecorded").payload.inputSource)).toBe("E_INVALID_LOG:USAGE_SOURCE_MISSING");
    expect(edit((e) => (find(e, "UsageRecorded").payload.inputSource = "gen_ai.usage.completion_tokens"))).toBe(
      "E_INVALID_LOG:EVENT_SCHEMA",
    );
    expect(edit((e) => (find(e, "UsageRecorded").payload.inputSource = null))).toBe("E_INVALID_LOG:USAGE_SOURCE_MISMATCH");
  });

  it("refuses a file that mixes versions", () => {
    expect(edit((e) => (e[e.length - 1].schemaVersion = 2))).toBe("E_INVALID_LOG:MIXED_SCHEMA_VERSIONS");
  });

  it("refuses an unknown version", () => {
    expect(edit((e) => e.forEach((x) => (x.schemaVersion = 4)))).toBe("E_INVALID_LOG:UNSUPPORTED_SCHEMA_VERSION");
  });
});

describe("version 2 files stay readable", () => {
  const dir = new URL("./fixtures/schema-v2/", import.meta.url);
  it.each(["demo-run", "demo-run-full", "demo-run-variant"])("%s still opens, with the same totals as before", (name) => {
    const events = parseRunLog(new Uint8Array(readFileSync(new URL(`${name}.runlog.jsonl`, dir))));
    expect(new Set(events.map((e) => e.schemaVersion))).toEqual(new Set([2]));
    const state = reduceRun(events);
    expect(state.ended).toBe(true);
    expect(started(events).every((s) => s.payload.kindSource === undefined)).toBe(true);
    expect(Number(state.inputTokens)).toBeGreaterThan(0);
  });

  it("refuses version 3 fields inside a version 2 file", () => {
    const events = structuredClone(parseRunLog(new Uint8Array(readFileSync(new URL("demo-run.runlog.jsonl", dir))))) as any[];
    events.find((e) => e.type === "StepStarted").payload.kindSource = null;
    expect(reasonOf(() => validateRunHistory(events))).toBe("E_INVALID_LOG:KIND_SOURCE_NOT_IN_VERSION_2");
  });
});
