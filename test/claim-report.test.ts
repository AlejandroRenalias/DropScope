import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkClaims, parseClaimText, type Claim } from "../src/claim-check.js";
import { CLAIM_NOTE, claimCaveats, claimReportLines, claimSummary, describeClaimResult } from "../src/claim-report.js";
import { buildRunModel } from "../src/frontend/run-replay-model.js";
import { importTraceBytes } from "../src/run-import.js";
import { EXAMPLE_CLAIMS } from "../src/frontend/claim-check-panel.js";
import { parseRunLog } from "../src/run-log-format.js";
import { runCli } from "../src/run-cli.js";
import type { PlatformChecks } from "../src/run-files.js";
import { serializeRunLog } from "../src/run-store.js";

const fake: PlatformChecks = { name: "fake", fileAttributes: () => 0, prepareRunsDirectory: () => {} };
const T = "1".repeat(32);
const enc = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const s = (key: string, value: string) => ({ key, value: { stringValue: value } });
const BASE = 1_700_000_000_000_000_000n;
const ns = (n: number) => (BASE + BigInt(n * 1_000_000_000)).toString();
const span = (i: number, name: string, tool: string, result: string, error = false) => ({
  traceId: T, spanId: (i + 1).toString(16).padStart(16, "0"), name, startTimeUnixNano: ns(i), endTimeUnixNano: ns(i + 1),
  ...(error ? { status: { code: 2 } } : {}),
  attributes: [s("gen_ai.operation.name", "execute_tool"), s("gen_ai.tool.name", tool), s("gen_ai.tool.call.result", result)],
});
const traceBytes = (spans: unknown[]) => enc({ resourceSpans: [{ scopeSpans: [{ spans }] }] });
const tracefile = () => traceBytes([
  span(0, "a", "lookup", "total is 59.0"),
  span(1, "b", "pay", "declined", true),
  span(2, "c", "pay", "accepted 59.0"),
]);

const claim = (over: Partial<Claim> = {}): Claim => ({
  id: "c1", text: "the total was 59.0", tool: "lookup", stepId: null, field: "result", mustContain: ["59.0"], caseSensitive: true, atEvent: null, ...over,
});

describe("claim report sentences", () => {
  const model = buildRunModel(importTraceBytes({ spans: tracefile(), contentMode: "FULL" }));
  const hashedModel = buildRunModel(importTraceBytes({ spans: tracefile() }));
  const titleOf = (stepId: string) => model.stepsById.get(stepId)?.title ?? "a step";
  const say = (c: Claim, m = model) => {
    const check = checkClaims(m.events, [c]);
    return describeClaimResult(check.results[0], (id) => m.stepsById.get(id)?.title ?? "a step", check.knownTools, check.knownToolsTotal);
  };

  it("says where the text was found, in the words of the run", () => {
    expect(say(claim())).toBe("The text you listed appears in the recorded result of Tool call: lookup, recorded at event 4.");
    expect(say(claim({ mustContain: ["total", "59.0"] }))).toContain("All 2 texts you listed appear in the recorded result of Tool call: lookup");
  });

  it("mentions several matching steps and a failed step", () => {
    expect(say(claim({ tool: "pay", mustContain: ["59"] }))).toContain("(2 steps matched; this is the first that supports it)");
    expect(say(claim({ tool: "pay", mustContain: ["declined"] }))).toContain("That step ended with an error, so treat this evidence with care.");
  });

  it("says what is missing, what is absent, what is late and what is unreadable", () => {
    expect(say(claim({ mustContain: ["59.0", "refunded"] }))).toBe('The recorded result of Tool call: lookup was read, but this text does not appear in it: "refunded".');
    expect(say(claim({ mustContain: ["q", "z"] }))).toContain('these texts do not appear in it: "q", "z"');
    expect(say(claim({ tool: "nope" }))).toBe('No step in this run matches a tool named "nope", so nothing recorded could support this claim. Tools in this run: "lookup", "pay".');
    expect(say(claim({ tool: null, stepId: "f".repeat(16) }))).toContain(`the id ${"f".repeat(16)}`);
    expect(say(claim({ atEvent: 2 }))).toBe("The result of Tool call: lookup was only recorded at event 4, after event 2 where the claim was made, so it cannot have supported it.");
    expect(say(claim(), hashedModel)).toContain("Cannot check: this run was imported without content");
    expect(say(claim(), hashedModel)).toContain("--full");
    expect(say(claim({ field: "arguments" }))).toBe("Cannot check: the trace did not record the arguments of Tool call: lookup.");
  });

  it("shortens long quoted texts and says 'and N more' for many tools", () => {
    const long = "x".repeat(200);
    expect(say(claim({ mustContain: [long] }))).toContain(`"${"x".repeat(80)}…"`);
    const many = buildRunModel(importTraceBytes({ spans: traceBytes(Array.from({ length: 14 }, (_, i) => span(i, `n${i}`, `tool${i}`, "r"))), contentMode: "FULL" }));
    expect(say(claim({ tool: "nope" }), many)).toContain("and 4 more.");
  });

  it("always carries the honest caveats, and the extra ones that apply", () => {
    const full = claimCaveats(checkClaims(model.events, [claim()])).join(" ");
    expect(full).toContain("does not prove the claim is true");
    expect(full).toContain("never uses a model");
    expect(full).not.toContain("keeps no content");
    const hashed = claimCaveats(checkClaims(hashedModel.events, [claim()])).join(" ");
    expect(hashed).toContain("keeps no content");
    expect(hashed).toContain("1 claim could not be checked");
  });

  it("writes a full report that starts with the plain note and a count", () => {
    const check = checkClaims(model.events, [claim(), claim({ id: "c2", text: "refunded", mustContain: ["refunded"] }), claim({ id: "c3", field: "arguments" })]);
    expect(claimSummary(check)).toBe("1 supported, 1 not supported, 1 cannot be checked (of 3).");
    const text = claimReportLines(check, titleOf).join("\n");
    expect(text.startsWith(CLAIM_NOTE)).toBe(true);
    expect(text).toContain("[Supported] c1: the total was 59.0");
    expect(text).toContain("[Not supported] c2: refunded");
    expect(text).toContain("[Cannot check] c3:");
  });
});

