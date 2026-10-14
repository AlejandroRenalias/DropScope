// Phase 2 of the import (spec section 2): validate the structure of every span and log record
// and turn the parsed JSON into typed values. It does not select a trace, collapse duplicates,
// order events or apply privacy; later phases do that.
//
// Rules applied here: spec 1.3 (integers), 1.4 (ids), 1.5 (enums), 1.6 (AnyValue), 1.7 (unknown fields).
// - JSON null for a known field means "absent" (protobuf JSON rule). Inside a kept unknown field it fails closed.
// - AnyValue and KeyValue are strict: an extra property or a wrong arm count fails with E_ANYVALUE.
//   One exception: a log record body of exactly {} means "no body" (real traces contain it).
// - Unknown properties on a span, span event, link, status, log record, resource and scope are kept as
//   tagged data and counted. Unknown properties on the outer wrappers (the request and the resource and
//   scope group objects) are counted only.
// - No recursion over untrusted structure: value conversion uses an explicit stack.
import { ImportError } from "./run-import-error.js";
import type { TaggedValue } from "./run-events.js";
import type { JsonNumber, JsonObject, JsonValue } from "./strict-json.js";

export type ParsedAttribute = { ordinal: number; key: string; value: TaggedValue };

// A resource is read once per resource group and shared (the same object) by every context under it, so a
// large resource is never converted, hashed or scanned again for each scope.
export type ParsedResource = {
  attributes: ParsedAttribute[]; schemaUrl: string | null; droppedAttributesCount: number; unknownFields: TaggedValue | null;
  unknownCount: number;
};

export type ParsedContext = {
  resource: ParsedResource;
  scope: {
    name: string | null; version: string | null; attributes: ParsedAttribute[]; schemaUrl: string | null;
    droppedAttributesCount: number; unknownFields: TaggedValue | null;
  };
  // Unknown properties on the resource and scope objects (kept in their unknownFields).
  unknownCount: number;
};

// Work budget (spec section 10): every tagged value built from input counts one unit, across all files of
// one import. The input node limit bounds the input; this bounds what is built from it.
export type WorkBudget = { remaining: number };
export const DEFAULT_WORK_UNITS = 4_000_000;

export type ParsedSpanEvent = {
  ordinal: number;
  timeNs: string;
  name: string;
  attributes: ParsedAttribute[];
  droppedAttributesCount: number;
  unknownFields: TaggedValue | null;
};

export type ParsedSpan = {
  contextIndex: number;
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  traceState: string;
  flags: number;
  name: string;
  kind: number;
  startNs: string;
  endNs: string | null;
  attributes: ParsedAttribute[];
  droppedAttributesCount: number;
  events: ParsedSpanEvent[];
  droppedEventsCount: number;
  links: TaggedValue[];
  droppedLinksCount: number;
  statusCode: number;
  statusMessage: string;
  unknownFields: TaggedValue | null;
  unknownCount: number;
};

export type ParsedLogRecord = {
  contextIndex: number;
  traceId: string | null;
  spanId: string | null;
  timeNs: string;
  observedTimeNs: string;
  severityNumber: number;
  severityText: string;
  flags: number;
  eventName: string;
  droppedAttributesCount: number;
  body: TaggedValue | null;
  attributes: ParsedAttribute[];
  unknownFields: TaggedValue | null;
  unknownCount: number;
};

export type ParsedInputStats = {
  enumNamesAccepted: number;
  // Unknown properties on envelope objects (counted, not stored).
  envelopeUnknownCount: number;
};

export type ParsedTraceInput = { contexts: ParsedContext[]; spans: ParsedSpan[]; stats: ParsedInputStats };
export type ParsedLogInput = { contexts: ParsedContext[]; logs: ParsedLogRecord[]; stats: ParsedInputStats };

