// Generates the synthetic demo run shown on the Replay screen.
//   npx tsx test/fixtures/make-demo-run.ts
// It writes the readable source trace (test/fixtures/demo-run-trace.json) and the run log the browser loads
// (src/frontend/assets/demo-run.runlog.jsonl), produced by the real importer in the default HASH_ONLY mode, and the
// same run with content stored (demo-run-full.runlog.jsonl, importer mode FULL), used by the claim check.
// All content is invented. test/demo-run.test.ts fails if the committed run log drifts from this source.
import { writeFileSync } from "node:fs";
import { importTraceBytes } from "../../src/run-import.js";
import { serializeRunLog } from "../../src/run-store.js";

const TRACE_ID = "5b8efff798038103d269b633813fc60c";
const VARIANT_TRACE_ID = "7c1d4e2a9f6b8035a1e0d2c4b6f89a13";
const BASE_S = 1_760_000_000n; // an arbitrary fixed moment
const ns = (seconds: number): string => (BASE_S * 1_000_000_000n + BigInt(Math.round(seconds * 1e9))).toString();
let counter = 0;
let traceId = TRACE_ID;
const nextId = (): string => (0xa100n + BigInt(++counter)).toString(16).padStart(16, "0");

type Attr = { key: string; value: Record<string, unknown> };
const str = (key: string, value: string): Attr => ({ key, value: { stringValue: value } });
const int = (key: string, value: number): Attr => ({ key, value: { intValue: String(value) } });

type SpanSpec = {
  name: string; start: number; end: number; parent?: string; attributes: Attr[]; error?: string; kind?: number;
};
let spans: Array<Record<string, unknown>> = [];
function span(spec: SpanSpec): string {
  const id = nextId();
  spans.push({
    traceId, spanId: id, ...(spec.parent ? { parentSpanId: spec.parent } : {}), name: spec.name,
    kind: spec.kind ?? 1, startTimeUnixNano: ns(spec.start), endTimeUnixNano: ns(spec.end), attributes: spec.attributes,
    status: spec.error ? { code: 2, message: spec.error } : { code: 1 },
  });
  return id;
}
const llm = (name: string, start: number, end: number, parent: string, tokensIn: number, tokensOut: number, prompt: string, answer: string) =>
  span({
    name, start, end, parent, kind: 3,
    attributes: [
      str("gen_ai.operation.name", "chat"), str("gen_ai.provider.name", "example-ai"), str("gen_ai.request.model", "sim-model-1"),
      str("gen_ai.response.model", "sim-model-1"), int("gen_ai.usage.input_tokens", tokensIn), int("gen_ai.usage.output_tokens", tokensOut),
      str("gen_ai.input.messages", prompt), str("gen_ai.output.messages", answer),
    ],
  });
const tool = (name: string, start: number, end: number, parent: string, args: string, result: string | null, error?: string) =>
  span({
    name, start, end, parent, error,
    attributes: [
      str("gen_ai.operation.name", "execute_tool"), str("gen_ai.tool.name", name.replace("tool ", "")),
      str("gen_ai.tool.call.arguments", args), ...(result === null ? [] : [str("gen_ai.tool.call.result", result)]),
      ...(error ? [str("error.type", "timeout")] : []),
    ],
  });

/** Builds the readable source trace. The variant is a different run: the second refund attempt also times out. */
function buildTrace(variant: boolean): Uint8Array {
  counter = 0; spans = []; traceId = variant ? VARIANT_TRACE_ID : TRACE_ID;
  const root = span({
    name: "support agent run", start: 0, end: 9.1, kind: 1,
    attributes: [str("gen_ai.operation.name", "invoke_agent"), str("gen_ai.agent.name", "support-agent")],
  });
  llm("plan", 0.1, 0.9, root, 420, 85, "Customer asks for a refund for order 1042. Plan the steps.", "1) look up order 2) check refund policy 3) draft reply");
  tool("tool lookup_order", 1.0, 1.4, root, "{\"order\":1042}", "{\"total\":59.0,\"delivered\":false}");
  tool("tool search_policy", 1.0, 2.1, root, "{\"query\":\"refund undelivered\"}", "Undelivered orders are refundable in full.");
  llm("draft", 2.2, 4.0, root, 1380, 310, "Draft a reply using the order and the policy. Contact: jane.doe@example.com", "Hello, your order will be refunded in full.");
  tool("tool issue_refund", 4.1, 4.6, root, "{\"order\":1042,\"amount\":59.0}", null, "the payment service did not answer in time");
  if (variant) tool("tool issue_refund", 4.8, 5.3, root, "{\"order\":1042,\"amount\":59.0}", null, "the payment service did not answer in time");
  else tool("tool issue_refund", 4.8, 5.3, root, "{\"order\":1042,\"amount\":59.0}", "{\"refund\":\"accepted\"}");
  const reviewer = span({
    name: "qa reviewer", start: 5.4, end: 8.4, parent: root,
    attributes: [str("gen_ai.operation.name", "invoke_agent"), str("gen_ai.agent.name", "qa-reviewer")],
  });
  llm("review", 5.5, 8.2, reviewer, 1720, 150, "Review the draft reply for tone and correctness.", "The reply is correct. Suggest a friendlier closing.");
  if (variant) llm("final answer", 8.5, 9.0, root, 2190, 260, "Write the final reply with the friendlier closing.", "Hello! We could not process your refund of 59.00 yet. We will try again and write to you.");
  else llm("final answer", 8.5, 9.0, root, 2010, 240, "Write the final reply with the friendlier closing.", "Hello! Your refund of 59.00 is on its way. Thanks for your patience.");

  const trace = {
    resourceSpans: [{
      resource: { attributes: [str("service.name", "demo-support-agent")] },
      schemaUrl: "https://opentelemetry.io/schemas/1.37.0",
      scopeSpans: [{ scope: { name: "demo.agent", version: "1.0" }, spans }],
    }],
  };
  return new TextEncoder().encode(`${JSON.stringify(trace, null, 2)}
`);
}

const bytes = buildTrace(false);
const events = importTraceBytes({ spans: bytes });
// The same run with its content stored, so the claim check has something to read. All content is invented.
const fullEvents = importTraceBytes({ spans: bytes, contentMode: "FULL" });
writeFileSync(new URL("./demo-run-trace.json", import.meta.url), bytes);
writeFileSync(new URL("../../src/frontend/assets/demo-run.runlog.jsonl", import.meta.url), serializeRunLog(events));
writeFileSync(new URL("../../src/frontend/assets/demo-run-full.runlog.jsonl", import.meta.url), serializeRunLog(fullEvents));
// A second, different run for the run diff screen: the refund never goes through. Content stored, so a diff shows content too.
const variantBytes = buildTrace(true);
const variantEvents = importTraceBytes({ spans: variantBytes, contentMode: "FULL" });
writeFileSync(new URL("./demo-run-variant-trace.json", import.meta.url), variantBytes);
writeFileSync(new URL("../../src/frontend/assets/demo-run-variant.runlog.jsonl", import.meta.url), serializeRunLog(variantEvents));
console.log(`demo run: ${spans.length} spans, ${events.length} events`);
