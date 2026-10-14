// Regression tests for the findings of the independent review of commit 110e4bc (Codex gpt-6.1-sol).
// Each test fails on the reviewed code and passes now.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { canonicalJson } from "../src/canonical.js";
import {
  defaultChecks, evaluateFolderAcl, readInputFile, syncedRootWarning, windowsChecks, type PlatformChecks,
} from "../src/run-files.js";
import { ImportError } from "../src/run-import-error.js";
import { importTraceBytes } from "../src/run-import.js";
import type { RunEvent } from "../src/run-events.js";
import { createReplay, validateRunHistory } from "../src/run-reducer.js";
import { parseRunLog, publishRun, readRunLog, serializeRunLog } from "../src/run-store.js";
import { runCli } from "../src/run-cli.js";

const windows = process.platform === "win32";
const T = "1".repeat(32);
const S = "00000000000000a1";
const enc = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const span = (extra: Record<string, unknown> = {}) => ({ traceId: T, spanId: S, name: "n", startTimeUnixNano: "1", endTimeUnixNano: "2", ...extra });
const spansFile = (spans: unknown[], resource: unknown = {}, scope: unknown = { name: "s" }) =>
  enc({ resourceSpans: [{ resource, scopeSpans: [{ scope, spans }] }] });
const logsFile = (logs: unknown[]) => enc({ resourceLogs: [{ scopeLogs: [{ logRecords: logs }] }] });
const sattr = (key: string, value: string) => ({ key, value: { stringValue: value } });
const fake: PlatformChecks = { name: "fake", fileAttributes: () => 0, prepareRunsDirectory: () => {} };

let root: string;
let counter = 0;
beforeAll(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "dropscope-review-")); });
afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); });
afterEach(() => { vi.restoreAllMocks(); });
const fresh = (name: string) => path.join(root, `${name}-${(counter += 1)}`);

function codeOf(fn: () => unknown): string {
  try { fn(); return "OK"; } catch (error) {
    if (error instanceof ImportError) return `${error.code}:${(error.reason ?? "").split(" ")[0]}`;
    throw error;
  }
}
const clone = (events: RunEvent[]): any[] => JSON.parse(JSON.stringify(events)); // eslint-disable-line @typescript-eslint/no-explicit-any
const find = (events: any[], type: string) => events.find((e) => e.type === type); // eslint-disable-line @typescript-eslint/no-explicit-any
const ofType = <T extends RunEvent["type"]>(events: RunEvent[], type: T) => events.filter((e): e is Extract<RunEvent, { type: T }> => e.type === type);

describe("finding 1: the folder-permission check cannot fail open", () => {
  const USER = "S-1-5-21-1-2-3-1001";
  it("accepts only a complete list that includes the user and no one else but SYSTEM and Administrators", () => {
    expect(codeOf(() => evaluateFolderAcl({ sids: [USER, "S-1-5-18", "S-1-5-32-544"] }, USER))).toBe("OK");
    expect(codeOf(() => evaluateFolderAcl({ sids: USER }, USER))).toBe("OK");
  });
  it("refuses an empty, missing, malformed or loosened list", () => {
    for (const bad of [{ sids: [] }, {}, null, { sids: "" }, { sids: [5] }, { sids: ["not-a-sid"] }]) {
      expect(codeOf(() => evaluateFolderAcl(bad, USER)), JSON.stringify(bad)).toBe("E_PLATFORM:ACL_UNREADABLE");
    }
    expect(codeOf(() => evaluateFolderAcl({ sids: ["S-1-5-18"] }, USER))).toBe("E_PLATFORM:ACL_MISSING_CURRENT_USER");
    expect(codeOf(() => evaluateFolderAcl({ sids: [USER, "S-1-1-0"] }, USER))).toBe("E_PLATFORM:RUNS_DIR_NOT_OWNER_ONLY");
  });
  it.skipIf(!windows)("a PowerShell failure stops the check instead of producing an empty list", () => {
    expect(codeOf(() => windowsChecks.prepareRunsDirectory(path.join(root, "does-not-exist"), false))).toMatch(/^E_PLATFORM:/);
  }, 60_000);
});

