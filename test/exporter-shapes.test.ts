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
  it("reads the OpenTelemetry GenAI shape of the OpenAI Agents SDK instrumentation in full, except handoffs", () => {
    const state = run("openai-agents-otel.json");
    expect(state.stepsByKind).toEqual({ LLM_CALL: 2, TOOL_CALL: 1, AGENT: 1, OTHER: 1 });
    expect([state.inputTokens, state.outputTokens]).toEqual(["270", "50"]);
    // The handoff step has an operation name the importer does not map, so it is a step of kind OTHER with a note.
    expect(state.notes).toEqual({ UNRECOGNIZED_OPERATION: 1 });
  });

  it("reads the Pydantic AI and Logfire shape in full", () => {
    const state = run("pydantic-ai-logfire.json");
    expect(state.stepsByKind).toEqual({ LLM_CALL: 2, TOOL_CALL: 1, AGENT: 1, OTHER: 0 });
    expect([state.inputTokens, state.outputTokens]).toEqual(["270", "50"]);
    // The agent span carries a total of its children's usage; it is not added a second time.
    expect(state.notes.USAGE_NOT_SUMMED).toBe(1);
  });

  it("reads model calls and usage of a current OpenLLMetry version, but not its workflow and tool spans", () => {
    const state = run("openllmetry-current.json");
    expect(state.stepsByKind).toEqual({ LLM_CALL: 1, TOOL_CALL: 0, AGENT: 0, OTHER: 2 });
    expect([state.inputTokens, state.outputTokens]).toEqual(["120", "30"]);
  });

  it("imports an older OpenLLMetry trace and the LangSmith export, but sees no step kinds and no token counts", () => {
    for (const name of ["openllmetry-legacy.json", "langsmith-otel.json"]) {
      const state = run(name);
      expect(state.stepsByKind.LLM_CALL + state.stepsByKind.TOOL_CALL + state.stepsByKind.AGENT, name).toBe(0);
      expect([state.inputTokens, state.outputTokens], name).toEqual(["0", "0"]);
    }
  });

  it("imports an OpenInference trace, but sees no step kinds and no token counts", () => {
    const state = run("openinference.json");
    expect(state.stepsByKind).toEqual({ LLM_CALL: 0, TOOL_CALL: 0, AGENT: 0, OTHER: 3 });
    expect([state.inputTokens, state.outputTokens]).toEqual(["0", "0"]);
  });

  it("never keeps content in the default mode, whatever the shape", () => {
    for (const shape of SHAPES) {
      const text = JSON.stringify(importTraceBytes({ spans: new Uint8Array(readFileSync(fileUrl(shape.file))) }));
      expect(text, shape.file).not.toContain("Where is order 1042");
      expect(text, shape.file).not.toContain("It shipped on Monday");
    }
  });
});
