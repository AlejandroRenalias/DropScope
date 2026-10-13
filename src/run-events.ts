// Zod schemas for the run-event contract v1 (docs/schemas/run-event-contract-v1.md, sections 3, 5 and 12).
// This is a separate event family from the mission events in contracts.ts and does not change them.
import { z } from "zod";

const DECIMAL_INTEGER = /^-?[0-9]{1,20}$/;
const NON_NEGATIVE_DECIMAL = /^(0|[1-9][0-9]{0,19})$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const BASE64_PADDED = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export const RUN_EVENT_SCHEMA_VERSION = 1;

// Section 3.1: tagged values. Recursive, so the type is written by hand.
export type TaggedValue =
  | { t: "s"; v: string }
  | { t: "i"; v: string }
  | { t: "d"; v: number | "NaN" | "Infinity" | "-Infinity" }
  | { t: "o"; v: boolean }
  | { t: "b"; v: string }
  | { t: "a"; v: TaggedValue[] }
  | { t: "k"; v: Array<[string, TaggedValue]> };

export const taggedValueSchema: z.ZodType<TaggedValue> = z.lazy(() =>
  z.discriminatedUnion("t", [
    z.object({ t: z.literal("s"), v: z.string() }).strict(),
    z.object({ t: z.literal("i"), v: z.string().regex(DECIMAL_INTEGER) }).strict(),
    z.object({
      t: z.literal("d"),
      v: z.union([z.number().finite(), z.enum(["NaN", "Infinity", "-Infinity"])]),
    }).strict(),
    z.object({ t: z.literal("o"), v: z.boolean() }).strict(),
    z.object({ t: z.literal("b"), v: z.string().regex(BASE64_PADDED) }).strict(),
    z.object({ t: z.literal("a"), v: z.array(taggedValueSchema) }).strict(),
    z.object({ t: z.literal("k"), v: z.array(z.tuple([z.string(), taggedValueSchema])) }).strict(),
  ]),
);

// Section 3.3: the field form. Verbatim or withheld, never both.
export const fieldSchema = z.union([
  z.object({ v: taggedValueSchema }).strict(),
  z.object({ w: z.object({ n: z.number().int().nonnegative(), h: z.string().regex(SHA256_HEX) }).strict() }).strict(),
]);
export type Field = z.infer<typeof fieldSchema>;

const unsignedNs = z.string().regex(NON_NEGATIVE_DECIMAL);
const decimalCount = z.string().regex(NON_NEGATIVE_DECIMAL);
const count32 = z.number().int().min(0).max(4294967295);
const traceIdSchema = z.string().regex(/^[0-9a-f]{32}$/).refine((s) => !/^0+$/.test(s));
const spanIdSchema = z.string().regex(/^[0-9a-f]{16}$/).refine((s) => !/^0+$/.test(s));
const sha256Schema = z.string().regex(SHA256_HEX);
const ordinalSchema = z.number().int().nonnegative();

export const attributeListSchema = z.array(
  z.object({ ordinal: ordinalSchema, key: fieldSchema, value: fieldSchema }).strict(),
);

const contextSchema = z.object({
  contextId: z.string().min(1),
  resource: z.object({ attributes: attributeListSchema, schemaUrl: fieldSchema }).strict(),
  scope: z.object({
    name: fieldSchema,
    version: fieldSchema,
    attributes: attributeListSchema,
    schemaUrl: fieldSchema,
  }).strict(),
}).strict();

export const stepKindSchema = z.enum(["LLM_CALL", "TOOL_CALL", "AGENT", "OTHER"]);
export type StepKind = z.infer<typeof stepKindSchema>;
export const contentModeSchema = z.enum(["HASH_ONLY", "FULL"]);
export type ContentMode = z.infer<typeof contentModeSchema>;
export const contentChannelSchema = z.enum(["SPAN_ATTRIBUTE", "LOG_RECORD"]);

export const importNoteCodeSchema = z.enum([
  "OTHER_TRACE_EXCLUDED",
  "DUPLICATE_SPAN_COLLAPSED",
  "DUPLICATE_LOG_COLLAPSED",
  "MISSING_PARENT",
  "PARENT_CYCLE_BROKEN",
  "CHILD_OUTSIDE_PARENT_INTERVAL",
  "NEGATIVE_DURATION_CLAMPED",
  "UNFINISHED_SPAN_CLOSED",
  "ORPHAN_LOG_RECORD",
  "UNKNOWN_FIELD",
  "UNRECOGNIZED_OPERATION",
  "CONTENT_ABSENT",
  "USAGE_NOT_SUMMED",
  "UNUSABLE_USAGE",
  "ENUM_NAME_ACCEPTED",
  "SCHEMA_URL_ABSENT",
  "SCHEMA_URL_MISMATCH",
  "WITHHELD_ATTRIBUTE",
  "SECRET_PATTERN_COUNT",
]);
export type ImportNoteCode = z.infer<typeof importNoteCodeSchema>;

// Section 12: closed error codes.
export const importErrorCodeSchema = z.enum([
  "E_SYNTAX",
  "E_EMPTY",
  "E_MULTIPLE_TRACES",
  "E_TRACE_NOT_FOUND",
  "E_CONFLICTING_DUPLICATE",
  "E_NUMBER",
  "E_ENUM",
  "E_ANYVALUE",
  "E_UNICODE",
  "E_ID",
  "E_LIMIT",
  "E_PATH",
  "E_FILE_KIND",
  "E_EXISTS_DIFFERENT",
  "E_INVALID_LOG",
  "E_PLATFORM",
]);
export type ImportErrorCode = z.infer<typeof importErrorCodeSchema>;

