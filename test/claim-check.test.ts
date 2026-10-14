import { describe, expect, it } from "vitest";
import {
  CLAIM_LIMITS, checkClaims, parseClaimFile, parseClaimText, searchableText, type Claim,
} from "../src/claim-check.js";
import type { RunEvent } from "../src/run-events.js";
import { importTraceBytes } from "../src/run-import.js";

// ---- building runs through the real importer ----
const T = "1".repeat(32);
const BASE = 1_700_000_000_000_000_000n;
const ns = (seconds: number): string => (BASE + BigInt(Math.round(seconds * 1e9))).toString();
const id = (n: number) => (n + 1).toString(16).padStart(16, "0");
const enc = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

type Attr = { key: string; value: Record<string, unknown> };
const s = (key: string, value: string): Attr => ({ key, value: { stringValue: value } });

type Step = { start: number; end: number; tool?: string; args?: string; result?: string; output?: string; input?: string; error?: boolean; extra?: Attr[]; resultValue?: Record<string, unknown> };
function spansOf(steps: Step[]) {
  return steps.map((st, i) => ({
    traceId: T, spanId: id(i), name: `s${i}`, startTimeUnixNano: ns(st.start), endTimeUnixNano: ns(st.end),
    ...(st.error ? { status: { code: 2, message: "boom" } } : {}),
    attributes: [
      s("gen_ai.operation.name", st.tool ? "execute_tool" : "chat"),
      ...(st.tool ? [s("gen_ai.tool.name", st.tool)] : []),
      ...(st.args !== undefined ? [s("gen_ai.tool.call.arguments", st.args)] : []),
      ...(st.result !== undefined ? [s("gen_ai.tool.call.result", st.result)] : []),
      ...(st.resultValue !== undefined ? [{ key: "gen_ai.tool.call.result", value: st.resultValue }] : []),
      ...(st.output !== undefined ? [s("gen_ai.output.messages", st.output)] : []),
      ...(st.input !== undefined ? [s("gen_ai.input.messages", st.input)] : []),
      ...(st.extra ?? []),
    ],
  }));
}
function runOf(steps: Step[], mode: "FULL" | "HASH_ONLY" = "FULL", logs?: unknown[]): RunEvent[] {
  return importTraceBytes({
    spans: enc({ resourceSpans: [{ scopeSpans: [{ spans: spansOf(steps) }] }] }),
    ...(logs ? { logs: enc({ resourceLogs: [{ scopeLogs: [{ logRecords: logs }] }] }) } : {}),
    contentMode: mode,
  });
}
const claim = (over: Partial<Claim> = {}): Claim => ({
  id: "c1", text: "a claim", tool: "lookup", stepId: null, field: "result", mustContain: ["59"], caseSensitive: true, atEvent: null, ...over,
});
const seqOf = (events: RunEvent[], type: string, nth = 0) => events.filter((e) => e.type === type)[nth].sequenceNumber;

// Two tool calls and a model call, hand-checkable.
const base = (mode: "FULL" | "HASH_ONLY" = "FULL") => runOf([
  { start: 0, end: 1, tool: "lookup", args: "{\"order\":1042}", result: "{\"total\":59.0,\"delivered\":false}" },
  { start: 1, end: 2, tool: "policy", result: "Undelivered orders are refundable in full." },
  { start: 2, end: 3, output: "Your refund of 59.00 is on its way." },
], mode);

