// Generates small synthetic OTLP/JSON traces in the attribute shapes of common emitters.
//   npx tsx test/fixtures/exporters/make-exporter-fixtures.ts
// The shapes were written from each project's public documentation and source (see docs/WORKS_WITH.md). They are
// not captures from a real installation, and every value is invented. test/exporter-shapes.test.ts fails if a
// committed file drifts from this generator.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

type Attr = { key: string; value: Record<string, unknown> };
const str = (key: string, value: string): Attr => ({ key, value: { stringValue: value } });
const int = (key: string, value: number): Attr => ({ key, value: { intValue: String(value) } });
const strs = (key: string, values: string[]): Attr => ({ key, value: { arrayValue: { values: values.map((v) => ({ stringValue: v })) } } });

const BASE = 1_760_000_000n * 1_000_000_000n;
const at = (seconds: number): string => (BASE + BigInt(Math.round(seconds * 1e9))).toString();

type SpanSpec = { id: number; parent?: number; name: string; start: number; end: number; attributes: Attr[]; kind?: number };
export type Shape = { file: string; scope: { name: string; version: string }; schemaUrl?: string; resource: Attr[]; spans: SpanSpec[] };

const traceIdOf = (n: number) => n.toString(16).padStart(32, "0");
const spanIdOf = (n: number) => n.toString(16).padStart(16, "0");

export function toOtlp(shape: Shape, traceNumber: number): unknown {
  return {
    resourceSpans: [{
      resource: { attributes: shape.resource },
      scopeSpans: [{
        ...(shape.schemaUrl ? { schemaUrl: shape.schemaUrl } : {}),
        scope: shape.scope,
        spans: shape.spans.map((s) => ({
          traceId: traceIdOf(traceNumber), spanId: spanIdOf(s.id), ...(s.parent ? { parentSpanId: spanIdOf(s.parent) } : {}),
          name: s.name, kind: s.kind ?? 1, startTimeUnixNano: at(s.start), endTimeUnixNano: at(s.end),
          attributes: s.attributes, status: { code: 1 },
        })),
      }],
    }],
  };
}

const MESSAGES_IN = JSON.stringify([{ role: "user", parts: [{ type: "text", content: "Where is order 1042?" }] }]);
const MESSAGES_OUT = JSON.stringify([{ role: "assistant", parts: [{ type: "text", content: "It shipped on Monday." }], finish_reason: "stop" }]);
const TOOL_ARGS = JSON.stringify({ order_id: "1042" });
const TOOL_RESULT = JSON.stringify({ status: "shipped" });

