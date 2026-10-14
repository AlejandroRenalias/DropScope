// Regression tests for the findings of the final whole-project review (Opus 5.5 and Sol 6.1, commit 99bc048).
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { checkClaims, type Claim } from "../src/claim-check.js";
import { buildRunModel, describeNote } from "../src/frontend/run-replay-model.js";
import { runCli } from "../src/run-cli.js";
import { diffRuns } from "../src/run-diff.js";
import { importTraceBytes } from "../src/run-import.js";
import { parseRunLog } from "../src/run-log-format.js";

const BASE = 1_700_000_000_000_000_000n;
const ns = (seconds: number): string => (BASE + BigInt(Math.round(seconds * 1e9))).toString();
const attr = (key: string, value: string) => ({ key, value: { stringValue: value } });

function runOf(tools: string[], mode: "FULL" | "HASH_ONLY", result = "result") {
  const spans = tools.map((tool, i) => ({
    traceId: "1".repeat(32), spanId: (i + 1).toString(16).padStart(16, "0"), name: `s${i}`,
    startTimeUnixNano: ns(i), endTimeUnixNano: ns(i + 1),
    attributes: [attr("gen_ai.operation.name", "execute_tool"), attr("gen_ai.tool.name", tool), attr("gen_ai.tool.call.result", result)],
  }));
  return importTraceBytes({ spans: new TextEncoder().encode(JSON.stringify({ resourceSpans: [{ scopeSpans: [{ spans }] }] })), contentMode: mode });
}
const claim = (over: Partial<Claim> = {}): Claim => ({
  id: "c1", text: "a claim", tool: "tool with spaces", stepId: null, field: "result", mustContain: ["result"], caseSensitive: true, atEvent: null, ...over,
});

describe("claim check: a tool name that the run file withheld", () => {
  it("is supported with content stored but cannot be checked when the tool name was kept only as a fingerprint", () => {
    expect(checkClaims(runOf(["tool with spaces"], "FULL"), [claim()]).results[0]).toMatchObject({ verdict: "SUPPORTED" });
    expect(checkClaims(runOf(["tool with spaces"], "HASH_ONLY"), [claim()]).results[0]).toMatchObject({ verdict: "CANNOT_CHECK", reason: "TOOL_NAME_WITHHELD" });
  });

  it("also cannot be checked when another step of the claimed tool was readable but lacked the text", () => {
    const events = runOf(["lookup", "tool with spaces"], "HASH_ONLY");
    expect(checkClaims(events, [claim({ tool: "lookup", mustContain: ["x"] })]).results[0]).toMatchObject({ verdict: "CANNOT_CHECK" });
  });

  it("still says not supported for a missing tool when every tool name in the run is readable", () => {
    expect(checkClaims(runOf(["lookup"], "HASH_ONLY"), [claim({ tool: "nothing" })]).results[0]).toMatchObject({ verdict: "NOT_SUPPORTED", reason: "NO_MATCHING_STEP" });
  });
});

describe("run diff: tool use is counted by the recorded tool name", () => {
  it("shows no tool-use difference for the same trace kept with and without content", () => {
    const r = diffRuns(buildRunModel(runOf(["tool with spaces"], "FULL")), buildRunModel(runOf(["tool with spaces"], "HASH_ONLY")));
    expect(r.identical).toBe(true);
    expect(r.tools).toEqual([]);
  });

  it("tells apart two tools whose names share the first 80 characters", () => {
    const long = "x".repeat(90);
    const r = diffRuns(buildRunModel(runOf([`${long}x`], "FULL")), buildRunModel(runOf([`${long}y`], "FULL")));
    expect(r.counts.onlyA).toBe(1);
    expect(r.tools.map((t) => [t.a, t.b])).toEqual([[0, 1], [1, 0]]);
  });

  it("keeps the real totals when a run is too large to compare", () => {
    const many = Array.from({ length: 5001 }, () => "t");
    const r = diffRuns(buildRunModel(runOf(many, "HASH_ONLY")), buildRunModel(runOf(["t"], "HASH_ONLY")));
    expect(r.tooLarge).toBe(true);
    expect(r.totals.a.steps).toBe(5001);
    expect(r.totals.b.steps).toBe(1);
  });
});

