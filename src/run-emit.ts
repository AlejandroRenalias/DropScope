// Phase 7 of the import (spec sections 4 to 8): classify every retained value as structural or content,
// apply the privacy mode, order the events, and emit the run-event list. Output is validated against the
// event schemas before it is returned.
//
// Decisions that fill gaps in the spec (raise with the user):
// - A log record body is recorded as ContentRecorded with field `gen_ai.other`, fieldKey "log.body" and
//   ordinal 0; log attributes moved to ContentRecorded use ordinal = attribute ordinal + 1, so ordinal 0
//   on the LOG_RECORD channel is always the body.
// - WITHHELD_ATTRIBUTE counts attribute entries that have at least one withheld part; bytes sums the
//   byte lengths of the withheld parts.
// - SCHEMA_URL_* look at the scope schema URL, else the resource schema URL, against
//   https://opentelemetry.io/schemas/<conventionVersion>.
import { canonicalJson, compareUtf8, sha256Hex } from "./canonical.js";
import type { ImportNoteDraft, NormalLog, NormalSpan, NormalizedRun } from "./trace-normalize.js";
import type { ParsedAttribute, ParsedContext } from "./otlp-structure.js";
import { ImportError } from "./run-import-error.js";
import { ALLOWLIST, KNOWN_CONTENT_KEYS, SCHEMA_URL, SCOPE_NAME, SCOPE_VERSION, deriveLabel } from "./run-privacy.js";
import {
  runEventListSchema, RUN_EVENT_SCHEMA_VERSION,
  type ContentMode, type Field, type RunEvent, type StepKind, type TaggedValue,
} from "./run-events.js";

export const IMPORTER = { id: "dropscope-otlp-json", version: "4" } as const;
export const DEFAULT_CONVENTION_VERSION = "1.37.0";
export const LIMITS_VERSION = "1-provisional";
export const MAX_OUTPUT_EVENTS = 1_000_000;
export const MAX_RUN_LOG_BYTES = 128 * 1024 * 1024;
const MAX_SCAN_CHARS = 65_536;

export type EmitInput = { role: "spans" | "logs"; byteLength: number; sha256: string; enumNamesAccepted: number };
// Upper bound of what the persisted line adds to an event's own serialization: the run id, schema version and
// sequence number fields (86 bytes at most, up to 1,000,000 events) and the line feed, rounded up.
export const EVENT_ENVELOPE_BYTES = 96;
const CONTEXT_OVERHEAD_BYTES = 80;

export type EmitOptions = {
  contentMode: ContentMode;
  // Test hook; defaults to the 128 MiB limit of spec section 10.
  maxOutputBytes?: number;
  inputs: EmitInput[];
  envelopeUnknownCount?: number;
  conventionVersion?: string;
};

const KIND_OF_OPERATION = new Map<string, StepKind>([
  ["chat", "LLM_CALL"], ["text_completion", "LLM_CALL"], ["generate_content", "LLM_CALL"], ["embeddings", "LLM_CALL"],
  ["execute_tool", "TOOL_CALL"], ["invoke_agent", "AGENT"], ["create_agent", "AGENT"],
]);

// ---- secret and personal-data scanner (spec 6.6): bounded patterns, counts only ----
const SCANNERS: Array<[string, RegExp]> = [
  ["awsAccessKey", /AKIA[0-9A-Z]{16}/g],
  ["githubToken", /gh[pousr]_[A-Za-z0-9]{36,255}/g],
  ["openAiKey", /sk-[A-Za-z0-9_-]{20,255}/g],
  ["bearerToken", /[Bb]earer [A-Za-z0-9._~+/-]{20,512}/g],
  ["jwt", /eyJ[A-Za-z0-9_-]{10,2048}\.[A-Za-z0-9_-]{10,2048}\.[A-Za-z0-9_-]{10,2048}/g],
  ["privateKeyBlock", /-----BEGIN [A-Z ]{0,32}PRIVATE KEY-----/g],
  ["email", /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,8}\.[A-Za-z]{2,24}/g],
];

const tagStr = (s: string): TaggedValue => ({ t: "s", v: s });
const compareString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

type ContentDraft = { field: string; fieldKey?: Field; ordinal: number; value: Field };

class Emitter {
  readonly scanCounts = new Map<string, number>();
  withheldBytes = 0;
  withheldParts = 0;
  constructor(readonly mode: ContentMode) {}

