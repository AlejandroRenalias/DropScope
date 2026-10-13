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
import type { ParsedAttribute } from "./otlp-structure.js";
import { ImportError } from "./run-import-error.js";
import {
  runEventListSchema, RUN_EVENT_SCHEMA_VERSION,
  type ContentMode, type Field, type RunEvent, type StepKind, type TaggedValue,
} from "./run-events.js";

export const IMPORTER = { id: "dropscope-otlp-json", version: "1" } as const;
export const DEFAULT_CONVENTION_VERSION = "1.37.0";
export const LIMITS_VERSION = "1-provisional";
export const MAX_OUTPUT_EVENTS = 1_000_000;
const MAX_SCAN_CHARS = 65_536;

export type EmitInput = { role: "spans" | "logs"; byteLength: number; sha256: string; enumNamesAccepted: number };
export type EmitOptions = {
  contentMode: ContentMode;
  inputs: EmitInput[];
  envelopeUnknownCount?: number;
  conventionVersion?: string;
};

// ---- privacy: allowlist (spec 6.2) ----
type Check = (value: TaggedValue) => boolean;
const str = (pattern: RegExp): Check => (v) => v.t === "s" && pattern.test(v.v);
const uint = (max?: bigint): Check => (v) =>
  v.t === "i" && /^[0-9]{1,20}$/.test(v.v) && (max === undefined || BigInt(v.v) <= max);
const strArray = (pattern: RegExp): Check => (v) => v.t === "a" && v.v.every((e) => e.t === "s" && pattern.test(e.v));