describe("claim check: verdicts", () => {
  const events = base();

  it("supports a claim when every listed text is in the recorded result, and names the event", () => {
    const r = checkClaims(events, [claim({ mustContain: ["\"delivered\":false", "\"total\""] })]).results[0];
    expect(r).toMatchObject({ verdict: "SUPPORTED", reason: "FOUND", stepsChecked: 1, stepFailed: false });
    const content = events.find((e) => e.type === "ContentRecorded" && e.payload.field === "gen_ai.tool.call.result");
    expect(r.evidenceEvent).toBe(content?.sequenceNumber);
  });

  it("is not supported when one of several texts is missing, and says which", () => {
    const r = checkClaims(events, [claim({ mustContain: ["\"total\"", "refunded", "shipped"] })]).results[0];
    expect(r).toMatchObject({ verdict: "NOT_SUPPORTED", reason: "NOT_FOUND", missing: ["refunded", "shipped"] });
  });

  it("searches only the field the claim names", () => {
    expect(checkClaims(events, [claim({ field: "arguments", mustContain: ["1042"] })]).results[0].verdict).toBe("SUPPORTED");
    // 1042 is in the arguments, not the result.
    expect(checkClaims(events, [claim({ field: "result", mustContain: ["1042"] })]).results[0].verdict).toBe("NOT_SUPPORTED");
  });

  it("matches model output and input by step id", () => {
    const modelStep = events.find((e) => e.type === "StepStarted" && e.payload.kind === "LLM_CALL");
    const stepId = (modelStep as { payload: { stepId: string } }).payload.stepId;
    const r = checkClaims(events, [claim({ tool: null, stepId, field: "output", mustContain: ["59.00"] })]).results[0];
    expect(r.verdict).toBe("SUPPORTED");
    // The model step recorded no input: the trace lacks it, which is "cannot check", not "not supported".
    expect(checkClaims(events, [claim({ tool: null, stepId, field: "input", mustContain: ["x"] })]).results[0]).toMatchObject({ verdict: "CANNOT_CHECK", reason: "NO_CONTENT" });
  });

  it("is case sensitive by default and can be told not to be", () => {
    expect(checkClaims(events, [claim({ tool: "policy", mustContain: ["undelivered"] })]).results[0].verdict).toBe("NOT_SUPPORTED");
    expect(checkClaims(events, [claim({ tool: "policy", mustContain: ["undelivered"], caseSensitive: false })]).results[0].verdict).toBe("SUPPORTED");
    expect(checkClaims(events, [claim({ tool: "policy", mustContain: ["UNDELIVERED ORDERS"], caseSensitive: false })]).results[0].verdict).toBe("SUPPORTED");
  });

  it("does not search field names, only values", () => {
    const structured = runOf([{ start: 0, end: 1, tool: "lookup", resultValue: { kvlistValue: { values: [{ key: "secretName", value: { stringValue: "visible" } }, { key: "n", value: { intValue: "7" } }] } } }]);
    expect(checkClaims(structured, [claim({ mustContain: ["visible"] })]).results[0].verdict).toBe("SUPPORTED");
    expect(checkClaims(structured, [claim({ mustContain: ["7"] })]).results[0].verdict).toBe("SUPPORTED");
    expect(checkClaims(structured, [claim({ mustContain: ["secretName"] })]).results[0].verdict).toBe("NOT_SUPPORTED");
  });

  it("reports a tool or step id that does not exist, and lists the tools that do", () => {
    const check = checkClaims(events, [claim({ tool: "lookupp" }), claim({ id: "c2", tool: null, stepId: "f".repeat(16) })]);
    expect(check.results.map((r) => [r.verdict, r.reason])).toEqual([["NOT_SUPPORTED", "NO_MATCHING_STEP"], ["NOT_SUPPORTED", "NO_MATCHING_STEP"]]);
    expect(check.knownTools).toEqual(["lookup", "policy"]);
  });

  it("is supported if any of several matching steps supports it, and reports the first", () => {
    const run = runOf([
      { start: 0, end: 1, tool: "pay", result: "declined" },
      { start: 1, end: 2, tool: "pay", result: "accepted 59" },
      { start: 2, end: 3, tool: "pay", result: "accepted 59 again" },
    ]);
    const r = checkClaims(run, [claim({ tool: "pay", mustContain: ["accepted"] })]).results[0];
    expect(r).toMatchObject({ verdict: "SUPPORTED", stepsChecked: 3 });
    expect(r.stepId).toBe(id(1));
  });

  it("flags support that comes from a failed step", () => {
    const run = runOf([{ start: 0, end: 1, tool: "pay", result: "timeout while sending 59", error: true }]);
    expect(checkClaims(run, [claim({ tool: "pay", mustContain: ["59"] })]).results[0]).toMatchObject({ verdict: "SUPPORTED", stepFailed: true });
  });

  it("joins all content of one step and field, so texts may be spread over several items", () => {
    const events2 = runOf([{ start: 0, end: 1, tool: "t", result: "first part" }], "FULL", [
      { traceId: T, spanId: id(0), timeUnixNano: ns(0.5), observedTimeUnixNano: ns(0.5), attributes: [s("gen_ai.tool.call.result", "second part")] },
    ]);
    const r = checkClaims(events2, [claim({ tool: "t", mustContain: ["first part", "second part"] })]).results[0];
    expect(r.verdict).toBe("SUPPORTED");
  });
});