describe("finding 2: many associated logs do not overflow the stack", () => {
  it("imports one span with 150 logs of 1,024 attributes each", () => {
    const attributes = Array.from({ length: 1024 }, (_, i) => sattr(`k${i}`, "v"));
    const logs = Array.from({ length: 150 }, (_, i) => ({ traceId: T, spanId: S, timeUnixNano: String(i + 1), attributes }));
    const events = importTraceBytes({ spans: spansFile([span()]), logs: logsFile(logs) });
    expect(ofType(events, "LogRecorded").length).toBe(150);
    expect(ofType(events, "ContentRecorded").length).toBe(150 * 1024);
  }, 120_000);
});

describe("finding 3: pipeline-wide limits", () => {
  it("shares one node budget across both input files", () => {
    const bigArray = `[${"1,".repeat(99_999)}1]`;
    const spans = new TextEncoder().encode(`{"resourceSpans":[{"scopeSpans":[{"spans":[${Array.from({ length: 11 }, (_, i) =>
      `{"traceId":"${T}","spanId":"${(i + 1).toString(16).padStart(16, "0")}","startTimeUnixNano":"1","weird":${bigArray}}`).join(",")}]}]}]}`);
    const logs = new TextEncoder().encode(`{"resourceLogs":[{"scopeLogs":[{"logRecords":[${Array.from({ length: 11 }, () => `{"custom":${bigArray}}`).join(",")}]}]}]}`);
    // Each file alone is under 2,000,000 nodes; together they are over.
    expect(codeOf(() => importTraceBytes({ spans, logs }))).toBe("E_LIMIT:");
  }, 60_000);

  it("fails closed on shared-resource amplification before building the output", () => {
    const hugeResource = { attributes: [sattr("service.name", "x".repeat(800_000))] };
    const scopes = Array.from({ length: 200 }, (_, i) => ({ scope: { name: `scope${i}` }, spans: [span({ spanId: (i + 1).toString(16).padStart(16, "0") })] }));
    const file = enc({ resourceSpans: [{ resource: hugeResource, scopeSpans: scopes }] });
    expect(file.length).toBeLessThan(1_000_000);
    const started = performance.now();
    // Only FULL mode repeats the shared value in every context; the default mode keeps a fingerprint.
    expect(codeOf(() => importTraceBytes({ spans: file }))).toBe("OK");
    expect(codeOf(() => importTraceBytes({ spans: file, contentMode: "FULL" }))).toBe("E_LIMIT:OUTPUT_BYTES");
    expect(performance.now() - started).toBeLessThan(60_000);
  }, 120_000);

  it("rejects a total input over 64 MiB before parsing", () => {
    const big = new Uint8Array(40 * 1024 * 1024);
    expect(codeOf(() => importTraceBytes({ spans: big, logs: big }))).toBe("E_LIMIT:INPUT_TOTAL_BYTES");
  });

  it("serializes with a running size check", () => {
    const events = importTraceBytes({ spans: spansFile([span()]) });
    const fatEvent = { ...events[1], pad: "x".repeat(1_000_000) };
    const many = Array.from({ length: 140 }, () => fatEvent) as unknown as RunEvent[];
    expect(codeOf(() => serializeRunLog(many))).toBe("E_LIMIT:OUTPUT_TOO_LARGE");
  }, 60_000);

  it("keeps checkpoint memory bounded and still gives exact state at every boundary", () => {
    const many = Array.from({ length: 10_000 }, (_, i) => span({
      spanId: (i + 1).toString(16).padStart(16, "0"), startTimeUnixNano: String(100 + i), endTimeUnixNano: String(200 + i),
      attributes: [sattr("gen_ai.operation.name", "chat"), { key: "gen_ai.usage.input_tokens", value: { intValue: "2" } }, sattr("gen_ai.input.messages", "m")],
      status: { code: i % 7 === 0 ? 2 : 1 },
    }));
    const events = importTraceBytes({ spans: spansFile(many) });
    const replay = createReplay(events);
    expect(replay.length).toBeGreaterThan(256 * 64);
    const expected = (n: number) => {
      const open = new Set<string>(); const closed = new Set<string>(); const errors = new Set<string>();
      const byKind: Record<string, number> = { LLM_CALL: 0, TOOL_CALL: 0, AGENT: 0, OTHER: 0 };
      let input = 0n; let content = 0; const notes: Record<string, number> = {};
      for (const e of events.slice(0, n)) {
        if (e.type === "StepStarted") { open.add(e.payload.stepId); byKind[e.payload.kind] += 1; }
        if (e.type === "StepEnded") { open.delete(e.payload.stepId); closed.add(e.payload.stepId); if (e.payload.statusCode === 2) errors.add(e.payload.stepId); }
        if (e.type === "UsageRecorded" && e.payload.inputTokens) input += BigInt(e.payload.inputTokens);
        if (e.type === "ContentRecorded") content += 1;
        if (e.type === "ImportNote") notes[e.payload.code] = (notes[e.payload.code] ?? 0) + 1;
      }
      return { open: [...open].sort(), closed: [...closed].sort(), errors: [...errors].sort(), byKind, input: input.toString(), content, notes };
    };
    const interval = Math.ceil(events.length / 64);
    for (const n of [1, interval - 1, interval, interval + 1, 2 * interval, 2 * interval + 1, 5000, events.length]) {
      const state = replay.stateAt(n);
      const want = expected(n);
      expect(state.openStepIds, `open @${n}`).toEqual(want.open);
      expect(state.closedStepIds, `closed @${n}`).toEqual(want.closed);
      expect(state.errorStepIds, `errors @${n}`).toEqual(want.errors);
      expect(state.stepsByKind, `kinds @${n}`).toEqual(want.byKind);
      expect(state.inputTokens, `tokens @${n}`).toBe(want.input);
      expect(state.content["SPAN_ATTRIBUTE:gen_ai.input.messages"] ?? 0, `content @${n}`).toBe(want.content);
      expect(state.notes, `notes @${n}`).toEqual(want.notes);
      expect(state.sequenceNumber).toBe(n);
    }
  }, 120_000);
});