export type StructureLimits = {
  maxResourceGroups: number;
  maxScopeGroups: number;
  maxSpans: number;
  maxLogRecords: number;
  maxPerObject: number;
};
export const DEFAULT_STRUCTURE_LIMITS: StructureLimits = {
  maxResourceGroups: 1024,
  maxScopeGroups: 10_000,
  maxSpans: 10_000,
  maxLogRecords: 50_000,
  maxPerObject: 1024,
};

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const U64_MAX = (1n << 64n) - 1n;
const I64_MIN = -(1n << 63n);
const I64_MAX = (1n << 63n) - 1n;
const U32_MAX = 4294967295n;

const SPAN_KIND_NAMES: Record<string, number> = {
  SPAN_KIND_UNSPECIFIED: 0, SPAN_KIND_INTERNAL: 1, SPAN_KIND_SERVER: 2,
  SPAN_KIND_CLIENT: 3, SPAN_KIND_PRODUCER: 4, SPAN_KIND_CONSUMER: 5,
};
const STATUS_CODE_NAMES: Record<string, number> = {
  STATUS_CODE_UNSET: 0, STATUS_CODE_OK: 1, STATUS_CODE_ERROR: 2,
};

const ANY_VALUE_ARMS = ["stringValue", "boolValue", "intValue", "doubleValue", "arrayValue", "kvlistValue", "bytesValue"] as const;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

class Structure {
  enumNamesAccepted = 0;
  envelopeUnknownCount = 0;
  constructor(readonly stage: string, readonly limits: StructureLimits, readonly budget: WorkBudget) {}

  fail(code: ConstructorParameters<typeof ImportError>[0]): never {
    throw new ImportError(code, this.stage);
  }