// Note details contain only codes, counts, ids and enumerated names (section 5, ImportNote).
const noteDetailSchema = z.record(
  z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,31}$/),
  z.union([z.number().int().nonnegative(), z.string().max(64).regex(/^[A-Za-z0-9._:-]*$/)]),
);

const eventBase = {
  schemaVersion: z.literal(RUN_EVENT_SCHEMA_VERSION),
  sequenceNumber: z.number().int().positive(),
  runId: traceIdSchema,
};

const runStartedPayload = z.object({
  traceId: traceIdSchema,
  derivedOrder: z.literal(true),
  importer: z.object({ id: z.string().min(1), version: z.string().min(1) }).strict(),
  conventionVersion: z.string().min(1),
  contentMode: contentModeSchema,
  selectedTrace: z.enum(["ONLY", "EXPLICIT"]),
  inputs: z.array(z.object({
    role: z.enum(["spans", "logs"]),
    byteLength: z.number().int().nonnegative(),
    sha256: sha256Schema,
  }).strict()).min(1).max(2),
  limitsVersion: z.string().min(1),
  artifactId: sha256Schema,
  contexts: z.array(contextSchema),
}).strict();

const stepStartedPayload = z.object({
  stepId: spanIdSchema,
  parentStepId: spanIdSchema.nullable(),
  contextId: z.string().min(1),
  kind: stepKindSchema,
  operationName: fieldSchema.nullable(),
  name: fieldSchema,
  label: z.string(),
  otlpKind: z.number().int().min(0).max(5),
  startNs: unsignedNs,
  traceState: fieldSchema,
  flags: count32,
  droppedAttributesCount: count32,
  droppedEventsCount: count32,
  droppedLinksCount: count32,
  attributes: attributeListSchema,
  links: z.array(fieldSchema),
  unknownFields: fieldSchema.nullable(),
}).strict();

const stepEndedPayload = z.object({
  stepId: spanIdSchema,
  endNs: unsignedNs.nullable(),
  endEffectiveNs: unsignedNs,
  statusCode: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  statusMessage: fieldSchema,
  events: z.array(z.object({
    ordinal: ordinalSchema,
    timeNs: unsignedNs,
    name: fieldSchema,
    attributes: attributeListSchema,
    droppedAttributesCount: count32,
  }).strict()),
}).strict();

const usageRecordedPayload = z.object({
  stepId: spanIdSchema,
  inputTokens: decimalCount.nullable(),
  outputTokens: decimalCount.nullable(),
}).strict().refine((p) => p.inputTokens !== null || p.outputTokens !== null, {
  message: "UsageRecorded needs at least one usable metric",
});

const KNOWN_CONTENT_FIELDS = [
  "gen_ai.input.messages",
  "gen_ai.output.messages",
  "gen_ai.system_instructions",
  "gen_ai.tool.call.arguments",
  "gen_ai.tool.call.result",
] as const;
export const contentFieldNameSchema = z.enum([...KNOWN_CONTENT_FIELDS, "gen_ai.other"]);

const contentRecordedPayload = z.object({
  stepId: spanIdSchema.nullable(),
  logOrdinal: ordinalSchema.nullable(),
  channel: contentChannelSchema,
  field: contentFieldNameSchema,
  fieldKey: fieldSchema.optional(),
  ordinal: ordinalSchema,
  value: fieldSchema,
}).strict().superRefine((p, ctx) => {
  // Exactly one of stepId and logOrdinal is set (section 5).
  if ((p.stepId === null) === (p.logOrdinal === null)) {
    ctx.addIssue({ code: "custom", message: "exactly one of stepId and logOrdinal must be set" });
  }
  // The key is carried only for the catch-all field name.
  if ((p.field === "gen_ai.other") !== (p.fieldKey !== undefined)) {
    ctx.addIssue({ code: "custom", message: "fieldKey is required for gen_ai.other and forbidden otherwise" });
  }
});

const logRecordedPayload = z.object({
  logOrdinal: ordinalSchema,
  stepId: spanIdSchema.nullable(),
  contextId: z.string().min(1),
  timeNs: unsignedNs,
  observedTimeNs: unsignedNs,
  severityNumber: z.number().int().min(0).max(24),
  severityText: fieldSchema,
  flags: count32,
  eventName: fieldSchema,
  droppedAttributesCount: count32,
  attributes: attributeListSchema,
}).strict();

const importNotePayload = z.object({
  code: importNoteCodeSchema,
  stepId: spanIdSchema.nullable(),
  detail: noteDetailSchema,
}).strict();

const runEndedPayload = z.object({
  eventCount: z.number().int().positive(),
}).strict();

function eventOf<T extends string, P extends z.ZodType>(type: T, payload: P) {
  return z.object({ ...eventBase, type: z.literal(type), payload }).strict();
}

export const runEventSchema = z.discriminatedUnion("type", [
  eventOf("RunStarted", runStartedPayload),
  eventOf("StepStarted", stepStartedPayload),
  eventOf("StepEnded", stepEndedPayload),
  eventOf("UsageRecorded", usageRecordedPayload),
  eventOf("ContentRecorded", contentRecordedPayload),
  eventOf("LogRecorded", logRecordedPayload),
  eventOf("ImportNote", importNotePayload),
  eventOf("RunEnded", runEndedPayload),
]);
export type RunEvent = z.infer<typeof runEventSchema>;
export type RunEventType = RunEvent["type"];

export const runEventListSchema = z.array(runEventSchema);