describe("finding 4: a folder swapped for a junction during the open is caught", () => {
  it("rejects the file when the path now resolves somewhere else", () => {
    const dir = fresh("swap");
    fs.mkdirSync(dir);
    const file = path.join(dir, "f.json");
    fs.writeFileSync(file, "{}");
    const swapping: PlatformChecks = {
      ...fake,
      fileAttributes: () => {
        fs.renameSync(dir, `${dir}.moved`);
        fs.symlinkSync(`${dir}.moved`, dir, windows ? "junction" : "dir");
        return 0;
      },
    };
    expect(codeOf(() => readInputFile(file, 100, swapping))).toBe("E_PATH:PATH_CHANGED_DURING_OPEN");
  });

  it("accepts an ordinary file and reads it exactly", () => {
    const file = path.join(root, "plain.json");
    fs.writeFileSync(file, "{\"a\":1}");
    expect(Buffer.from(readInputFile(file, 100, fake)).toString()).toBe("{\"a\":1}");
  });
});

describe("finding 5: privacy and structure are enforced on read", () => {
  const base = () => importTraceBytes({ spans: spansFile([span({ attributes: [sattr("gen_ai.operation.name", "chat")] })]) });
  const reason = (events: unknown) => codeOf(() => validateRunHistory(events));

  it("rejects a step label that is not derived from structural data", () => {
    const e = clone(base());
    find(e, "StepStarted").payload.label = "SECRET PROMPT";
    expect(reason(e)).toBe("E_INVALID_LOG:LABEL_NOT_DERIVED");
  });

  it("accepts the derived label in both modes", () => {
    const withModel = (mode: "HASH_ONLY" | "FULL") => importTraceBytes({
      contentMode: mode,
      spans: spansFile([span({ attributes: [sattr("gen_ai.operation.name", "chat"), sattr("gen_ai.request.model", "m-1"), sattr("gen_ai.response.model", "other")] })]),
    });
    for (const mode of ["HASH_ONLY", "FULL"] as const) {
      const events = withModel(mode);
      expect(ofType(events, "StepStarted")[0].payload.label).toBe("LLM_CALL chat m-1");
      expect(reason(events)).toBe("OK");
    }
  });

  it("rejects free-form note details and notes with the wrong shape", () => {
    const withNote = (note: unknown) => {
      const e = clone(base());
      e.splice(e.length - 1, 0, { schemaVersion: 1, runId: T, type: "ImportNote", payload: note });
      e.forEach((x, i) => { x.sequenceNumber = i + 1; });
      e[e.length - 1].payload.eventCount = e.length;
      return e;
    };
    expect(reason(withNote({ code: "DUPLICATE_SPAN_COLLAPSED", stepId: null, detail: { count: 1 } }))).toBe("OK");
    expect(reason(withNote({ code: "DUPLICATE_SPAN_COLLAPSED", stepId: null, detail: { count: 1, SECRET_PROMPT: "x" } }))).toBe("E_INVALID_LOG:EVENT_SCHEMA");
    expect(reason(withNote({ code: "DUPLICATE_SPAN_COLLAPSED", stepId: null, detail: { other: 1 } }))).toBe("E_INVALID_LOG:EVENT_SCHEMA");
    expect(reason(withNote({ code: "CONTENT_ABSENT", stepId: null, detail: {} }))).toBe("E_INVALID_LOG:EVENT_SCHEMA");
    expect(reason(withNote({ code: "SECRET_PATTERN_COUNT", stepId: null, detail: { notAClass: 3 } }))).toBe("E_INVALID_LOG:EVENT_SCHEMA");
    expect(reason(withNote({ code: "SECRET_PATTERN_COUNT", stepId: null, detail: {} }))).toBe("E_INVALID_LOG:EVENT_SCHEMA");
  });

  it("rejects a context id that is not the importer's own form", () => {
    const e = clone(base());
    const id = "SECRET PROMPT";
    e[0].payload.contexts[0].contextId = id;
    find(e, "StepStarted").payload.contextId = id;
    expect(reason(e)).toBe("E_INVALID_LOG:EVENT_SCHEMA");
  });

  it("enforces both modes: a hash-only run relabelled FULL is rejected", () => {
    const e = clone(base());
    e[0].payload.contentMode = "FULL";
    expect(reason(e)).toBe("E_INVALID_LOG:WITHHELD_IN_FULL_RUN");
    expect(reason(base())).toBe("OK");
  });

  it("requires the new unknownFields to be withheld too", () => {
    const events = importTraceBytes({
      spans: spansFile([span({ events: [{ timeUnixNano: "1", name: "e", extra: { a: 1 } }] })], { custom: 1 }, { name: "s", custom: 2 }),
      logs: logsFile([{ traceId: T, spanId: S, custom: 3 }]),
    });
    expect(reason(events)).toBe("OK");
    const leak = { v: { t: "s", v: "leak" } };
    const targets: Array<(e: any[]) => void> = [ // eslint-disable-line @typescript-eslint/no-explicit-any
      (e) => { e[0].payload.contexts[0].resource.unknownFields = leak; },
      (e) => { e[0].payload.contexts[0].scope.unknownFields = leak; },
      (e) => { find(e, "StepEnded").payload.events[0].unknownFields = leak; },
      (e) => { find(e, "LogRecorded").payload.unknownFields = leak; },
    ];
    for (const target of targets) {
      const e = clone(events);
      target(e);
      expect(reason(e)).toBe("E_INVALID_LOG:CONTENT_NOT_WITHHELD");
    }
  });
});