  // ---- shape helpers ----
  object(value: JsonValue | undefined): JsonObject | undefined {
    if (value === undefined || value === null) return undefined;
    if (value instanceof Map) return value;
    return this.fail("E_SYNTAX");
  }
  array(value: JsonValue | undefined, max = this.limits.maxPerObject): JsonValue[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) return this.fail("E_SYNTAX");
    if (value.length > max) this.fail("E_LIMIT");
    return value;
  }
  string(value: JsonValue | undefined): string | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== "string") return this.fail("E_SYNTAX");
    return value;
  }
  // Keeps the unknown properties of `map` as one tagged key list and counts them.
  unknown(map: JsonObject, known: readonly string[]): { tagged: TaggedValue | null; count: number } {
    const pairs: Array<[string, JsonValue]> = [];
    for (const [key, value] of map) {
      if (!known.includes(key)) pairs.push([key, value]);
    }
    if (pairs.length === 0) return { tagged: null, count: 0 };
    const tagged = this.convert(new Map(pairs), "raw");
    return { tagged, count: pairs.length };
  }
  countEnvelopeUnknown(map: JsonObject, known: readonly string[]): void {
    for (const key of map.keys()) if (!known.includes(key)) this.envelopeUnknownCount += 1;
  }

  // ---- integers (spec 1.3) ----
  integerText(value: JsonValue | undefined, min: bigint, max: bigint): string | null {
    if (value === undefined || value === null) return null;
    let text: string;
    if (typeof value === "string") {
      if (!/^-?[0-9]{1,20}$/.test(value)) return this.fail("E_NUMBER");
      text = value;
    } else if (typeof value === "object" && !Array.isArray(value) && !(value instanceof Map)) {
      const lexeme = (value as JsonNumber).lexeme;
      if (!/^-?[0-9]{1,16}$/.test(lexeme)) return this.fail("E_NUMBER");
      const n = BigInt(lexeme);
      if (n > MAX_SAFE || n < -MAX_SAFE) return this.fail("E_NUMBER");
      text = lexeme;
    } else {
      return this.fail("E_NUMBER");
    }
    const n = BigInt(text);
    if (n < min || n > max) return this.fail("E_NUMBER");
    return n.toString();
  }
  uint64(value: JsonValue | undefined): string {
    if (typeof value === "string" && value.startsWith("-")) this.fail("E_NUMBER");
    return this.integerText(value, 0n, U64_MAX) ?? "0";
  }
  uint32(value: JsonValue | undefined): number {
    if (typeof value === "string" && value.startsWith("-")) this.fail("E_NUMBER");
    return Number(this.integerText(value, 0n, U32_MAX) ?? "0");
  }

  // ---- ids (spec 1.4) ----
  hexId(value: JsonValue | undefined, length: 16 | 32): string | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string") return this.fail("E_ID");
    if (value.length !== length || !/^[0-9a-fA-F]+$/.test(value)) return this.fail("E_ID");
    return value.toLowerCase();
  }
  requiredId(value: JsonValue | undefined, length: 16 | 32): string {
    const id = this.hexId(value, length);
    if (id === null || /^0+$/.test(id)) return this.fail("E_ID");
    return id;
  }

  // ---- enums (spec 1.5) ----
  enumValue(value: JsonValue | undefined, names: Record<string, number>): number {
    if (value === undefined || value === null) return 0;
    const max = Math.max(...Object.values(names));
    if (typeof value === "string") {
      if (!Object.prototype.hasOwnProperty.call(names, value)) return this.fail("E_ENUM");
      this.enumNamesAccepted += 1;
      return names[value];
    }
    if (typeof value === "object" && !Array.isArray(value) && !(value instanceof Map)) {
      const lexeme = (value as JsonNumber).lexeme;
      if (!/^[0-9]{1,3}$/.test(lexeme)) return this.fail("E_ENUM");
      const n = Number(lexeme);
      if (n > max) return this.fail("E_ENUM");
      return n;
    }
    return this.fail("E_ENUM");
  }

  // ---- values (spec 1.6, 1.7) ----
  // Converts an OTLP AnyValue ("any") or arbitrary JSON ("raw") to a tagged value without recursion.
  convert(root: JsonValue, mode: "any" | "raw"): TaggedValue {
    type Item = { key: string | null; value: JsonValue };
    type Frame = {
      tag: "a" | "k"; items: Item[]; index: number; pendingKey: string | null;
      outA: TaggedValue[]; outK: Array<[string, TaggedValue]>;
    };
    const stack: Frame[] = [];
    let result: TaggedValue | undefined;

    const accept = (value: TaggedValue): void => {
      const top = stack[stack.length - 1];
      if (top === undefined) result = value;
      else if (top.tag === "a") top.outA.push(value);
      else top.outK.push([top.pendingKey as string, value]);
    };
    const frame = (tag: "a" | "k", items: Item[]): Frame =>
      ({ tag, items, index: 0, pendingKey: null, outA: [], outK: [] });

    const step = (value: JsonValue): TaggedValue | Frame => {
      if (mode === "raw") return this.rawStep(value, frame);
      return this.anyStep(value, frame);
    };
    const begin = (value: JsonValue): void => {
      this.budget.remaining -= 1;
      if (this.budget.remaining < 0) throw new ImportError("E_LIMIT", this.stage, null, "WORK_BUDGET");
      const r = step(value);
      if ("tag" in r && "items" in r) stack.push(r as Frame);
      else accept(r as TaggedValue);
    };

    begin(root);
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (top.index < top.items.length) {
        const item = top.items[top.index];
        top.index += 1;
        top.pendingKey = item.key;
        begin(item.value);
      } else {
        stack.pop();
        accept(top.tag === "a" ? { t: "a", v: top.outA } : { t: "k", v: top.outK });
      }
    }
    return result as TaggedValue;
  }

  private rawStep<F>(value: JsonValue, frame: (tag: "a" | "k", items: Array<{ key: string | null; value: JsonValue }>) => F): TaggedValue | F {
    if (value === null) return this.fail("E_ANYVALUE");
    if (typeof value === "boolean") return { t: "o", v: value };
    if (typeof value === "string") return { t: "s", v: value };
    if (Array.isArray(value)) return frame("a", value.map((v) => ({ key: null, value: v })));
    if (value instanceof Map) return frame("k", [...value].map(([key, v]) => ({ key, value: v })));
    const lexeme = (value as JsonNumber).lexeme;
    if (/^-?[0-9]+$/.test(lexeme)) {
      if (lexeme.replace("-", "").length > 20) return this.fail("E_NUMBER");
      return { t: "i", v: BigInt(lexeme).toString() };
    }
    // The 20-digit limit applies to every kept number, not only to integers.
    if (lexeme.split(/[eE]/)[0].replace(/[^0-9]/g, "").length > 20) return this.fail("E_NUMBER");
    const n = Number(lexeme);
    if (!Number.isFinite(n)) return this.fail("E_NUMBER");
    return { t: "d", v: n };
  }

  private anyStep<F>(value: JsonValue, frame: (tag: "a" | "k", items: Array<{ key: string | null; value: JsonValue }>) => F): TaggedValue | F {
    if (!(value instanceof Map)) return this.fail("E_ANYVALUE");
    for (const key of value.keys()) {
      if (!(ANY_VALUE_ARMS as readonly string[]).includes(key)) this.fail("E_ANYVALUE");
    }
    const present = ANY_VALUE_ARMS.filter((arm) => value.get(arm) !== undefined && value.get(arm) !== null);
    if (present.length !== 1) return this.fail("E_ANYVALUE");
    const arm = present[0];
    const inner = value.get(arm) as JsonValue;
    switch (arm) {
      case "stringValue":
        if (typeof inner !== "string") return this.fail("E_ANYVALUE");
        return { t: "s", v: inner };
      case "boolValue":
        if (typeof inner !== "boolean") return this.fail("E_ANYVALUE");
        return { t: "o", v: inner };
      case "intValue":
        return { t: "i", v: this.integerText(inner, I64_MIN, I64_MAX) as string };
      case "doubleValue": {
        if (typeof inner === "string") {
          if (inner === "NaN" || inner === "Infinity" || inner === "-Infinity") return { t: "d", v: inner };
          return this.fail("E_NUMBER");
        }
        if (typeof inner !== "object" || Array.isArray(inner) || inner instanceof Map) return this.fail("E_NUMBER");
        const n = Number((inner as JsonNumber).lexeme);
        if (!Number.isFinite(n)) return this.fail("E_NUMBER");
        return { t: "d", v: n };
      }
      case "bytesValue":
        if (typeof inner !== "string" || !BASE64.test(inner)) return this.fail("E_ANYVALUE");
        return { t: "b", v: inner };
      case "arrayValue": {
        const body = this.anyContainer(inner);
        return frame("a", body.map((v) => ({ key: null, value: v })));
      }
      default: {
        // kvlistValue
        const body = this.anyContainer(inner);
        return frame("k", body.map((kv) => {
          const { key, value: v } = this.keyValue(kv);
          return { key, value: v };
        }));
      }
    }
  }

  // arrayValue and kvlistValue are objects with only a "values" list.
  private anyContainer(inner: JsonValue): JsonValue[] {
    if (!(inner instanceof Map)) return this.fail("E_ANYVALUE");
    for (const key of inner.keys()) if (key !== "values") this.fail("E_ANYVALUE");
    const values = inner.get("values");
    if (values === undefined || values === null) return [];
    if (!Array.isArray(values)) return this.fail("E_ANYVALUE");
    return values;
  }

  private keyValue(kv: JsonValue): { key: string; value: JsonValue } {
    if (!(kv instanceof Map)) return this.fail("E_ANYVALUE");
    for (const name of kv.keys()) if (name !== "key" && name !== "value") this.fail("E_ANYVALUE");
    const key = kv.get("key");
    const value = kv.get("value");
    if (typeof key !== "string" || value === undefined || value === null) return this.fail("E_ANYVALUE");
    return { key, value };
  }

  attributes(value: JsonValue | undefined): ParsedAttribute[] {
    return this.array(value).map((kv, ordinal) => {
      const { key, value: v } = this.keyValue(kv);
      return { ordinal, key, value: this.convert(v, "any") };
    });
  }
}

