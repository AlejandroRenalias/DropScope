import { describe, expect, it } from "vitest";
import { fieldSchema, runEventSchema, taggedValueSchema } from "../src/run-events.js";

const trace = "0123456789abcdef0123456789abcdef";
const span = "0123456789abcdef";
const hash = "a".repeat(64);
const base = { schemaVersion: 2, runId: trace };
const withheld = { w: { n: 5, h: hash } };

describe("tagged values and fields", () => {
  it("accepts every tag and nesting", () => {
    const value = { t: "k", v: [["a", { t: "a", v: [{ t: "i", v: "-12" }, { t: "d", v: "NaN" }, { t: "o", v: true }, { t: "b", v: "aGk=" }] }]] };
    expect(taggedValueSchema.safeParse(value).success).toBe(true);
  });

  it("rejects unknown tags, extra keys, bad integers and bad base64", () => {
    expect(taggedValueSchema.safeParse({ t: "x", v: 1 }).success).toBe(false);
    expect(taggedValueSchema.safeParse({ t: "s", v: "a", extra: 1 }).success).toBe(false);
    expect(taggedValueSchema.safeParse({ t: "i", v: "1.5" }).success).toBe(false);
    expect(taggedValueSchema.safeParse({ t: "i", v: 5 }).success).toBe(false);
    expect(taggedValueSchema.safeParse({ t: "b", v: "abc" }).success).toBe(false);
    expect(taggedValueSchema.safeParse({ t: "d", v: "inf" }).success).toBe(false);
  });

  it("allows a field to be verbatim or withheld but not both or neither", () => {
    expect(fieldSchema.safeParse({ v: { t: "s", v: "x" } }).success).toBe(true);
    expect(fieldSchema.safeParse(withheld).success).toBe(true);
    expect(fieldSchema.safeParse({ v: { t: "s", v: "x" }, ...withheld }).success).toBe(false);
    expect(fieldSchema.safeParse({}).success).toBe(false);
  });

  it("keeps __proto__ as plain data in key lists", () => {
    const parsed = taggedValueSchema.parse({ t: "k", v: [["__proto__", { t: "s", v: "x" }]] });
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
});

describe("run events", () => {
  const stepEnded = {
    ...base, sequenceNumber: 3, type: "StepEnded",
    payload: { stepId: span, endNs: "10", endEffectiveNs: "10", statusCode: 1, statusMessage: withheld, events: [] },
  };

  it("accepts a well-formed StepEnded", () => {
    expect(runEventSchema.safeParse(stepEnded).success).toBe(true);
  });

  it("rejects an unknown event type, version and extra payload keys", () => {
    expect(runEventSchema.safeParse({ ...stepEnded, type: "Nope" }).success).toBe(false);
    expect(runEventSchema.safeParse({ ...stepEnded, schemaVersion: 1 }).success).toBe(false);
    expect(runEventSchema.safeParse({ ...stepEnded, schemaVersion: 3 }).success).toBe(false);
    expect(runEventSchema.safeParse({ ...stepEnded, payload: { ...stepEnded.payload, extra: 1 } }).success).toBe(false);
  });

  it("rejects integer status codes outside 0 to 2, string-typed codes and bad ids", () => {
    expect(runEventSchema.safeParse({ ...stepEnded, payload: { ...stepEnded.payload, statusCode: 3 } }).success).toBe(false);
    expect(runEventSchema.safeParse({ ...stepEnded, payload: { ...stepEnded.payload, statusCode: "2" } }).success).toBe(false);
    expect(runEventSchema.safeParse({ ...stepEnded, payload: { ...stepEnded.payload, stepId: "0".repeat(16) } }).success).toBe(false);
    expect(runEventSchema.safeParse({ ...stepEnded, payload: { ...stepEnded.payload, stepId: "ABCDEF0123456789" } }).success).toBe(false);
  });

  it("UsageRecorded takes decimal strings or null, never numbers or zero metrics", () => {
    const usage = (inputTokens: unknown, outputTokens: unknown) =>
      runEventSchema.safeParse({ ...base, sequenceNumber: 4, type: "UsageRecorded", payload: { stepId: span, inputTokens, outputTokens } }).success;
    expect(usage("12", null)).toBe(true);
    expect(usage("9007199254740993", "0")).toBe(true);
    expect(usage(12, "1")).toBe(false);
    expect(usage("-1", "1")).toBe(false);
    expect(usage(null, null)).toBe(false);
  });

  it("ContentRecorded needs exactly one of stepId and logOrdinal, and fieldKey only for gen_ai.other", () => {
    const content = (payload: object) =>
      runEventSchema.safeParse({
        ...base, sequenceNumber: 5, type: "ContentRecorded",
        payload: { stepId: span, logOrdinal: null, channel: "SPAN_ATTRIBUTE", field: "gen_ai.input.messages", ordinal: 0, value: withheld, ...payload },
      }).success;
    expect(content({})).toBe(true);
    expect(content({ stepId: null })).toBe(false);
    expect(content({ logOrdinal: 0 })).toBe(false);
    expect(content({ stepId: null, logOrdinal: 0, channel: "LOG_RECORD" })).toBe(true);
    expect(content({ field: "gen_ai.other" })).toBe(false);
    expect(content({ field: "gen_ai.other", fieldKey: withheld })).toBe(true);
    expect(content({ fieldKey: withheld })).toBe(false);
    expect(content({ field: "gen_ai.made.up" })).toBe(false);
  });

  it("ImportNote details allow only counts and plain names", () => {
    const note = (detail: unknown) =>
      runEventSchema.safeParse({ ...base, sequenceNumber: 6, type: "ImportNote", payload: { code: "UNKNOWN_FIELD", stepId: null, detail } }).success;
    expect(note({ count: 2 })).toBe(true);
    expect(note({ count: "has spaces and secrets" })).toBe(false);
    expect(note({ "bad key!": 1 })).toBe(false);
  });

  it("RunStarted requires a hash-only or full mode and 1 to 2 inputs", () => {
    const started = (overrides: object) =>
      runEventSchema.safeParse({
        ...base, sequenceNumber: 1, type: "RunStarted",
        payload: {
          traceId: trace, derivedOrder: true, importer: { id: "x", version: "1" }, conventionVersion: "1.37",
          contentMode: "HASH_ONLY", selectedTrace: "ONLY", inputs: [{ role: "spans", byteLength: 10, sha256: hash }],
          limitsVersion: "1", artifactId: hash, contexts: [], ...overrides,
        },
      }).success;
    expect(started({})).toBe(true);
    expect(started({ contentMode: "LENGTH_ONLY" })).toBe(false);
    expect(started({ inputs: [] })).toBe(false);
    expect(started({ derivedOrder: false })).toBe(false);
  });
});