describe("finding 6: every valid import can be read back", () => {
  const dirOf = () => fresh("runs");

  it("round-trips a large header: one shared resource and 60 scopes in FULL mode", () => {
    const resource = { attributes: [sattr("service.name", "r".repeat(600_000))] };
    const scopes = Array.from({ length: 60 }, (_, i) => ({ scope: { name: `s${i}` }, spans: [span({ spanId: (i + 1).toString(16).padStart(16, "0") })] }));
    const events = importTraceBytes({ spans: enc({ resourceSpans: [{ resource, scopeSpans: scopes }] }), contentMode: "FULL" });
    const bytes = serializeRunLog(events);
    expect(bytes.length).toBeGreaterThan(32 * 1024 * 1024);
    expect(parseRunLog(bytes).length).toBe(events.length);
    const result = publishRun(events, { runsDirectory: dirOf(), checks: fake });
    expect(readRunLog(result.path, fake).length).toBe(events.length);
  }, 120_000);

  it("round-trips deeply nested unknown data in FULL mode", () => {
    let nested: unknown = "x";
    for (let i = 0; i < 40; i += 1) nested = [nested];
    const events = importTraceBytes({ spans: spansFile([span({ weird: nested })]), contentMode: "FULL" });
    expect(parseRunLog(serializeRunLog(events)).length).toBe(events.length);
    let objects: unknown = "x";
    for (let i = 0; i < 40; i += 1) objects = { k: objects };
    const events2 = importTraceBytes({ spans: spansFile([span({ weird: objects })]), contentMode: "FULL" });
    expect(parseRunLog(serializeRunLog(events2)).length).toBe(events2.length);
  });
});