const RESOURCE_KNOWN = ["attributes", "droppedAttributesCount"] as const;
const SCOPE_KNOWN = ["name", "version", "attributes", "droppedAttributesCount"] as const;

function readResource(s: Structure, group: JsonObject): ParsedResource {
  const resource = s.object(group.get("resource"));
  const unknown = resource ? s.unknown(resource, RESOURCE_KNOWN) : { tagged: null, count: 0 };
  return {
    attributes: s.attributes(resource?.get("attributes")),
    schemaUrl: s.string(group.get("schemaUrl")),
    droppedAttributesCount: s.uint32(resource?.get("droppedAttributesCount")),
    unknownFields: unknown.tagged,
    unknownCount: unknown.count,
  };
}

function readContext(s: Structure, resource: ParsedResource, scopeGroup: JsonObject): ParsedContext {
  const scope = s.object(scopeGroup.get("scope"));
  const scopeUnknown = scope ? s.unknown(scope, SCOPE_KNOWN) : { tagged: null, count: 0 };
  return {
    resource,
    scope: {
      name: s.string(scope?.get("name")),
      version: s.string(scope?.get("version")),
      attributes: s.attributes(scope?.get("attributes")),
      schemaUrl: s.string(scopeGroup.get("schemaUrl")),
      droppedAttributesCount: s.uint32(scope?.get("droppedAttributesCount")),
      unknownFields: scopeUnknown.tagged,
    },
    unknownCount: resource.unknownCount + scopeUnknown.count,
  };
}