  // Content is scanned, then withheld unless the mode is FULL. Structural values are always verbatim.
  field(value: TaggedValue, structural: boolean): Field {
    if (structural) return { v: value };
    this.scan(value);
    if (this.mode === "FULL") return { v: value };
    const serialized = canonicalJson(value);
    const n = Buffer.byteLength(serialized, "utf8");
    this.withheldBytes += n;
    this.withheldParts += 1;
    return { w: { n, h: sha256Hex(serialized) } };
  }

  private scan(root: TaggedValue): void {
    const stack: TaggedValue[] = [root];
    while (stack.length > 0) {
      const value = stack.pop() as TaggedValue;
      if (value.t === "s") this.scanString(value.v);
      else if (value.t === "a") for (const e of value.v) stack.push(e);
      else if (value.t === "k") for (const [k, e] of value.v) { this.scanString(k); stack.push(e); }
    }
  }
  private scanString(text: string): void {
    const capped = text.length > MAX_SCAN_CHARS ? text.slice(0, MAX_SCAN_CHARS) : text;
    for (const [name, pattern] of SCANNERS) {
      pattern.lastIndex = 0;
      let count = 0;
      while (pattern.exec(capped) !== null) count += 1;
      if (count > 0) this.scanCounts.set(name, (this.scanCounts.get(name) ?? 0) + count);
    }
  }

  // Each entry reports how many of its parts were withheld and their byte lengths (attributes only).
  attributeList(attrs: ParsedAttribute[], allowlisted: boolean) {
    return attrs.map((a) => {
      const check = allowlisted ? ALLOWLIST.get(a.key) : undefined;
      const partsBefore = this.withheldParts;
      const bytesBefore = this.withheldBytes;
      const key = this.field(tagStr(a.key), check !== undefined);
      const value = this.field(a.value, check !== undefined && check(a.value));
      return { entry: { ordinal: a.ordinal, key, value }, withheld: this.withheldParts - partsBefore, bytes: this.withheldBytes - bytesBefore };
    });
  }
}

function attr(attrs: ParsedAttribute[], key: string): TaggedValue | undefined {
  return attrs.find((a) => a.key === key)?.value;
}

function usageValue(attrs: ParsedAttribute[], key: string): { value: string | null; unusable: boolean } {
  const values = attrs.filter((a) => a.key === key).map((a) => a.value);
  if (values.length === 0) return { value: null, unusable: false };
  const texts = new Set<string>();
  for (const v of values) {
    if (v.t !== "i" || !/^[0-9]{1,16}$/.test(v.v) || BigInt(v.v) > BigInt(Number.MAX_SAFE_INTEGER)) {
      return { value: null, unusable: true };
    }
    texts.add(BigInt(v.v).toString());
  }
  return texts.size === 1 ? { value: [...texts][0], unusable: false } : { value: null, unusable: true };
}

type Draft = Omit<RunEvent, "sequenceNumber" | "runId" | "schemaVersion">;

