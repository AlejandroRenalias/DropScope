// Privacy classification tables (spec section 6.2), shared by the emitter and the reducer so that a
// run file read back from disk is checked against the same rules that produced it.
import type { TaggedValue } from "./run-events.js";

export type Check = (value: TaggedValue) => boolean;
const str = (pattern: RegExp): Check => (v) => v.t === "s" && pattern.test(v.v);
const uint = (max?: bigint): Check => (v) =>
  v.t === "i" && /^[0-9]{1,20}$/.test(v.v) && (max === undefined || BigInt(v.v) <= max);
const strArray = (pattern: RegExp): Check => (v) => v.t === "a" && v.v.every((e) => e.t === "s" && pattern.test(e.v));

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
]);
export const SCOPE_NAME = /^[a-z0-9._-]{1,128}$/;
export const SCOPE_VERSION = /^[0-9A-Za-z.+-]{1,64}$/;
export const SCHEMA_URL = /^https:\/\/opentelemetry\.io\/schemas\/[0-9.]{1,32}$/;

export const KNOWN_CONTENT_KEYS = new Set([
  "gen_ai.input.messages", "gen_ai.output.messages", "gen_ai.system_instructions",
  "gen_ai.tool.call.arguments", "gen_ai.tool.call.result",
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