function groups(s: Structure, request: JsonValue, outer: string, inner: string, leaf: string, onLeaf: (contextIndex: number, item: JsonValue) => void, contexts: ParsedContext[]): void {
  const root = s.object(request);
  if (!root) return s.fail("E_SYNTAX");
  s.countEnvelopeUnknown(root, [outer]);
  const resourceGroups = s.array(root.get(outer), s.limits.maxResourceGroups);
  let scopeGroupTotal = 0;
  for (const rawGroup of resourceGroups) {
    const group = s.object(rawGroup);
    if (!group) return s.fail("E_SYNTAX");
    s.countEnvelopeUnknown(group, ["resource", inner, "schemaUrl"]);
    const resource = readResource(s, group);
    const scopeGroups = s.array(group.get(inner), s.limits.maxScopeGroups);
    for (const rawScopeGroup of scopeGroups) {
      scopeGroupTotal += 1;
      if (scopeGroupTotal > s.limits.maxScopeGroups) s.fail("E_LIMIT");
      const scopeGroup = s.object(rawScopeGroup);
      if (!scopeGroup) return s.fail("E_SYNTAX");
      s.countEnvelopeUnknown(scopeGroup, ["scope", leaf, "schemaUrl"]);
      const contextIndex = contexts.length;
      contexts.push(readContext(s, resource, scopeGroup));
      const maxLeaves = leaf === "spans" ? s.limits.maxSpans : s.limits.maxLogRecords;
      for (const item of s.array(scopeGroup.get(leaf), maxLeaves)) onLeaf(contextIndex, item);
    }
  }
}

const SPAN_KNOWN = [
  "traceId", "spanId", "traceState", "parentSpanId", "flags", "name", "kind", "startTimeUnixNano", "endTimeUnixNano",
  "attributes", "droppedAttributesCount", "events", "droppedEventsCount", "links", "droppedLinksCount", "status",
] as const;
const EVENT_KNOWN = ["timeUnixNano", "name", "attributes", "droppedAttributesCount"] as const;
const LINK_KNOWN = ["traceId", "spanId", "traceState", "attributes", "droppedAttributesCount", "flags"] as const;
const STATUS_KNOWN = ["code", "message"] as const;
const LOG_KNOWN = [
  "timeUnixNano", "observedTimeUnixNano", "severityNumber", "severityText", "body", "attributes",
  "droppedAttributesCount", "flags", "traceId", "spanId", "eventName",
] as const;

