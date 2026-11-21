// Privacy classification tables (spec section 6.2), shared by the emitter and the reducer so that a
// run file read back from disk is checked against the same rules that produced it.
import type { TaggedValue } from "./run-events.js";

export type Check = (value: TaggedValue) => boolean;
const str =
  (pattern: RegExp): Check =>
  (v) =>
    v.t === "s" && pattern.test(v.v);
const uint =
  (max?: bigint): Check =>
  (v) =>
    v.t === "i" && /^[0-9]{1,20}$/.test(v.v) && (max === undefined || BigInt(v.v) <= max);
const strArray =
  (pattern: RegExp): Check =>
  (v) =>
    v.t === "a" && v.v.every((e) => e.t === "s" && pattern.test(e.v));

export const ALLOWLIST = new Map<string, Check>([
  ["gen_ai.operation.name", str(/^[a-z_]{1,64}$/)],
  ["gen_ai.provider.name", str(/^[a-z0-9._-]{1,64}$/)],
  ["gen_ai.system", str(/^[a-z0-9._-]{1,64}$/)],
  ["gen_ai.request.model", str(/^[A-Za-z0-9._:/@+-]{1,128}$/)],
  ["gen_ai.response.model", str(/^[A-Za-z0-9._:/@+-]{1,128}$/)],
  ["gen_ai.usage.input_tokens", uint()],
  ["gen_ai.usage.output_tokens", uint()],
  ["gen_ai.usage.total_tokens", uint()],
  ["gen_ai.response.finish_reasons", strArray(/^[a-z_]{1,32}$/)],
  ["gen_ai.tool.name", str(/^[A-Za-z0-9._-]{1,128}$/)],
  ["gen_ai.tool.type", str(/^[a-z_]{1,32}$/)],
  ["gen_ai.agent.name", str(/^[A-Za-z0-9._ -]{1,128}$/)],
  ["gen_ai.agent.id", str(/^[A-Za-z0-9._:-]{1,128}$/)],
  ["gen_ai.response.id", str(/^[A-Za-z0-9._:-]{1,128}$/)],
  ["error.type", str(/^[A-Za-z0-9._:-]{1,128}$/)],
  ["server.port", uint(65535n)],
  // Names written by other common emitters (contract v1.1, schema version 3). Each is a short enumerated word, a model name
  // or a whole number, like the standard keys above, so none of them can carry free text.
  ["llm.request.type", str(/^[a-z_]{1,32}$/)],
  ["traceloop.span.kind", str(/^[a-z_]{1,32}$/)],
  ["langsmith.span.kind", str(/^[a-z_]{1,32}$/)],
  ["openinference.span.kind", str(/^[A-Z_]{1,32}$/)],
  ["llm.model_name", str(/^[A-Za-z0-9._:/@+-]{1,128}$/)],
  ["gen_ai.usage.prompt_tokens", uint()],
  ["gen_ai.usage.completion_tokens", uint()],
  ["llm.token_count.prompt", uint()],
  ["llm.token_count.completion", uint()],
  ["llm.token_count.total", uint()],
]);
export const SCOPE_NAME = /^[a-z0-9._-]{1,128}$/;
export const SCOPE_VERSION = /^[0-9A-Za-z.+-]{1,64}$/;
export const SCHEMA_URL = /^https:\/\/opentelemetry\.io\/schemas\/[0-9.]{1,32}$/;

// Where a step's kind can come from (contract v1.1). The standard operation name always wins. When a span has no operation
// name, the first of these keys that is present decides. A present but unmapped operation name is never overridden.
export const KIND_SOURCE_KEYS = [
  "gen_ai.operation.name",
  "openinference.span.kind",
  "traceloop.span.kind",
  "langsmith.span.kind",
  "llm.request.type",
] as const;
export type KindSourceKey = (typeof KIND_SOURCE_KEYS)[number];
type MappedKind = "LLM_CALL" | "TOOL_CALL" | "AGENT" | "OTHER";

const KIND_BY_VALUE: Record<KindSourceKey, ReadonlyMap<string, MappedKind>> = {
  "gen_ai.operation.name": new Map<string, MappedKind>([
    ["chat", "LLM_CALL"],
    ["text_completion", "LLM_CALL"],
    ["generate_content", "LLM_CALL"],
    ["embeddings", "LLM_CALL"],
    ["execute_tool", "TOOL_CALL"],
    ["invoke_agent", "AGENT"],
    ["create_agent", "AGENT"],
  ]),
  "openinference.span.kind": new Map<string, MappedKind>([
    ["LLM", "LLM_CALL"],
    ["EMBEDDING", "LLM_CALL"],
    ["TOOL", "TOOL_CALL"],
    ["AGENT", "AGENT"],
  ]),
  "traceloop.span.kind": new Map<string, MappedKind>([
    ["agent", "AGENT"],
    ["tool", "TOOL_CALL"],
  ]),
  "langsmith.span.kind": new Map<string, MappedKind>([
    ["llm", "LLM_CALL"],
    ["embedding", "LLM_CALL"],
    ["tool", "TOOL_CALL"],
  ]),
  "llm.request.type": new Map<string, MappedKind>([
    ["chat", "LLM_CALL"],
    ["completion", "LLM_CALL"],
    ["embedding", "LLM_CALL"],
  ]),
};

// The kind a value of one of the source keys stands for, or null when the value is not mapped.
export const kindFromValue = (key: KindSourceKey, value: string): MappedKind | null => KIND_BY_VALUE[key].get(value) ?? null;

// Token counts: the first key of each list that is present is used (contract v1.1, section 8.1).
export const USAGE_INPUT_KEYS = ["gen_ai.usage.input_tokens", "gen_ai.usage.prompt_tokens", "llm.token_count.prompt"] as const;
export const USAGE_OUTPUT_KEYS = ["gen_ai.usage.output_tokens", "gen_ai.usage.completion_tokens", "llm.token_count.completion"] as const;
export const ALL_USAGE_KEYS: ReadonlySet<string> = new Set<string>([...USAGE_INPUT_KEYS, ...USAGE_OUTPUT_KEYS]);

// The model name of a step, for its label.
export const MODEL_KEYS = ["gen_ai.request.model", "gen_ai.response.model", "llm.model_name"] as const;

export const KNOWN_CONTENT_KEYS = new Set([
  "gen_ai.input.messages",
  "gen_ai.output.messages",
  "gen_ai.system_instructions",
  "gen_ai.tool.call.arguments",
  "gen_ai.tool.call.result",
]);

// The label of a step is derived only from structural data (spec 6.4): its kind, its operation name if it
// passes its pattern, and its model if it passes its pattern. The reducer recomputes it on read, so a label
// cannot carry content.
export function deriveLabel(kind: string, operation: TaggedValue | undefined, model: TaggedValue | undefined): string {
  const parts: string[] = [kind];
  if (operation !== undefined && operation.t === "s" && ALLOWLIST.get("gen_ai.operation.name")?.(operation)) parts.push(operation.v);
  if (model !== undefined && model.t === "s" && ALLOWLIST.get("gen_ai.request.model")?.(model)) parts.push(model.v);
  return parts.join(" ");
}