export const SHAPES: Shape[] = [
  {
    // OpenTelemetry GenAI conventions as emitted by the OpenTelemetry instrumentation for the OpenAI Agents SDK.
    file: "openai-agents-otel.json", scope: { name: "opentelemetry.instrumentation.openai_agents", version: "0.1.0" },
    schemaUrl: "https://opentelemetry.io/schemas/1.37.0", resource: [str("service.name", "synthetic-support")],
    spans: [
      { id: 1, name: "invoke_agent Support agent", start: 0, end: 6, attributes: [str("gen_ai.operation.name", "invoke_agent"), str("gen_ai.provider.name", "openai"), str("gen_ai.agent.name", "Support agent")] },
      { id: 2, parent: 1, name: "chat example-model", start: 0.5, end: 2, kind: 3, attributes: [str("gen_ai.operation.name", "chat"), str("gen_ai.provider.name", "openai"), str("gen_ai.request.model", "example-model"), str("gen_ai.response.model", "example-model"), int("gen_ai.usage.input_tokens", 120), int("gen_ai.usage.output_tokens", 30), strs("gen_ai.response.finish_reasons", ["tool_calls"]), str("gen_ai.input.messages", MESSAGES_IN), str("gen_ai.output.messages", MESSAGES_OUT)] },
      { id: 3, parent: 1, name: "execute_tool lookup_order", start: 2, end: 3, attributes: [str("gen_ai.operation.name", "execute_tool"), str("gen_ai.tool.name", "lookup_order"), str("gen_ai.tool.type", "function"), str("gen_ai.tool.call.arguments", TOOL_ARGS), str("gen_ai.tool.call.result", TOOL_RESULT)] },
      { id: 4, parent: 1, name: "agent_handoff Billing agent", start: 3, end: 3.2, attributes: [str("gen_ai.operation.name", "agent_handoff"), str("gen_ai.handoff.from_agent", "Support agent"), str("gen_ai.handoff.to_agent", "Billing agent")] },
      { id: 5, parent: 1, name: "chat example-model", start: 3.5, end: 5, kind: 3, attributes: [str("gen_ai.operation.name", "chat"), str("gen_ai.provider.name", "openai"), str("gen_ai.request.model", "example-model"), int("gen_ai.usage.input_tokens", 150), int("gen_ai.usage.output_tokens", 20), str("gen_ai.input.messages", MESSAGES_IN), str("gen_ai.output.messages", MESSAGES_OUT)] },
    ],
  },
  {
    // Pydantic AI instrumentation, as sent to Logfire or any OpenTelemetry backend. Logfire adds its own attributes.
    file: "pydantic-ai-logfire.json", scope: { name: "pydantic-ai", version: "1.0.0" },
    resource: [str("service.name", "synthetic-support"), str("telemetry.sdk.name", "opentelemetry")],
    spans: [
      { id: 1, name: "invoke_agent support", start: 0, end: 6, attributes: [str("gen_ai.operation.name", "invoke_agent"), str("gen_ai.agent.name", "support"), int("gen_ai.usage.input_tokens", 270), int("gen_ai.usage.output_tokens", 50), str("pydantic_ai.all_messages", MESSAGES_IN), str("logfire.msg", "support run"), str("logfire.span_type", "span")] },
      { id: 2, parent: 1, name: "chat example-model", start: 0.5, end: 2, kind: 3, attributes: [str("gen_ai.operation.name", "chat"), str("gen_ai.provider.name", "openai"), str("gen_ai.request.model", "example-model"), str("gen_ai.response.model", "example-model"), int("gen_ai.usage.input_tokens", 120), int("gen_ai.usage.output_tokens", 30), str("gen_ai.input.messages", MESSAGES_IN), str("gen_ai.output.messages", MESSAGES_OUT), str("server.address", "api.example.test"), str("logfire.span_type", "span")] },
      { id: 3, parent: 1, name: "execute_tool lookup_order", start: 2, end: 3, attributes: [str("gen_ai.operation.name", "execute_tool"), str("gen_ai.tool.name", "lookup_order"), str("gen_ai.tool.call.id", "call_0001"), str("gen_ai.tool.call.arguments", TOOL_ARGS), str("gen_ai.tool.call.result", TOOL_RESULT), str("logfire.span_type", "span")] },
      { id: 4, parent: 1, name: "chat example-model", start: 3.5, end: 5, kind: 3, attributes: [str("gen_ai.operation.name", "chat"), str("gen_ai.provider.name", "openai"), str("gen_ai.request.model", "example-model"), int("gen_ai.usage.input_tokens", 150), int("gen_ai.usage.output_tokens", 20), str("gen_ai.input.messages", MESSAGES_IN), str("gen_ai.output.messages", MESSAGES_OUT)] },
    ],
  },
  {
    // OpenLLMetry (Traceloop), a current version of an LLM instrumentation: standard operation name and token names,
    // content as indexed gen_ai.prompt.N and gen_ai.completion.N attributes, workflow and tool spans from traceloop.*.
    file: "openllmetry-current.json", scope: { name: "opentelemetry.instrumentation.openai.v1", version: "0.50.0" },
    resource: [str("service.name", "synthetic-support"), str("telemetry.sdk.name", "opentelemetry")],
    spans: [
      { id: 1, name: "support.workflow", start: 0, end: 6, attributes: [str("traceloop.span.kind", "workflow"), str("traceloop.workflow.name", "support"), str("traceloop.entity.name", "support")] },
      { id: 2, parent: 1, name: "openai.chat", start: 0.5, end: 2, kind: 3, attributes: [str("gen_ai.operation.name", "chat"), str("gen_ai.system", "openai"), str("llm.request.type", "chat"), str("gen_ai.request.model", "example-model"), str("gen_ai.response.model", "example-model"), int("gen_ai.usage.input_tokens", 120), int("gen_ai.usage.output_tokens", 30), int("gen_ai.usage.total_tokens", 150), str("gen_ai.prompt.0.role", "user"), str("gen_ai.prompt.0.content", "Where is order 1042?"), str("gen_ai.completion.0.role", "assistant"), str("gen_ai.completion.0.content", "It shipped on Monday.")] },
      { id: 3, parent: 1, name: "lookup_order.tool", start: 2, end: 3, attributes: [str("traceloop.span.kind", "tool"), str("traceloop.entity.name", "lookup_order"), str("traceloop.entity.input", TOOL_ARGS), str("traceloop.entity.output", TOOL_RESULT)] },
    ],
  },
  {
    // OpenLLMetry (Traceloop), an older version: no gen_ai.operation.name, the legacy token names.
    file: "openllmetry-legacy.json", scope: { name: "opentelemetry.instrumentation.openai.v1", version: "0.30.0" },
    resource: [str("service.name", "synthetic-support")],
    spans: [
      { id: 1, name: "support.workflow", start: 0, end: 6, attributes: [str("traceloop.span.kind", "workflow"), str("traceloop.workflow.name", "support")] },
      { id: 2, parent: 1, name: "openai.chat", start: 0.5, end: 2, kind: 3, attributes: [str("gen_ai.system", "openai"), str("llm.request.type", "chat"), str("gen_ai.request.model", "example-model"), str("gen_ai.response.model", "example-model"), int("gen_ai.usage.prompt_tokens", 120), int("gen_ai.usage.completion_tokens", 30), int("llm.usage.total_tokens", 150), str("gen_ai.prompt.0.role", "user"), str("gen_ai.prompt.0.content", "Where is order 1042?"), str("gen_ai.completion.0.content", "It shipped on Monday.")] },
    ],
  },
  {
    // OpenInference (Arize Phoenix and Arize AX): its own attribute names, no gen_ai.* attributes.
    file: "openinference.json", scope: { name: "openinference.instrumentation.openai_agents", version: "1.0.0" },
    resource: [str("service.name", "synthetic-support"), str("openinference.project.name", "synthetic")],
    spans: [
      { id: 1, name: "Support agent", start: 0, end: 6, attributes: [str("openinference.span.kind", "AGENT"), str("input.value", "Where is order 1042?"), str("output.value", "It shipped on Monday.")] },
      { id: 2, parent: 1, name: "ChatCompletion", start: 0.5, end: 2, kind: 3, attributes: [str("openinference.span.kind", "LLM"), str("llm.model_name", "example-model"), str("llm.provider", "openai"), str("llm.system", "openai"), int("llm.token_count.prompt", 120), int("llm.token_count.completion", 30), int("llm.token_count.total", 150), str("llm.input_messages.0.message.role", "user"), str("llm.input_messages.0.message.content", "Where is order 1042?"), str("llm.output_messages.0.message.role", "assistant"), str("llm.output_messages.0.message.content", "It shipped on Monday.")] },
      { id: 3, parent: 1, name: "lookup_order", start: 2, end: 3, attributes: [str("openinference.span.kind", "TOOL"), str("tool.name", "lookup_order"), str("input.value", TOOL_ARGS), str("output.value", TOOL_RESULT)] },
    ],
  },
  {
    // LangChain and LangGraph through the LangSmith OpenTelemetry export: langsmith.* attributes with gen_ai.* content.
    file: "langsmith-otel.json", scope: { name: "langsmith", version: "0.4.0" },
    resource: [str("service.name", "synthetic-support")],
    spans: [
      { id: 1, name: "support_graph", start: 0, end: 6, attributes: [str("langsmith.span.kind", "chain"), str("langsmith.trace.session_name", "synthetic"), str("langsmith.span.id", "00000000-0000-4000-8000-000000000001")] },
      { id: 2, parent: 1, name: "ChatModel", start: 0.5, end: 2, kind: 3, attributes: [str("langsmith.span.kind", "llm"), str("gen_ai.system", "openai"), str("llm.request.type", "chat"), str("gen_ai.request.model", "example-model"), str("gen_ai.prompt.0.role", "user"), str("gen_ai.prompt.0.content", "Where is order 1042?"), str("gen_ai.completion.0.role", "assistant"), str("gen_ai.completion.0.content", "It shipped on Monday."), int("gen_ai.usage.prompt_tokens", 120), int("gen_ai.usage.completion_tokens", 30), int("gen_ai.usage.total_tokens", 150)] },
      { id: 3, parent: 1, name: "lookup_order", start: 2, end: 3, attributes: [str("langsmith.span.kind", "tool"), str("gen_ai.tool.name", "lookup_order")] },
    ],
  },
];

export const render = (shape: Shape, index: number): string => `${JSON.stringify(toOtlp(shape, 0xe100 + index), null, 1)}\n`;

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  SHAPES.forEach((shape, i) => writeFileSync(new URL(shape.file, import.meta.url), render(shape, i)));
  console.log(`wrote ${SHAPES.length} fixtures`);
}