describe("claims command", () => {
  let root: string;
  let runs: string;
  const files = { claims: "", hashed: "", full: "" };
  const claimsJson = (claims: unknown) => JSON.stringify({ claims });

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "dropscope-claims-"));
    runs = path.join(root, "runs");
    files.full = path.join(root, "full.runlog.jsonl");
    files.hashed = path.join(root, "hashed.runlog.jsonl");
    fs.writeFileSync(files.full, serializeRunLog(importTraceBytes({ spans: tracefile(), contentMode: "FULL" })));
    fs.writeFileSync(files.hashed, serializeRunLog(importTraceBytes({ spans: tracefile() })));
    files.claims = path.join(root, "claims.json");
    fs.writeFileSync(files.claims, claimsJson([
      { id: "total", text: "The total was 59.0", tool: "lookup", mustContain: ["59.0"] },
      { id: "refund", text: "The refund was accepted", tool: "pay", mustContain: ["accepted"] },
      { id: "shipped", text: "The order shipped", tool: "lookup", mustContain: ["shipped"] },
    ]));
  });
  afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); });

  const cli = (args: string[]) => {
    let out = "";
    let err = "";
    const code = runCli(args, { out: (t) => { out += t; }, err: (t) => { err += t; } }, { runsDirectory: runs, checks: fake });
    return { code, out, err };
  };
  const write = (name: string, text: string | Uint8Array) => { const p = path.join(root, name); fs.writeFileSync(p, text); return p; };

  it("reports each claim in plain words", () => {
    const r = cli(["claims", files.full, "--claims", files.claims]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Result: 2 supported, 1 not supported, 0 cannot be checked (of 3).");
    expect(r.out).toContain("[Supported] total: The total was 59.0");
    expect(r.out).toContain("[Not supported] shipped: The order shipped");
    expect(r.out).toContain('this text does not appear in it: "shipped"');
  });

  it("says cannot check for a run saved without content, and suggests --full", () => {
    const r = cli(["claims", files.hashed, "--claims", files.claims]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("0 supported, 0 not supported, 3 cannot be checked");
    expect(r.out).toContain("--full");
  });

  it("writes JSON for scripts", () => {
    const r = cli(["claims", files.full, "--claims", files.claims, "--json"]);
    const parsed = JSON.parse(r.out) as { counts: unknown; contentMode: string; results: Array<{ id: string; verdict: string; reason: string; evidenceEvent: number | null }> };
    expect(parsed.contentMode).toBe("FULL");
    expect(parsed.counts).toEqual({ supported: 2, notSupported: 1, cannotCheck: 0 });
    expect(parsed.results.map((x) => [x.id, x.verdict, x.reason])).toEqual([["total", "SUPPORTED", "FOUND"], ["refund", "SUPPORTED", "FOUND"], ["shipped", "NOT_SUPPORTED", "NOT_FOUND"]]);
    expect(typeof parsed.results[0].evidenceEvent).toBe("number");
  });

  it("refuses a bad claims file with exit code 2 and says what is wrong, without running anything", () => {
    const bad = write("bad-claims.json", claimsJson([{ id: "x", text: "t", tool: "lookup", mustContain: ["a"], typo: 1 }]));
    const r = cli(["claims", files.full, "--claims", bad]);
    expect(r.code).toBe(2);
    expect(r.out).toBe("");
    expect(r.err).toContain('error: Claim 1 (x): unknown field "typo"');
    const broken = write("broken-claims.json", "{");
    expect(cli(["claims", files.full, "--claims", broken]).err).toContain("not valid JSON");
  });

  it("needs both a run file and --claims, and fails closed on a missing or invalid file", () => {
    expect(cli(["claims", files.full]).code).toBe(2);
    expect(cli(["claims", "--claims", files.claims]).code).toBe(2);
    expect(cli(["claims", files.full, "--claims", files.claims, "--claims", files.claims]).code).toBe(2);
    expect(cli(["claims", path.join(root, "missing.jsonl"), "--claims", files.claims]).code).toBe(1);
    expect(cli(["claims", files.full, "--claims", path.join(root, "missing.json")]).code).toBe(1);
    const notARun = write("not-a-run.jsonl", "{\"hello\":1}\n");
    const r = cli(["claims", notARun, "--claims", files.claims]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/^error: /);
  });

  it("cannot be used to reach a terminal: tool names, titles and claim text are escaped", () => {
    const esc = "\u001b[2J";
    const hostile = write("hostile.runlog.jsonl", serializeRunLog(importTraceBytes({
      spans: traceBytes([span(0, "a", `evil${esc}tool‮`, "total is 59.0")]), contentMode: "FULL",
    })));
    const claims = write("hostile-claims.json", claimsJson([
      { id: "a", text: `forged${esc}\nResult: 99 supported`, tool: `evil${esc}tool‮`, mustContain: ["59.0"] },
      { id: "b", text: "missing tool", tool: "nothing", mustContain: ["x"] },
    ]));
    const r = cli(["claims", hostile, "--claims", claims]);
    expect(r.code).toBe(0);
    // eslint-disable-next-line no-control-regex
    expect(r.out).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f‪-‮]/);
    // The forged line is one escaped line, not a second "Result:" line.
    expect(r.out.split("\n").filter((line) => line.startsWith("Result:"))).toHaveLength(1);
    expect(r.out).toContain("\\u{1b}[2J");
  });

  it("is listed in the usage text", () => {
    const r = cli([]);
    expect(r.err).toContain("claims <run.runlog.jsonl> --claims <claims.json>");
  });
});