describe("finding 7: resource and scope data is kept and takes part in duplicate identity", () => {
  it("keeps dropped counts and unknown resource and scope properties (FULL: readable, default: fingerprint only)", () => {
    const spans = spansFile([span()], { droppedAttributesCount: 4, entityRefs: [{ type: "SECRETENTITY" }] }, { name: "s", droppedAttributesCount: 5, extra: "SECRETSCOPE" });
    const full = importTraceBytes({ spans, contentMode: "FULL" });
    const text = JSON.stringify(full);
    expect(text.includes("SECRETENTITY") && text.includes("SECRETSCOPE")).toBe(true);
    const ctx = (full[0] as Extract<RunEvent, { type: "RunStarted" }>).payload.contexts[0];
    expect(ctx.resource.droppedAttributesCount).toBe(4);
    expect(ctx.scope.droppedAttributesCount).toBe(5);
    const hashed = JSON.stringify(importTraceBytes({ spans }));
    expect(hashed.includes("SECRETENTITY") || hashed.includes("SECRETSCOPE")).toBe(false);
    const notes = ofType(importTraceBytes({ spans }), "ImportNote").filter((n) => n.payload.code === "UNKNOWN_FIELD");
    expect(notes.length).toBe(1);
  });

  it("does not collapse spans whose resources differ only in dropped counts", () => {
    const spans = enc({ resourceSpans: [
      { resource: { droppedAttributesCount: 1 }, scopeSpans: [{ spans: [span()] }] },
      { resource: { droppedAttributesCount: 2 }, scopeSpans: [{ spans: [span()] }] },
    ] });
    expect(codeOf(() => importTraceBytes({ spans }))).toBe("E_CONFLICTING_DUPLICATE:");
  });
});

describe("finding 8: unknown log and span-event properties are kept", () => {
  it("keeps the value in FULL mode and only its fingerprint by default", () => {
    const request = { spans: spansFile([span({ events: [{ timeUnixNano: "1", name: "e", mystery: "SECRETEVENT" }], status: { code: 1, oddity: "SECRETSTATUS" }, links: [{ traceId: T, spanId: S, linkOdd: "SECRETLINK" }] })]),
      logs: logsFile([{ traceId: T, spanId: S, custom: { string: "SECRETLOG" } }]) };
    const full = JSON.stringify(importTraceBytes({ ...request, contentMode: "FULL" }));
    for (const s of ["SECRETEVENT", "SECRETSTATUS", "SECRETLINK", "SECRETLOG"]) expect(full.includes(s), s).toBe(true);
    const hashed = JSON.stringify(importTraceBytes(request));
    for (const s of ["SECRETEVENT", "SECRETSTATUS", "SECRETLINK", "SECRETLOG"]) expect(hashed.includes(s), s).toBe(false);
    const log = ofType(importTraceBytes(request), "LogRecorded")[0];
    expect(log.payload.unknownFields && "w" in log.payload.unknownFields).toBe(true);
  });
});