export function emitRunEvents(run: NormalizedRun, options: EmitOptions): RunEvent[] {
  const em = new Emitter(options.contentMode);
  const conventionVersion = options.conventionVersion ?? DEFAULT_CONVENTION_VERSION;
  const notes: ImportNoteDraft[] = [...run.notes];

  // Output budget (spec section 10): events and bytes are counted as they are made, so an input that would
  // produce too much output fails before the output is built, not after.
  let producedEvents = 0;
  let producedBytes = 0;
  const maxBytes = options.maxOutputBytes ?? MAX_RUN_LOG_BYTES;
  const accountBytes = (bytes: number): void => {
    producedBytes += bytes;
    if (producedBytes > maxBytes) throw new ImportError("E_LIMIT", "emit", null, "OUTPUT_BYTES");
  };
  // Counts a complete persisted line (the event, its envelope and the line feed), never less than the truth.
  const account = (value: unknown): void => {
    accountBytes(Buffer.byteLength(canonicalJson(value), "utf8") + EVENT_ENVELOPE_BYTES);
  };
  const make = (draft: Draft, countBytes = true): Draft => {
    producedEvents += 1;
    if (producedEvents > MAX_OUTPUT_EVENTS) throw new ImportError("E_LIMIT", "emit", null, "OUTPUT_EVENTS");
    if (countBytes) account(draft);
    return draft;
  };
  const addNote = (code: ImportNoteDraft["code"], stepId: string | null, detail: Record<string, number | string> = {}) =>
    notes.push({ code, stepId, detail });

  // Contexts. A resource is shared by every scope under it: its payload is built, scanned, hashed and
  // measured once, and the same object is used in every context that has it.
  // The cache is keyed by the resource's content hash, not by object identity, so what is scanned and counted
  // (secret patterns, withheld bytes) depends only on the distinct resource contents, never on which input
  // object happened to be shared or came first.
  const resourceCache = new Map<string, { payload: unknown; bytes: number }>();
  const resourceOf = (resource: ParsedContext["resource"], resourceKey: string) => {
    const cached = resourceCache.get(resourceKey);
    if (cached !== undefined) return cached;
    const payload = {
      attributes: em.attributeList(resource.attributes, false).map((x) => x.entry),
      schemaUrl: em.field(tagStr(resource.schemaUrl ?? ""), resource.schemaUrl === null || SCHEMA_URL.test(resource.schemaUrl)),
      droppedAttributesCount: resource.droppedAttributesCount,
      unknownFields: resource.unknownFields === null ? null : em.field(resource.unknownFields, false),
    };
    const entry = { payload, bytes: Buffer.byteLength(canonicalJson(payload), "utf8") };
    resourceCache.set(resourceKey, entry);
    return entry;
  };
  const contextPayloads = run.contexts.map(({ contextId, context, resourceKey }) => {
    const resource = resourceOf(context.resource, resourceKey);
    const scopeAttributes = em.attributeList(context.scope.attributes, true).map((x) => x.entry);
    const schemaOf = (url: string | null) => em.field(tagStr(url ?? ""), url === null || SCHEMA_URL.test(url));
    const payload = {
      contextId,
      resource: resource.payload,
      scope: {
        name: em.field(tagStr(context.scope.name ?? ""), context.scope.name === null || SCOPE_NAME.test(context.scope.name)),
        version: em.field(tagStr(context.scope.version ?? ""), context.scope.version === null || SCOPE_VERSION.test(context.scope.version)),
        attributes: scopeAttributes,
        schemaUrl: schemaOf(context.scope.schemaUrl),
        droppedAttributesCount: context.scope.droppedAttributesCount,
        unknownFields: context.scope.unknownFields === null ? null : em.field(context.scope.unknownFields, false),
      },
    };
    // The context's own bytes plus the shared resource's bytes, without serializing the resource again.
    accountBytes(Buffer.byteLength(canonicalJson(payload.scope), "utf8") + resource.bytes + CONTEXT_OVERHEAD_BYTES);
    if (context.unknownCount > 0) addNote("UNKNOWN_FIELD", null, { contextId, count: context.unknownCount });
    const effective = context.scope.schemaUrl ?? context.resource.schemaUrl;
    if (effective === null) addNote("SCHEMA_URL_ABSENT", null, { contextId });
    else if (effective !== `https://opentelemetry.io/schemas/${conventionVersion}`) addNote("SCHEMA_URL_MISMATCH", null, { contextId });
    return payload;
  });

  // Log order (spec 4.5).
  const logTime = (l: NormalLog): bigint | null =>
    l.timeNs !== "0" ? BigInt(l.timeNs) : l.observedTimeNs !== "0" ? BigInt(l.observedTimeNs) : null;
  const orderedLogs = [...run.logs].sort((a, b) => {
    const ta = logTime(a);
    const tb = logTime(b);
    if (ta === null && tb !== null) return 1;
    if (ta !== null && tb === null) return -1;
    if (ta !== null && tb !== null && ta !== tb) return ta < tb ? -1 : 1;
    return compareUtf8(a.canonical, b.canonical);
  });

  const contentOf = (drafts: ContentDraft[]) =>
    [...drafts].sort((a, b) => compareString(a.field, b.field) || a.ordinal - b.ordinal);

  // Logs: attributes split, body and moved attributes become content.
  type LogBundle = { ordinal: number; log: NormalLog; logEvent: Draft; contents: ContentDraft[] };
  const logBundles: LogBundle[] = orderedLogs.map((log, ordinal) => {
    const kept: ParsedAttribute[] = [];
    const contents: ContentDraft[] = [];
    if (log.body !== null) {
      contents.push({ field: "gen_ai.other", fieldKey: { v: tagStr("log.body") }, ordinal: 0, value: em.field(log.body, false) });
    }
    for (const a of log.attributes) {
      if (ALLOWLIST.has(a.key)) kept.push(a);
      else if (KNOWN_CONTENT_KEYS.has(a.key)) contents.push({ field: a.key, ordinal: a.ordinal + 1, value: em.field(a.value, false) });
      else contents.push({ field: "gen_ai.other", fieldKey: em.field(tagStr(a.key), false), ordinal: a.ordinal + 1, value: em.field(a.value, false) });
    }
    const usageAttrs = log.attributes.filter((a) => a.key === "gen_ai.usage.input_tokens" || a.key === "gen_ai.usage.output_tokens").length;
    if (usageAttrs > 0) addNote("USAGE_NOT_SUMMED", log.stepId, { count: usageAttrs, scope: "log" });
    if (log.unknownCount > 0) addNote("UNKNOWN_FIELD", null, { logOrdinal: ordinal, count: log.unknownCount });
    if (log.stepId === null) addNote("ORPHAN_LOG_RECORD", null, { logOrdinal: ordinal });
    const attributes = em.attributeList(kept, true).map((x) => x.entry);
    const logEvent: Draft = {
      type: "LogRecorded",
      payload: {
        logOrdinal: ordinal, stepId: log.stepId, contextId: log.contextId, timeNs: log.timeNs, observedTimeNs: log.observedTimeNs,
        severityNumber: log.severityNumber, severityText: em.field(tagStr(log.severityText), false), flags: log.flags,
        eventName: em.field(tagStr(log.eventName), false), droppedAttributesCount: log.droppedAttributesCount, attributes,
        unknownFields: log.unknownFields === null ? null : em.field(log.unknownFields, false),
      },
    } as Draft;
    make(logEvent);
    return { ordinal, log, logEvent, contents: contentOf(contents) };
  });
  const logsOfStep = new Map<string, LogBundle[]>();
  for (const bundle of logBundles) {
    if (bundle.log.stepId === null) continue;
    const list = logsOfStep.get(bundle.log.stepId) ?? [];
    list.push(bundle);
    logsOfStep.set(bundle.log.stepId, list);
  }
  const logContentEvents = (bundle: LogBundle): Draft[] =>
    bundle.contents.map((c) => make({
      type: "ContentRecorded",
      payload: { stepId: null, logOrdinal: bundle.ordinal, channel: "LOG_RECORD", field: c.field, ...(c.fieldKey ? { fieldKey: c.fieldKey } : {}), ordinal: c.ordinal, value: c.value },
    } as Draft));

  // Spans.
  type StepBundle = { span: NormalSpan; start: Draft; end: Draft; tail: Draft[] };
  const steps = new Map<string, StepBundle>();
  for (const span of run.spans) {
    const operation = attr(span.attributes, "gen_ai.operation.name");
    const operationText = operation !== undefined && operation.t === "s" ? operation.v : null;
    const kind: StepKind = operationText !== null ? (KIND_OF_OPERATION.get(operationText) ?? "OTHER") : "OTHER";
    if (operation !== undefined && !(operationText !== null && KIND_OF_OPERATION.has(operationText))) addNote("UNRECOGNIZED_OPERATION", span.spanId);
    if (span.unknownCount > 0) addNote("UNKNOWN_FIELD", span.spanId, { count: span.unknownCount });

    // Label from structural data only (spec 6.4).
    const model = attr(span.attributes, "gen_ai.request.model") ?? attr(span.attributes, "gen_ai.response.model");
    const label = deriveLabel(kind, operation, model);

    // Split attributes: content names and other gen_ai.* leave the attribute list (spec 5).
    const kept: ParsedAttribute[] = [];
    const contents: ContentDraft[] = [];
    for (const a of span.attributes) {
      if (KNOWN_CONTENT_KEYS.has(a.key)) contents.push({ field: a.key, ordinal: a.ordinal, value: em.field(a.value, false) });
      else if (a.key.startsWith("gen_ai.") && !ALLOWLIST.has(a.key)) {
        contents.push({ field: "gen_ai.other", fieldKey: em.field(tagStr(a.key), false), ordinal: a.ordinal, value: em.field(a.value, false) });
      } else kept.push(a);
    }

    const attributeResults = em.attributeList(kept, true);
    const eventResults = span.events.map((e) => ({
      ordinal: e.ordinal, timeNs: e.timeNs, name: em.field(tagStr(e.name), false),
      attributes: em.attributeList(e.attributes, true), droppedAttributesCount: e.droppedAttributesCount,
      unknownFields: e.unknownFields === null ? null : em.field(e.unknownFields, false),
    }));
    // Counts only attribute keys and values; names, status messages and other fields are not attributes.
    const withheldLists = [attributeResults, ...eventResults.map((e) => e.attributes)];
    const withheldEntries = withheldLists.reduce((n, list) => n + list.filter((x) => x.withheld > 0).length, 0);
    const withheldBytes = withheldLists.reduce((n, list) => n + list.reduce((m, x) => m + x.bytes, 0), 0);
    if (options.contentMode === "HASH_ONLY" && withheldEntries > 0) {
      addNote("WITHHELD_ATTRIBUTE", span.spanId, { count: withheldEntries, bytes: withheldBytes });
    }

    const start: Draft = {
      type: "StepStarted",
      payload: {
        stepId: span.spanId, parentStepId: span.parentStepId, contextId: span.contextId, kind,
        operationName: operation === undefined ? null : em.field(operation, ALLOWLIST.get("gen_ai.operation.name")?.(operation) === true),
        name: em.field(tagStr(span.name), false), label, otlpKind: span.kind, startNs: span.startNs,
        traceState: em.field(tagStr(span.traceState), false), flags: span.flags,
        droppedAttributesCount: span.droppedAttributesCount, droppedEventsCount: span.droppedEventsCount, droppedLinksCount: span.droppedLinksCount,
        attributes: attributeResults.map((x) => x.entry), links: span.links.map((l) => em.field(l, false)),
        unknownFields: span.unknownFields === null ? null : em.field(span.unknownFields, false),
      },
    } as Draft;
    make(start);
    const end: Draft = {
      type: "StepEnded",
      payload: {
        stepId: span.spanId, endNs: span.endNs, endEffectiveNs: span.endEffectiveNs, statusCode: span.statusCode,
        statusMessage: em.field(tagStr(span.statusMessage), false),
        events: eventResults.map((e) => ({ ...e, attributes: e.attributes.map((x) => x.entry) })),
      },
    } as Draft;
    make(end);

    // Usage (spec 8.1): LLM_CALL spans only.
    const tail: Draft[] = [];
    const usageAttrCount = span.attributes.filter((a) => a.key === "gen_ai.usage.input_tokens" || a.key === "gen_ai.usage.output_tokens").length;
    if (kind === "LLM_CALL") {
      const input = usageValue(span.attributes, "gen_ai.usage.input_tokens");
      const output = usageValue(span.attributes, "gen_ai.usage.output_tokens");
      const unusable = Number(input.unusable) + Number(output.unusable);
      if (unusable > 0) addNote("UNUSABLE_USAGE", span.spanId, { count: unusable });
      if (input.value !== null || output.value !== null) {
        tail.push(make({ type: "UsageRecorded", payload: { stepId: span.spanId, inputTokens: input.value, outputTokens: output.value } } as Draft));
      }
    } else if (usageAttrCount > 0) {
      addNote("USAGE_NOT_SUMMED", span.spanId, { count: usageAttrCount, scope: "span" });
    }

    const ordered = contentOf(contents);
    for (const c of ordered) {
      tail.push(make({
        type: "ContentRecorded",
        payload: { stepId: span.spanId, logOrdinal: null, channel: "SPAN_ATTRIBUTE", field: c.field, ...(c.fieldKey ? { fieldKey: c.fieldKey } : {}), ordinal: c.ordinal, value: c.value },
      } as Draft));
    }
    let contentCount = ordered.length;
    for (const bundle of logsOfStep.get(span.spanId) ?? []) {
      tail.push(bundle.logEvent);
      for (const e of logContentEvents(bundle)) tail.push(e);
      contentCount += bundle.contents.length;
    }
    if ((kind === "LLM_CALL" || kind === "TOOL_CALL") && contentCount === 0) addNote("CONTENT_ABSENT", span.spanId);
    steps.set(span.spanId, { span, start, end, tail });
  }

  // Order step events (spec 4.3).
  type Slot = { time: bigint; cls: number; depthKey: number; spanId: string; isStart: boolean };
  const slots: Slot[] = [];
  for (const { span } of steps.values()) {
    const zero = span.endEffectiveNs === span.startNs;
    slots.push({ time: BigInt(span.startNs), cls: 1, depthKey: span.depth, spanId: span.spanId, isStart: true });
    slots.push({ time: BigInt(span.endEffectiveNs), cls: zero ? 2 : 0, depthKey: -span.depth, spanId: span.spanId, isStart: false });
  }
  slots.sort((a, b) => (a.time === b.time ? 0 : a.time < b.time ? -1 : 1) || a.cls - b.cls || a.depthKey - b.depthKey || compareString(a.spanId, b.spanId));

  const body: Draft[] = [];
  for (const slot of slots) {
    const bundle = steps.get(slot.spanId) as StepBundle;
    if (slot.isStart) {
      body.push(bundle.start);
    } else {
      body.push(bundle.end);
      for (const e of bundle.tail) body.push(e);
    }
  }
  for (const bundle of logBundles) {
    if (bundle.log.stepId !== null) continue;
    body.push(bundle.logEvent);
    for (const e of logContentEvents(bundle)) body.push(e);
  }

  // Notes that need whole-run knowledge.
  for (const input of options.inputs) {
    if (input.enumNamesAccepted > 0) addNote("ENUM_NAME_ACCEPTED", null, { role: input.role, count: input.enumNamesAccepted });
  }
  if ((options.envelopeUnknownCount ?? 0) > 0) addNote("UNKNOWN_FIELD", null, { count: options.envelopeUnknownCount as number, scope: "envelope" });
  if (em.scanCounts.size > 0) {
    addNote("SECRET_PATTERN_COUNT", null, Object.fromEntries([...em.scanCounts.entries()].sort(([a], [b]) => compareString(a, b))));
  }

  // Notes: identical notes never repeat; order by (code, step id, detail).
  const unique = new Map<string, ImportNoteDraft>();
  for (const note of notes) unique.set(canonicalJson(note), note);
  const noteEvents: Draft[] = [...unique.values()]
    .sort((a, b) => compareString(a.code, b.code) || compareString(a.stepId ?? "", b.stepId ?? "") || compareString(canonicalJson(a.detail), canonicalJson(b.detail)))
    .map((n) => make({ type: "ImportNote", payload: { code: n.code, stepId: n.stepId, detail: n.detail } } as Draft));

  const artifactId = sha256Hex(canonicalJson({
    traceId: run.traceId,
    inputs: [...options.inputs].sort((a, b) => compareString(a.role, b.role)).map((i) => ({ role: i.role, sha256: i.sha256 })),
    contentMode: options.contentMode, importer: IMPORTER, limitsVersion: LIMITS_VERSION, conventionVersion,
    schemaVersion: RUN_EVENT_SCHEMA_VERSION,
  }));
  const started: Draft = {
    type: "RunStarted",
    payload: {
      traceId: run.traceId, derivedOrder: true, importer: { ...IMPORTER }, conventionVersion, contentMode: options.contentMode,
      selectedTrace: run.selectedTrace,
      inputs: [...options.inputs].sort((a, b) => compareString(a.role, b.role)).map((i) => ({ role: i.role, byteLength: i.byteLength, sha256: i.sha256 })),
      limitsVersion: LIMITS_VERSION, artifactId, contexts: contextPayloads,
    },
  } as Draft;
  // The header's contexts were accounted one by one; count its remaining fields here.
  account({ type: "RunStarted", payload: { ...(started as { payload: object }).payload, contexts: [] } });
  make(started, false);

  const drafts: Draft[] = [started];
  for (const d of body) drafts.push(d);
  for (const d of noteEvents) drafts.push(d);
  drafts.push(make({ type: "RunEnded", payload: { eventCount: drafts.length + 1 } } as Draft));

  const events = drafts.map((d, i) => ({ schemaVersion: RUN_EVENT_SCHEMA_VERSION, sequenceNumber: i + 1, runId: run.traceId, ...d }));
  const checked = runEventListSchema.safeParse(events);
  if (!checked.success) throw new ImportError("E_INVALID_LOG", "emit");
  return checked.data;
}