describe("the example on the screen", () => {
  const asset = (name: string) => new Uint8Array(fs.readFileSync(new URL(`../src/frontend/assets/${name}`, import.meta.url)));
  const example = parseClaimText(EXAMPLE_CLAIMS);

  it("is a valid claims file", () => {
    expect(example.errors).toEqual([]);
    expect(example.claims).toHaveLength(3);
  });

  it("gives two supported and one not supported on the demo run with content stored", () => {
    const check = checkClaims(buildRunModel(parseRunLog(asset("demo-run-full.runlog.jsonl"))).events, example.claims);
    expect(check.results.map((r) => [r.claim.id, r.verdict])).toEqual([["order-total", "SUPPORTED"], ["refund-accepted", "SUPPORTED"], ["order-delivered", "NOT_SUPPORTED"]]);
    // issue_refund ran twice: the first call timed out, the second was accepted, so the claim is supported by the second.
    expect(check.results[1].stepsChecked).toBe(2);
  });

  it("says cannot check for all three on the default demo run (content withheld)", () => {
    const check = checkClaims(buildRunModel(parseRunLog(asset("demo-run.runlog.jsonl"))).events, example.claims);
    expect(check.results.map((r) => r.verdict)).toEqual(["CANNOT_CHECK", "CANNOT_CHECK", "CANNOT_CHECK"]);
  });
});

describe("a typed claims text", () => {
  it("reads the same as a file", () => {
    expect(parseClaimText('{"claims":[{"id":"a","text":"t","tool":"x","mustContain":["y"]}]}').claims).toHaveLength(1);
  });
});