function attributesAsTagged(attributes: ParsedAttribute[]): TaggedValue {
  return {
    t: "a",
    v: attributes.map((a): TaggedValue => ({ t: "k", v: [["key", { t: "s", v: a.key }], ["value", a.value]] })),
  };
}

function readSpan(s: Structure, contextIndex: number, raw: JsonValue): ParsedSpan {
  const span = s.object(raw);
  if (!span) return s.fail("E_SYNTAX");
  const start = s.uint64(span.get("startTimeUnixNano"));
  if (start === "0") s.fail("E_NUMBER");
  const endRaw = span.get("endTimeUnixNano");
  const status = s.object(span.get("status"));
  const statusUnknown = status ? s.unknown(status, STATUS_KNOWN) : { tagged: null, count: 0 };
  const unknown = s.unknown(span, SPAN_KNOWN);
  let unknownCount = unknown.count + statusUnknown.count;

  const events = s.array(span.get("events")).map((rawEvent, ordinal): ParsedSpanEvent => {
    const event = s.object(rawEvent);
    if (!event) return s.fail("E_SYNTAX");
    const eventUnknown = s.unknown(event, EVENT_KNOWN);
    unknownCount += eventUnknown.count;
    return {
      ordinal,
      timeNs: s.uint64(event.get("timeUnixNano")),
      name: s.string(event.get("name")) ?? "",
      attributes: s.attributes(event.get("attributes")),
      droppedAttributesCount: s.uint32(event.get("droppedAttributesCount")),
      unknownFields: eventUnknown.tagged,
    };
  });

  const links = s.array(span.get("links")).map((rawLink): TaggedValue => {
    const link = s.object(rawLink);
    if (!link) return s.fail("E_SYNTAX");
    const linkUnknown = s.unknown(link, LINK_KNOWN);
    unknownCount += linkUnknown.count;
    const linkTrace = s.hexId(link.get("traceId"), 32);
    const linkSpan = s.hexId(link.get("spanId"), 16);
    if ((linkTrace !== null && /^0+$/.test(linkTrace)) || (linkSpan !== null && /^0+$/.test(linkSpan))) s.fail("E_ID");
    const pairs: Array<[string, TaggedValue]> = [
      ["traceId", { t: "s", v: linkTrace ?? "" }],
      ["spanId", { t: "s", v: linkSpan ?? "" }],
      ["traceState", { t: "s", v: s.string(link.get("traceState")) ?? "" }],
      ["flags", { t: "i", v: String(s.uint32(link.get("flags"))) }],
      ["droppedAttributesCount", { t: "i", v: String(s.uint32(link.get("droppedAttributesCount"))) }],
      ["attributes", attributesAsTagged(s.attributes(link.get("attributes")))],
    ];
    if (linkUnknown.tagged !== null) pairs.push(["unknownFields", linkUnknown.tagged]);
    return { t: "k", v: pairs };
  });

  // Unknown span properties and unknown status properties share one tagged list ("status" is a known
  // span property, so the key cannot clash).
  const unknownPairs: Array<[string, TaggedValue]> = unknown.tagged !== null && unknown.tagged.t === "k" ? [...unknown.tagged.v] : [];
  if (statusUnknown.tagged !== null) unknownPairs.push(["status", statusUnknown.tagged]);

  const parent = s.hexId(span.get("parentSpanId"), 16);
  return {
    contextIndex,
    traceId: s.requiredId(span.get("traceId"), 32),
    spanId: s.requiredId(span.get("spanId"), 16),
    parentSpanId: parent === null || /^0+$/.test(parent) ? null : parent,
    traceState: s.string(span.get("traceState")) ?? "",
    flags: s.uint32(span.get("flags")),
    name: s.string(span.get("name")) ?? "",
    kind: s.enumValue(span.get("kind"), SPAN_KIND_NAMES),
    startNs: start,
    endNs: endRaw === undefined || endRaw === null ? null : s.uint64(endRaw),
    attributes: s.attributes(span.get("attributes")),
    droppedAttributesCount: s.uint32(span.get("droppedAttributesCount")),
    events,
    droppedEventsCount: s.uint32(span.get("droppedEventsCount")),
    links,
    droppedLinksCount: s.uint32(span.get("droppedLinksCount")),
    statusCode: s.enumValue(status?.get("code"), STATUS_CODE_NAMES),
    statusMessage: s.string(status?.get("message")) ?? "",
    unknownFields: unknownPairs.length === 0 ? null : { t: "k", v: unknownPairs },
    unknownCount,
  };
}