describe("claim check: evidence that cannot be read is never a guess", () => {
  it("says CANNOT_CHECK for every claim about a run imported without content", () => {
    const hashed = base("HASH_ONLY");
    const check = checkClaims(hashed, [claim(), claim({ id: "c2", mustContain: ["something that is certainly not there"] })]);
    expect(check.contentMode).toBe("HASH_ONLY");
    expect(check.results.map((r) => [r.verdict, r.reason])).toEqual([["CANNOT_CHECK", "CONTENT_WITHHELD"], ["CANNOT_CHECK", "CONTENT_WITHHELD"]]);
    expect(check.counts).toEqual({ supported: 0, notSupported: 0, cannotCheck: 2 });
  });

  it("still finds tools by name in a withheld run, and still reports a missing tool as not supported", () => {
    const hashed = base("HASH_ONLY");
    expect(checkClaims(hashed, [claim({ tool: "nothing" })]).results[0]).toMatchObject({ verdict: "NOT_SUPPORTED", reason: "NO_MATCHING_STEP" });
    expect(checkClaims(hashed, [claim({ tool: "lookup" })]).results[0].stepsChecked).toBe(1);
  });

  it("does not turn an unread step into a refusal: one unreadable candidate makes the answer CANNOT_CHECK", () => {
    const run = runOf([
      { start: 0, end: 1, tool: "pay", result: "declined" },
      { start: 1, end: 2, tool: "pay" }, // no content recorded for this call
    ]);
    expect(checkClaims(run, [claim({ tool: "pay", mustContain: ["accepted"] })]).results[0]).toMatchObject({ verdict: "CANNOT_CHECK", reason: "NO_CONTENT" });
    // ...but a readable step that does support it still wins.
    expect(checkClaims(run, [claim({ tool: "pay", mustContain: ["declined"] })]).results[0].verdict).toBe("SUPPORTED");
  });
});

describe("claim check: evidence must come before the claim (atEvent)", () => {
  const events = base();
  const lookupContent = events.find((e) => e.type === "ContentRecorded" && e.payload.field === "gen_ai.tool.call.result")?.sequenceNumber as number;

  it("counts content recorded at or before the event, and rejects content recorded after it", () => {
    expect(checkClaims(events, [claim({ atEvent: lookupContent })]).results[0].verdict).toBe("SUPPORTED");
    const early = checkClaims(events, [claim({ atEvent: lookupContent - 1 })]).results[0];
    expect(early).toMatchObject({ verdict: "NOT_SUPPORTED", reason: "TOO_LATE", evidenceEvent: lookupContent });
  });

  it("does not let later content stand in for missing earlier content", () => {
    // 59 is in the lookup result; a claim made before it was recorded cannot rely on it.
    const r = checkClaims(events, [claim({ atEvent: seqOf(events, "StepStarted") })]).results[0];
    expect(r.reason).toBe("TOO_LATE");
  });
});

describe("claim check: work limit", () => {
  it("turns remaining claims into CANNOT_CHECK instead of freezing", () => {
    const big = "x".repeat(2_000_000);
    const run = runOf([{ start: 0, end: 1, tool: "big", result: big }]);
    const many = Array.from({ length: 100 }, (_, i) => claim({ id: `c${i}`, tool: "big", mustContain: ["a", "b", "c", "d", "e"].map((c) => `${c}${c}`) }));
    const results = checkClaims(run, many).results;
    // 100 claims x 5 texts x 2 MB = 1e9 characters: right at the limit, so the whole set is still answered...
    expect(results.every((r) => r.verdict === "NOT_SUPPORTED")).toBe(true);
    const over = checkClaims(run, [...many, claim({ id: "extra", tool: "big", mustContain: ["zz"] })]).results;
    // ...and one more claim goes over it and is not answered.
    expect(over[over.length - 1]).toMatchObject({ verdict: "CANNOT_CHECK", reason: "TOO_MUCH_WORK" });
    expect(CLAIM_LIMITS.maxScannedCharacters).toBe(1_000_000_000);
  });
});

describe("searchableText", () => {
  it("lists text, number and boolean leaves in order and skips field names and bytes", () => {
    expect(searchableText({ t: "k", v: [["name", { t: "s", v: "a" }], ["list", { t: "a", v: [{ t: "i", v: "5" }, { t: "o", v: true }, { t: "b", v: "AAAA" }, { t: "d", v: 1.5 }] }]] })).toBe("a\n5\ntrue\n1.5");
  });
  it("does not recurse over deep structure", () => {
    let value: { t: "a"; v: unknown[] } = { t: "a", v: [{ t: "s", v: "deep" }] };
    for (let i = 0; i < 100_000; i += 1) value = { t: "a", v: [value] };
    expect(searchableText(value as never)).toBe("deep");
  });
});