describe("findings 9 to 11", () => {
  it("9: counts only attribute parts in the withheld-attribute note", () => {
    const events = importTraceBytes({ spans: spansFile([span({ attributes: [sattr("custom.key", "v")], events: [{ timeUnixNano: "1", name: "event" }] })]) });
    const note = ofType(events, "ImportNote").find((n) => n.payload.code === "WITHHELD_ATTRIBUTE");
    const started = ofType(events, "StepStarted")[0].payload;
    const attr = started.attributes[0];
    const partBytes = (f: unknown) => ("w" in (f as object) ? (f as { w: { n: number } }).w.n : 0);
    expect(note?.payload.detail).toEqual({ count: 1, bytes: partBytes(attr.key) + partBytes(attr.value) });
  });

  it("10: the 20-digit rule covers decimals in kept unknown properties", () => {
    const raw = (token: string) => new TextEncoder().encode(`{"resourceSpans":[{"scopeSpans":[{"spans":[{"traceId":"${T}","spanId":"${S}","startTimeUnixNano":"1","weird":${token}}]}]}]}`);
    expect(codeOf(() => importTraceBytes({ spans: raw("0.123456789012345678901") }))).toBe("E_NUMBER:");
    expect(codeOf(() => importTraceBytes({ spans: raw("1.5e10") }))).toBe("OK");
    expect(codeOf(() => importTraceBytes({ spans: raw("12345678901234567890.5") }))).toBe("E_NUMBER:");
    expect(codeOf(() => importTraceBytes({ spans: raw("0.1234567890123456789") }))).toBe("OK");
  });

  it("11: all-zero link identifiers are rejected", () => {
    for (const link of [{ traceId: "0".repeat(32), spanId: S }, { traceId: T, spanId: "0".repeat(16) }]) {
      expect(codeOf(() => importTraceBytes({ spans: spansFile([span({ links: [link] })]) }))).toBe("E_ID:");
    }
    expect(codeOf(() => importTraceBytes({ spans: spansFile([span({ links: [{ traceId: T, spanId: S }] })]) }))).toBe("OK");
  });
});

describe("spec deviations reported by the review", () => {
  it("refuses to run on a platform where the checks cannot be provided", () => {
    const original = Object.getOwnPropertyDescriptor(process, "platform") as PropertyDescriptor;
    Object.defineProperty(process, "platform", { value: "linux" });
    try {
      expect(codeOf(() => defaultChecks())).toBe("E_PLATFORM:UNSUPPORTED_PLATFORM");
    } finally {
      Object.defineProperty(process, "platform", original);
    }
  });

  it("warns when the runs folder is under a synced root", () => {
    expect(syncedRootWarning(path.join(root, "OneDrive - Acme", "runs"))).toBe("RUNS_DIR_IN_SYNCED_FOLDER");
    expect(syncedRootWarning(path.join(root, "Dropbox", "x", "runs"))).toBe("RUNS_DIR_IN_SYNCED_FOLDER");
    expect(syncedRootWarning(path.join(root, "plain", "runs"))).toBeNull();
    vi.stubEnv("OneDrive", path.join(root, "myroot"));
    expect(syncedRootWarning(path.join(root, "myroot", "deep", "runs"))).toBe("RUNS_DIR_IN_SYNCED_FOLDER");
    vi.unstubAllEnvs();
  });

  it("reports the warning from publishRun and prints it in the command line", () => {
    const dir = path.join(root, "OneDrive - Test", `runs-${(counter += 1)}`);
    const events = importTraceBytes({ spans: spansFile([span()]) });
    expect(publishRun(events, { runsDirectory: dir, checks: fake }).warnings).toEqual(["RUNS_DIR_IN_SYNCED_FOLDER"]);
    const input = path.join(root, "cli-in.json");
    fs.writeFileSync(input, spansFile([span()]));
    let out = "";
    const code = runCli(["import", input], { out: (t) => { out += t; }, err: () => {} }, { runsDirectory: path.join(root, "OneDrive - Test", "runs-cli"), checks: fake });
    expect(code).toBe(0);
    expect(out).toContain("warning: RUNS_DIR_IN_SYNCED_FOLDER");
  });

  it("the persisted form of the new payload fields stays canonical", () => {
    const events = importTraceBytes({ spans: spansFile([span()], { droppedAttributesCount: 1 }), contentMode: "FULL" });
    for (const e of events) expect(canonicalJson(JSON.parse(canonicalJson(e)))).toBe(canonicalJson(e));
  });
});