describe("run file header fields cannot carry free text", () => {
  const demo = fs.readFileSync(new URL("../src/frontend/assets/demo-run.runlog.jsonl", import.meta.url), "utf8").trimEnd().split("\n");
  const tamper = (edit: (payload: Record<string, any>) => void): Uint8Array => {
    const header = JSON.parse(demo[0]);
    edit(header.payload);
    return new TextEncoder().encode([JSON.stringify(header), ...demo.slice(1)].join("\n") + "\n");
  };
  const note = "Patient Jane Doe DOB 1980-01-02";

  it("accepts the real demo file", () => {
    expect(() => parseRunLog(new TextEncoder().encode(demo.join("\n") + "\n"))).not.toThrow();
  });

  it.each([
    ["importer.id", (p: Record<string, any>) => { p.importer.id = note; }],
    ["importer.version", (p: Record<string, any>) => { p.importer.version = note; }],
    ["conventionVersion", (p: Record<string, any>) => { p.conventionVersion = note; }],
    ["limitsVersion", (p: Record<string, any>) => { p.limitsVersion = note; }],
  ])("refuses free text in %s", (_name, edit) => {
    expect(() => parseRunLog(tamper(edit))).toThrow();
  });
});

describe("the secret-text note tells the truth about the content mode", () => {
  it("says the text was not kept only when the run keeps no content", () => {
    expect(describeNote("SECRET_PATTERN_COUNT", { email: 1 }, "HASH_ONLY")).toContain("The text itself was not kept.");
    expect(describeNote("SECRET_PATTERN_COUNT", { email: 1 }, "FULL")).not.toContain("not kept");
    expect(describeNote("SECRET_PATTERN_COUNT", { email: 1 }, "FULL")).toContain("was kept");
    const full = buildRunModel(parseRunLog(fs.readFileSync(new URL("../src/frontend/assets/demo-run-full.runlog.jsonl", import.meta.url))));
    expect(full.notes.find((n) => n.code === "SECRET_PATTERN_COUNT")?.text).not.toContain("not kept");
  });
});

describe("command line seams", () => {
  const demoPath = new URL("../src/frontend/assets/demo-run.runlog.jsonl", import.meta.url);
  const fake = { name: "fake", fileAttributes: () => 0, prepareRunsDirectory: () => {} };
  const run = (args: string[], checks?: typeof fake) => {
    let out = "";
    let err = "";
    const code = runCli(args, { out: (t) => { out += t; }, err: (t) => { err += t; } }, checks ? { checks } : {});
    return { code, out, err };
  };

  it("says a step number is out of range instead of blaming the file", () => {
    const file = decodeURIComponent(demoPath.pathname.replace(/^\//, ""));
    for (const at of ["0", "99"]) {
      const r = run(["state", file, "--at", at], fake);
      expect(r.code, at).toBe(2);
      expect(r.err, at).toContain("--at must be a number from 1 to 42");
      expect(r.err, at).not.toContain("E_INVALID_LOG");
    }
  });

  it("refuses cleanly on a platform other than Windows, for every command", () => {
    const original = Object.getOwnPropertyDescriptor(process, "platform") as PropertyDescriptor;
    Object.defineProperty(process, "platform", { value: "linux" });
    try {
      for (const args of [["state", "x"], ["budget", "x", "--max-steps", "1"], ["claims", "x", "--claims", "y"], ["diff", "x", "y"], ["import", "x"]]) {
        const r = run(args);
        expect(r.code, args[0]).toBe(1);
        expect(r.err, args[0]).toMatch(/^error: /);
      }
    } finally {
      Object.defineProperty(process, "platform", original);
    }
  });
});