const ALLOWLIST = new Map<string, Check>([
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
const SCOPE_NAME = /^[a-z0-9._-]{1,128}$/;
const SCOPE_VERSION = /^[0-9A-Za-z.+-]{1,64}$/;
const SCHEMA_URL = /^https:\/\/opentelemetry\.io\/schemas\/[0-9.]{1,32}$/;

const KNOWN_CONTENT_KEYS = new Set([
  "gen_ai.input.messages", "gen_ai.output.messages", "gen_ai.system_instructions",
  "gen_ai.tool.call.arguments", "gen_ai.tool.call.result",
]);

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

  attributeList(attrs: ParsedAttribute[], allowlisted: boolean) {
    return attrs.map((a) => {
      const check = allowlisted ? ALLOWLIST.get(a.key) : undefined;
      const before = this.withheldParts;
      const key = this.field(tagStr(a.key), check !== undefined);
      const value = this.field(a.value, check !== undefined && check(a.value));
      return { entry: { ordinal: a.ordinal, key, value }, withheld: this.withheldParts - before };
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
  const addNote = (code: ImportNoteDraft["code"], stepId: string | null, detail: Record<string, number | string> = {}) =>
    notes.push({ code, stepId, detail });

  // Contexts.
  const contextPayloads = run.contexts.map(({ contextId, context }) => {
    const resourceAttributes = em.attributeList(context.resource.attributes, false).map((x) => x.entry);
    const scopeAttributes = em.attributeList(context.scope.attributes, true).map((x) => x.entry);
    const schemaOf = (url: string | null) => em.field(tagStr(url ?? ""), url === null || SCHEMA_URL.test(url));
    const payload = {
      contextId,
      resource: { attributes: resourceAttributes, schemaUrl: schemaOf(context.resource.schemaUrl) },
      scope: {
        name: em.field(tagStr(context.scope.name ?? ""), context.scope.name === null || SCOPE_NAME.test(context.scope.name)),
        version: em.field(tagStr(context.scope.version ?? ""), context.scope.version === null || SCOPE_VERSION.test(context.scope.version)),
        attributes: scopeAttributes,
        schemaUrl: schemaOf(context.scope.schemaUrl),
      },
    };
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
      },
    } as Draft;
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
    bundle.contents.map((c) => ({
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
    const parts: string[] = [kind];
    if (operation !== undefined && ALLOWLIST.get("gen_ai.operation.name")?.(operation)) parts.push((operation as { v: string }).v);
    const model = attr(span.attributes, "gen_ai.request.model") ?? attr(span.attributes, "gen_ai.response.model");
    if (model !== undefined && ALLOWLIST.get("gen_ai.request.model")?.(model)) parts.push((model as { v: string }).v);

    // Split attributes: content names and other gen_ai.* leave the attribute list (spec 5).
    const kept: ParsedAttribute[] = [];
    const contents: ContentDraft[] = [];
    for (const a of span.attributes) {
      if (KNOWN_CONTENT_KEYS.has(a.key)) contents.push({ field: a.key, ordinal: a.ordinal, value: em.field(a.value, false) });
      else if (a.key.startsWith("gen_ai.") && !ALLOWLIST.has(a.key)) {
        contents.push({ field: "gen_ai.other", fieldKey: em.field(tagStr(a.key), false), ordinal: a.ordinal, value: em.field(a.value, false) });
      } else kept.push(a);
    }

    const bytesBefore = em.withheldBytes;
    const attributeResults = em.attributeList(kept, true);
    const eventResults = span.events.map((e) => ({
      ordinal: e.ordinal, timeNs: e.timeNs, name: em.field(tagStr(e.name), false),
      attributes: em.attributeList(e.attributes, true), droppedAttributesCount: e.droppedAttributesCount,
    }));
    const withheldEntries = attributeResults.filter((x) => x.withheld > 0).length
      + eventResults.reduce((n, e) => n + e.attributes.filter((x) => x.withheld > 0).length, 0);
    if (options.contentMode === "HASH_ONLY" && withheldEntries > 0) {
      addNote("WITHHELD_ATTRIBUTE", span.spanId, { count: withheldEntries, bytes: em.withheldBytes - bytesBefore });
    }

    const start: Draft = {
      type: "StepStarted",
      payload: {
        stepId: span.spanId, parentStepId: span.parentStepId, contextId: span.contextId, kind,
        operationName: operation === undefined ? null : em.field(operation, ALLOWLIST.get("gen_ai.operation.name")?.(operation) === true),
        name: em.field(tagStr(span.name), false), label: parts.join(" "), otlpKind: span.kind, startNs: span.startNs,
        traceState: em.field(tagStr(span.traceState), false), flags: span.flags,
        droppedAttributesCount: span.droppedAttributesCount, droppedEventsCount: span.droppedEventsCount, droppedLinksCount: span.droppedLinksCount,
        attributes: attributeResults.map((x) => x.entry), links: span.links.map((l) => em.field(l, false)),
        unknownFields: span.unknownFields === null ? null : em.field(span.unknownFields, false),
      },
    } as Draft;
    const end: Draft = {
      type: "StepEnded",
      payload: {
        stepId: span.spanId, endNs: span.endNs, endEffectiveNs: span.endEffectiveNs, statusCode: span.statusCode,
        statusMessage: em.field(tagStr(span.statusMessage), false),
        events: eventResults.map((e) => ({ ...e, attributes: e.attributes.map((x) => x.entry) })),
      },
    } as Draft;

    // Usage (spec 8.1): LLM_CALL spans only.
    const tail: Draft[] = [];
    const usageAttrCount = span.attributes.filter((a) => a.key === "gen_ai.usage.input_tokens" || a.key === "gen_ai.usage.output_tokens").length;
    if (kind === "LLM_CALL") {
      const input = usageValue(span.attributes, "gen_ai.usage.input_tokens");
      const output = usageValue(span.attributes, "gen_ai.usage.output_tokens");
      const unusable = Number(input.unusable) + Number(output.unusable);
      if (unusable > 0) addNote("UNUSABLE_USAGE", span.spanId, { count: unusable });
      if (input.value !== null || output.value !== null) {
        tail.push({ type: "UsageRecorded", payload: { stepId: span.spanId, inputTokens: input.value, outputTokens: output.value } } as Draft);
      }
    } else if (usageAttrCount > 0) {
      addNote("USAGE_NOT_SUMMED", span.spanId, { count: usageAttrCount, scope: "span" });
    }

    const ordered = contentOf(contents);
    for (const c of ordered) {
      tail.push({
        type: "ContentRecorded",
        payload: { stepId: span.spanId, logOrdinal: null, channel: "SPAN_ATTRIBUTE", field: c.field, ...(c.fieldKey ? { fieldKey: c.fieldKey } : {}), ordinal: c.ordinal, value: c.value },
      } as Draft);
    }
    let contentCount = ordered.length;
    for (const bundle of logsOfStep.get(span.spanId) ?? []) {
      tail.push(bundle.logEvent, ...logContentEvents(bundle));
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
    if (slot.isStart) body.push(bundle.start);
    else body.push(bundle.end, ...bundle.tail);
  }
  for (const bundle of logBundles) {
    if (bundle.log.stepId === null) body.push(bundle.logEvent, ...logContentEvents(bundle));
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
    .map((n) => ({ type: "ImportNote", payload: { code: n.code, stepId: n.stepId, detail: n.detail } } as Draft));

  const artifactId = sha256Hex(canonicalJson({
    traceId: run.traceId,
    inputs: [...options.inputs].sort((a, b) => compareString(a.role, b.role)).map((i) => ({ role: i.role, sha256: i.sha256 })),
    contentMode: options.contentMode, importer: IMPORTER, limitsVersion: LIMITS_VERSION, conventionVersion,
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

  const drafts: Draft[] = [started, ...body, ...noteEvents];
  if (drafts.length + 1 > MAX_OUTPUT_EVENTS) throw new ImportError("E_LIMIT", "emit");
  drafts.push({ type: "RunEnded", payload: { eventCount: drafts.length + 1 } } as Draft);

  const events = drafts.map((d, i) => ({ schemaVersion: RUN_EVENT_SCHEMA_VERSION, sequenceNumber: i + 1, runId: run.traceId, ...d }));
  const checked = runEventListSchema.safeParse(events);
  if (!checked.success) throw new ImportError("E_INVALID_LOG", "emit");
  return checked.data;
}