// ---------------------------------------------------------------------------------------------------------
// Round 2 (review of commit 32743bd)
// ---------------------------------------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import { DEFAULT_STRUCTURE_LIMITS, DEFAULT_WORK_UNITS, parseLogsRequest, parseTraceRequest } from "../src/otlp-structure.js";
import { isTaggedValue, taggedValueSchema } from "../src/run-events.js";
import { parseStrictJson } from "../src/strict-json.js";

describe("round 2, finding 1: a shared resource is not expanded once per scope", () => {
  const spanN = (n: number) => span({ spanId: n.toString(16).padStart(16, "0") });
  const sharedResourceFile = (scopes: number, elements = 100_000) => enc({
    resourceSpans: [{
      resource: { custom: Array.from({ length: elements }, () => 0) },
      scopeSpans: Array.from({ length: scopes }, (_, i) => ({ scope: { name: `s${i}` }, spans: [spanN(i + 1)] })),
    }],
  });
  const json = (bytes: Uint8Array) => parseStrictJson(bytes, "parse");

  it("converts the resource once and shares it between its contexts", () => {
    const parsed = parseTraceRequest(json(sharedResourceFile(30)));
    expect(parsed.contexts.length).toBe(30);
    expect(parsed.contexts.every((c) => c.resource === parsed.contexts[0].resource)).toBe(true);
  });

  it("imports 100,000 resource elements under 200 scopes in a moment, with work that does not grow with the scope count", () => {
    const file = sharedResourceFile(200);
    expect(file.length).toBeLessThan(400_000);
    const started = performance.now();
    const events = importTraceBytes({ spans: file });
    expect(performance.now() - started).toBeLessThan(10_000);
    expect(ofType(events, "StepStarted").length).toBe(200);
  }, 60_000);

  it("in FULL mode the repeated resource is refused by the output budget instead of being built", () => {
    const file = sharedResourceFile(200);
    const started = performance.now();
    expect(codeOf(() => importTraceBytes({ spans: file, contentMode: "FULL" }))).toBe("E_LIMIT:OUTPUT_BYTES");
    expect(performance.now() - started).toBeLessThan(20_000);
  }, 60_000);

  it("stops at an explicit work budget, shared across both input files", () => {
    const attributes = Array.from({ length: 100 }, (_, i) => sattr(`k${i}`, "v"));
    const spans = json(spansFile([span({ attributes })]));
    const logs = json(logsFile([{ attributes }]));
    expect(codeOf(() => parseTraceRequest(spans, "s", DEFAULT_STRUCTURE_LIMITS, { remaining: 50 }))).toBe("E_LIMIT:WORK_BUDGET");
    const shared = { remaining: 150 };
    parseTraceRequest(spans, "s", DEFAULT_STRUCTURE_LIMITS, shared);
    expect(shared.remaining).toBe(50);
    expect(codeOf(() => parseLogsRequest(logs, "s", DEFAULT_STRUCTURE_LIMITS, shared))).toBe("E_LIMIT:WORK_BUDGET");
    expect(DEFAULT_WORK_UNITS).toBeGreaterThanOrEqual(2_000_000);
  });
});

