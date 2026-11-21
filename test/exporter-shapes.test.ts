import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { importTraceBytes } from "../src/run-import.js";
import { reduceRun } from "../src/run-reducer.js";
import { SHAPES, render } from "./fixtures/exporters/make-exporter-fixtures.js";

// What the importer does with the attribute shapes of common emitters. The fixtures are synthetic and were written
// from public documentation and source, so these tests say what DropScope does with each shape, not that a real
// installation produces it. The "Works with" table in the README must match this file.
const fileUrl = (name: string) => new URL(`./fixtures/exporters/${name}`, import.meta.url);
const run = (name: string) => reduceRun(importTraceBytes({ spans: new Uint8Array(readFileSync(fileUrl(name))) }));

describe("synthetic exporter fixtures", () => {
  it.each(SHAPES.map((shape, index) => [shape.file, index] as const))("%s matches its generator", (file, index) => {
    expect(readFileSync(fileUrl(file), "utf8"), "run: npx tsx test/fixtures/exporters/make-exporter-fixtures.ts").toBe(
      render(SHAPES[index], index),
    );
  });
});

describe("what imports today", () => {
  const sourcesOf = (name: string) => {
    const events = importTraceBytes({ spans: new Uint8Array(readFileSync(fileUrl(name))) });
    const kindSources = events.flatMap((e) => (e.type === "StepStarted" ? [e.payload.kindSource ?? "none"] : []));
    const usageSources = events.flatMap((e) => (e.type === "UsageRecorded" ? [e.payload.inputSource, e.payload.outputSource] : []));
    return { kindSources: [...new Set(kindSources)].sort(), usageSources: [...new Set(usageSources)].sort() };
  };

  it("reads the OpenTelemetry GenAI shape of the OpenAI Agents SDK instrumentation in full, except handoffs", () => {
    const state = run("openai-agents-otel.json");
    expect(state.stepsByKind).toEqual({ LLM_CALL: 2, TOOL_CALL: 1, AGENT: 1, OTHER: 1 });
    expect([state.inputTokens, state.outputTokens]).toEqual(["270", "50"]);
    // The handoff step has an operation name the importer does not map, so it is a step of kind OTHER with a note.
    expect(state.notes).toEqual({ UNRECOGNIZED_OPERATION: 1 });
    expect(sourcesOf("openai-agents-otel.json")).toEqual({
      kindSources: ["gen_ai.operation.name", "none"],
      usageSources: ["gen_ai.usage.input_tokens", "gen_ai.usage.output_tokens"],
    });
  });

  it("reads the Pydantic AI and Logfire shape in full", () => {
    const state = run("pydantic-ai-logfire.json");
    expect(state.stepsByKind).toEqual({ LLM_CALL: 2, TOOL_CALL: 1, AGENT: 1, OTHER: 0 });
    expect([state.inputTokens, state.outputTokens]).toEqual(["270", "50"]);
    // The agent span carries a total of its children's usage; it is not added a second time.
    expect(state.notes.USAGE_NOT_SUMMED).toBe(1);
    expect(sourcesOf("pydantic-ai-logfire.json").kindSources).toEqual(["gen_ai.operation.name"]);
  });

  it("reads a current OpenLLMetry trace: model calls by the standard name, tool spans by traceloop.span.kind", () => {
    const state = run("openllmetry-current.json");
    // The workflow span stays OTHER: it is a grouping span, not a step of work.
    expect(state.stepsByKind).toEqual({ LLM_CALL: 1, TOOL_CALL: 1, AGENT: 0, OTHER: 1 });
    expect([state.inputTokens, state.outputTokens]).toEqual(["120", "30"]);
    expect(sourcesOf("openllmetry-current.json")).toEqual({
      kindSources: ["gen_ai.operation.name", "none", "traceloop.span.kind"],
      usageSources: ["gen_ai.usage.input_tokens", "gen_ai.usage.output_tokens"],
    });
  });

  it("reads an older OpenLLMetry trace: llm.request.type and the prompt and completion token names", () => {
    const state = run("openllmetry-legacy.json");
    expect(state.stepsByKind).toEqual({ LLM_CALL: 1, TOOL_CALL: 0, AGENT: 0, OTHER: 1 });
    expect([state.inputTokens, state.outputTokens]).toEqual(["120", "30"]);
    expect(sourcesOf("openllmetry-legacy.json")).toEqual({
      kindSources: ["llm.request.type", "none"],
      usageSources: ["gen_ai.usage.completion_tokens", "gen_ai.usage.prompt_tokens"],
    });
  });

  it("reads the LangSmith OpenTelemetry export: langsmith.span.kind and the prompt and completion token names", () => {
    const state = run("langsmith-otel.json");
    // The chain span (the graph) stays OTHER.
    expect(state.stepsByKind).toEqual({ LLM_CALL: 1, TOOL_CALL: 1, AGENT: 0, OTHER: 1 });
    expect([state.inputTokens, state.outputTokens]).toEqual(["120", "30"]);
    expect(sourcesOf("langsmith-otel.json").kindSources).toEqual(["langsmith.span.kind", "none"]);
  });

  it("reads an OpenInference trace: openinference.span.kind and llm.token_count.*", () => {
    const state = run("openinference.json");
    expect(state.stepsByKind).toEqual({ LLM_CALL: 1, TOOL_CALL: 1, AGENT: 1, OTHER: 0 });
    expect([state.inputTokens, state.outputTokens]).toEqual(["120", "30"]);
    expect(sourcesOf("openinference.json")).toEqual({
      kindSources: ["openinference.span.kind"],
      usageSources: ["llm.token_count.completion", "llm.token_count.prompt"],
    });
  });

  it("never keeps content in the default mode, whatever the shape", () => {
    for (const shape of SHAPES) {
      const text = JSON.stringify(importTraceBytes({ spans: new Uint8Array(readFileSync(fileUrl(shape.file))) }));
      expect(text, shape.file).not.toContain("Where is order 1042");
      expect(text, shape.file).not.toContain("It shipped on Monday");
    }
  });
});