function readLog(s: Structure, contextIndex: number, raw: JsonValue): ParsedLogRecord {
  const log = s.object(raw);
  if (!log) return s.fail("E_SYNTAX");
  const unknown = s.unknown(log, LOG_KNOWN);
  const traceId = s.hexId(log.get("traceId"), 32);
  const spanId = s.hexId(log.get("spanId"), 16);
  if ((traceId !== null && /^0+$/.test(traceId)) || (spanId !== null && /^0+$/.test(spanId))) s.fail("E_ID");
  const severity = s.integerText(log.get("severityNumber"), 0n, 24n);
  const body = log.get("body");
  return {
    contextIndex,
    traceId,
    spanId,
    timeNs: s.uint64(log.get("timeUnixNano")),
    observedTimeNs: s.uint64(log.get("observedTimeUnixNano")),
    severityNumber: severity === null ? 0 : Number(severity),
    severityText: s.string(log.get("severityText")) ?? "",
    flags: s.uint32(log.get("flags")),
    eventName: s.string(log.get("eventName")) ?? "",
    droppedAttributesCount: s.uint32(log.get("droppedAttributesCount")),
    // An empty AnyValue ({}) on a log body is protobuf's "unset"; real instrumentation writes it. Spec 1.6 deviation.
    body: body === undefined || body === null || (body instanceof Map && body.size === 0) ? null : s.convert(body, "any"),
    attributes: s.attributes(log.get("attributes")),
    unknownFields: unknown.tagged,
    unknownCount: unknown.count,
  };
}

export function parseTraceRequest(
  json: JsonValue, stage = "structure", limits: StructureLimits = DEFAULT_STRUCTURE_LIMITS,
  budget: WorkBudget = { remaining: DEFAULT_WORK_UNITS },
): ParsedTraceInput {
  const s = new Structure(stage, limits, budget);
  const contexts: ParsedContext[] = [];
  const spans: ParsedSpan[] = [];
  groups(s, json, "resourceSpans", "scopeSpans", "spans", (contextIndex, item) => {
    if (spans.length >= limits.maxSpans) s.fail("E_LIMIT");
    spans.push(readSpan(s, contextIndex, item));
  }, contexts);
  return { contexts, spans, stats: { enumNamesAccepted: s.enumNamesAccepted, envelopeUnknownCount: s.envelopeUnknownCount } };
}

export function parseLogsRequest(
  json: JsonValue, stage = "structure", limits: StructureLimits = DEFAULT_STRUCTURE_LIMITS,
  budget: WorkBudget = { remaining: DEFAULT_WORK_UNITS },
): ParsedLogInput {
  const s = new Structure(stage, limits, budget);
  const contexts: ParsedContext[] = [];
  const logs: ParsedLogRecord[] = [];
  groups(s, json, "resourceLogs", "scopeLogs", "logRecords", (contextIndex, item) => {
    if (logs.length >= limits.maxLogRecords) s.fail("E_LIMIT");
    logs.push(readLog(s, contextIndex, item));
  }, contexts);
  return { contexts, logs, stats: { enumNamesAccepted: s.enumNamesAccepted, envelopeUnknownCount: s.envelopeUnknownCount } };
}