describe("round 2, finding 2: output accounting counts complete persisted lines", () => {
  const spikeDir = new URL("../docs/development/spike-2026-10-13/traces/", import.meta.url);
  const read = (name: string) => new Uint8Array(readFileSync(new URL(name, spikeDir)));
  const shapes: Array<[string, () => Parameters<typeof importTraceBytes>[0]]> = [
    ["spike trace a", () => ({ spans: read("trace-a.json") })],
    ["spike trace d with logs", () => ({ spans: read("trace-d.json"), logs: read("trace-d.logs.json") })],
    ["30 logs of 1,024 attributes", () => {
      const attrs = Array.from({ length: 1024 }, (_, i) => sattr(`k${i}`, "v"));
      return { spans: spansFile([span()]), logs: logsFile(Array.from({ length: 30 }, (_, i) => ({ traceId: T, spanId: S, timeUnixNano: String(i + 1), attributes: attrs }))) };
    }],
    ["many scopes", () => ({ spans: enc({ resourceSpans: [{ resource: { attributes: [sattr("a", "b")] }, scopeSpans: Array.from({ length: 50 }, (_, i) => ({ scope: { name: `s${i}` }, spans: [span({ spanId: (i + 1).toString(16).padStart(16, "0") })] })) }] }) })],
  ];
  for (const mode of ["HASH_ONLY", "FULL"] as const) {
    it.each(shapes)(`${mode}: %s - the estimate is never below the real size and stays close to it`, (_name, make) => {
      const request = { ...make(), contentMode: mode };
      const events = importTraceBytes(request);
      const actual = serializeRunLog(events).length;
      expect(codeOf(() => importTraceBytes({ ...request, maxOutputBytes: actual - 1 }))).toBe("E_LIMIT:OUTPUT_BYTES");
      expect(codeOf(() => importTraceBytes({ ...request, maxOutputBytes: actual + 20 * events.length + 4000 }))).toBe("OK");
    }, 60_000);
  }

  it("refuses 327 logs of 1,024 attributes during emission, not after", () => {
    const attrs = Array.from({ length: 1024 }, (_, i) => sattr(`k${i}`, "v"));
    const logs = Array.from({ length: 327 }, (_, i) => ({ traceId: T, spanId: S, timeUnixNano: String(i + 1), attributes: attrs }));
    expect(codeOf(() => importTraceBytes({ spans: spansFile([span()]), logs: logsFile(logs) }))).toBe("E_LIMIT:OUTPUT_BYTES");
  }, 120_000);
});

describe("round 2: no recursion and maximum nesting", () => {
  it("validates a tagged value nested 200,000 levels without overflowing the stack", () => {
    let value: unknown = { t: "s", v: "leaf" };
    for (let i = 0; i < 200_000; i += 1) value = { t: "a", v: [value] };
    expect(isTaggedValue(value)).toBe(true);
    expect(taggedValueSchema.safeParse(value).success).toBe(true);
    let bad: unknown = { t: "i", v: "not a number" };
    for (let i = 0; i < 200_000; i += 1) bad = { t: "k", v: [["key", bad]] };
    expect(isTaggedValue(bad)).toBe(false);
  });

  it("round-trips unknown data nested to the deepest level the input rules allow, and refuses one level more", () => {
    // The value starts at depth 8 inside a span (request, list, group, list, group, list, span), and the limit is 64.
    const nest = (levels: number, kind: "array" | "object" | "mixed"): unknown => {
      let value: unknown = "x";
      for (let i = 0; i < levels; i += 1) value = kind === "array" || (kind === "mixed" && i % 2 === 0) ? [value] : { k: value };
      return value;
    };
    for (const kind of ["array", "object", "mixed"] as const) {
      const events = importTraceBytes({ spans: spansFile([span({ weird: nest(57, kind) })]), contentMode: "FULL" });
      expect(parseRunLog(serializeRunLog(events)).length, kind).toBe(events.length);
      expect(codeOf(() => importTraceBytes({ spans: spansFile([span({ weird: nest(58, kind) })]), contentMode: "FULL" })), kind).toBe("E_LIMIT:");
    }
  });
});