describe("claims file", () => {
  const file = (claims: unknown) => parseClaimText(JSON.stringify({ claims }));
  const one = { id: "refund-amount", text: "Refunded 59", tool: "lookup", mustContain: ["59"] };

  it("reads a valid file and fills in the defaults", () => {
    const parsed = file([one, { id: "c2", text: "t", stepId: "a".repeat(16), field: "output", mustContain: ["x", "y"], caseSensitive: false, atEvent: 12 }]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.claims[0]).toEqual({ id: "refund-amount", text: "Refunded 59", tool: "lookup", stepId: null, field: "result", mustContain: ["59"], caseSensitive: true, atEvent: null });
    expect(parsed.claims[1]).toMatchObject({ tool: null, stepId: "a".repeat(16), field: "output", caseSensitive: false, atEvent: 12 });
  });

  it("rejects a misspelled field instead of ignoring it (a typo must never weaken a claim)", () => {
    const parsed = file([{ ...one, mustContains: ["59"] }]);
    expect(parsed.claims).toEqual([]);
    expect(parsed.errors.join(" ")).toContain('unknown field "mustContains"');
    expect(file([{ ...one, mustContain: undefined }]).errors.join(" ")).toContain('"mustContain" must list');
  });

  it("rejects every kind of bad value with a sentence that names the claim", () => {
    const bad: Array<[unknown, string]> = [
      [{ ...one, id: "has space" }, '"id" must be'],
      [{ ...one, text: "" }, '"text" must say'],
      [{ ...one, tool: undefined }, 'exactly one of "tool"'],
      [{ ...one, stepId: "a".repeat(16) }, 'exactly one of "tool"'],
      [{ ...one, tool: undefined, stepId: "XYZ" }, '"stepId" must be 16'],
      [{ ...one, tool: undefined, stepId: "a".repeat(16) }, '"field" is required with "stepId"'],
      [{ ...one, field: "everything" }, '"field" must be one of'],
      [{ ...one, mustContain: [] }, '"mustContain" must list'],
      [{ ...one, mustContain: [""] }, 'each "mustContain" text'],
      [{ ...one, mustContain: [1] }, 'each "mustContain" text'],
      [{ ...one, mustContain: ["1", "2", "3", "4", "5", "6"] }, '"mustContain" must list'],
      [{ ...one, caseSensitive: "no" }, '"caseSensitive" must be true or false'],
      [{ ...one, atEvent: 0 }, '"atEvent" must be a whole number'],
      [{ ...one, atEvent: 1.5 }, '"atEvent" must be a whole number'],
      [{ ...one, atEvent: "3" }, '"atEvent" must be a whole number'],
      ["not an object", "must be an object"],
    ];
    for (const [entry, message] of bad) {
      const parsed = file([entry]);
      expect(parsed.claims, message).toEqual([]);
      expect(parsed.errors.join(" "), message).toContain(message);
      expect(parsed.errors.join(" ")).toMatch(/^Claim 1/);
    }
  });

  it("rejects duplicate ids, unknown top-level fields, an empty list and too many claims", () => {
    expect(file([one, one]).errors.join(" ")).toContain('the id "refund-amount" is used twice');
    expect(parseClaimText(JSON.stringify({ claims: [one], extra: 1 })).errors.join(" ")).toContain("unknown top-level field");
    expect(file([]).errors).toEqual(["The claims file lists no claims."]);
    expect(file(Array.from({ length: CLAIM_LIMITS.maxClaims + 1 }, (_, i) => ({ ...one, id: `c${i}` }))).errors.join(" ")).toContain("the limit is 100");
    expect(parseClaimText("[]").errors.join(" ")).toContain("must be a JSON object");
    expect(parseClaimText("{}").errors.join(" ")).toContain('needs a "claims" list');
  });

  it("reports broken JSON, repeated field names, a byte order mark and oversized files without echoing them", () => {
    for (const text of ['{"claims": [', '{"claims": [], "claims": []}', '﻿{"claims": []}', "not json at all {{"]) {
      const parsed = parseClaimText(text);
      expect(parsed.errors[0]).toContain("not valid JSON");
      expect(parsed.errors.join(" ")).not.toContain("not json at all");
    }
    expect(parseClaimFile(new Uint8Array(CLAIM_LIMITS.maxBytes + 1).fill(32)).errors[0]).toContain("too large");
    expect(parseClaimText(`{"claims":${"[".repeat(20)}${"]".repeat(20)}}`).errors[0]).toContain("too large or too deeply nested");
    expect(parseClaimFile(new Uint8Array([0x7b, 0xff, 0x7d])).errors[0]).toContain("valid");
  });

  it("caps the number of reported problems", () => {
    const parsed = file(Array.from({ length: 60 }, (_, i) => ({ id: `c${i}`, text: "t", mustContain: ["x"] })));
    expect(parsed.errors).toHaveLength(21);
    expect(parsed.errors[20]).toMatch(/^…and \d+ more problems\.$/);
  });

  it("does not repeat hostile text from the file in its messages", () => {
    const parsed = file([{ ...one, "\u001b[2Jevil": 1 }]);
    expect(parsed.errors.join(" ")).not.toContain("\u001b");
  });
});
