// Regression tests for the findings of the final whole-project review (Opus 5.5 and Sol 6.1, commit 99bc048).
import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { checkClaims, type Claim } from "../src/claim-check.js";
import { explainLoadError } from "../src/frontend/load-error.js";
import { buildRunModel, describeNote } from "../src/frontend/run-replay-model.js";
import { runCli } from "../src/run-cli.js";
import { diffRuns } from "../src/run-diff.js";
import { ImportError } from "../src/run-import-error.js";
import { importTraceBytes } from "../src/run-import.js";
import { safeResolve } from "../src/run-files.js";
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

  it("keeps a definite too-late answer when the nameless step recorded its content only after the cutoff", () => {
    const events = runOf(["lookup", "tool with spaces"], "HASH_ONLY");
    const contentEvents = events.filter((e) => e.type === "ContentRecorded").map((e) => e.sequenceNumber);
    const cutoff = contentEvents[0] - 1; // before the readable tool's content, so everything arrives too late
    expect(checkClaims(events, [claim({ tool: "lookup", atEvent: cutoff })]).results[0]).toMatchObject({ verdict: "NOT_SUPPORTED", reason: "TOO_LATE" });
  });

  it("keeps the doubt when the nameless step never recorded the claimed field", () => {
    const span = {
      traceId: "1".repeat(32), spanId: "0000000000000001", name: "s", startTimeUnixNano: ns(0), endTimeUnixNano: ns(1),
      attributes: [attr("gen_ai.operation.name", "execute_tool"), attr("gen_ai.tool.name", "tool with spaces")],
    };
    const bytes = new TextEncoder().encode(JSON.stringify({ resourceSpans: [{ scopeSpans: [{ spans: [span] }] }] }));
    for (const mode of ["HASH_ONLY", "FULL"] as const) {
      const events = importTraceBytes({ spans: bytes, contentMode: mode });
      expect(checkClaims(events, [claim({ mustContain: ["x"] })]).results[0].verdict, mode).toBe("CANNOT_CHECK");
    }
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

  it("counts every tool name a step records, so a changed second name is still a difference", () => {
    const twoNames = (second: string) => {
      const span = {
        traceId: "1".repeat(32), spanId: "0000000000000001", name: "s", startTimeUnixNano: ns(0), endTimeUnixNano: ns(1),
        attributes: [attr("gen_ai.operation.name", "execute_tool"), attr("gen_ai.tool.name", "0 hidden"), attr("gen_ai.tool.name", second)],
      };
      return buildRunModel(importTraceBytes({ spans: new TextEncoder().encode(JSON.stringify({ resourceSpans: [{ scopeSpans: [{ spans: [span] }] }] })), contentMode: "HASH_ONLY" }));
    };
    const r = diffRuns(twoNames("lookup"), twoNames("write"));
    expect(r.tools.length).toBe(2);
    expect(diffRuns(twoNames("lookup"), twoNames("lookup")).tools).toEqual([]);
  });

  it("does not depend on the order in which a step recorded its tool names, but counts repeats", () => {
    const names = (list: string[]) => {
      const span = {
        traceId: "1".repeat(32), spanId: "0000000000000001", name: "s", startTimeUnixNano: ns(0), endTimeUnixNano: ns(1),
        attributes: [attr("gen_ai.operation.name", "execute_tool"), ...list.map((n) => attr("gen_ai.tool.name", n))],
      };
      return buildRunModel(importTraceBytes({ spans: new TextEncoder().encode(JSON.stringify({ resourceSpans: [{ scopeSpans: [{ spans: [span] }] }] })), contentMode: "FULL" }));
    };
    expect(diffRuns(names(["lookup", "alpha", "beta"]), names(["lookup", "beta", "alpha"])).tools).toEqual([]);
    expect(diffRuns(names(["lookup", "alpha"]), names(["lookup", "alpha", "alpha"])).tools.length).toBe(2);
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

describe("path rules, resolved form", () => {
  it.skipIf(process.platform !== "win32")("refuses a relative path that resolves onto a network share, before any file-system call", () => {
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(String.raw`\\server\share\project`);
    const touched = vi.spyOn(fs, "lstatSync");
    try {
      let reason = "";
      try { safeResolve("a/b", true); } catch (error) { reason = `${(error as ImportError).code}:${(error as ImportError).reason}`; }
      expect(reason).toBe("E_PATH:UNC_OR_DEVICE_PATH");
      expect(touched).not.toHaveBeenCalled();
    } finally {
      cwd.mockRestore();
      touched.mockRestore();
    }
  });
});

describe("load errors say what happened", () => {
  it("tells apart a full-content file holding withheld values from a withheld-content file holding plaintext", () => {
    const fullWithWithheld = explainLoadError(new ImportError("E_INVALID_LOG", "reduce", null, "WITHHELD_IN_FULL_RUN at event 3"));
    const hashWithPlaintext = explainLoadError(new ImportError("E_INVALID_LOG", "reduce", null, "CONTENT_NOT_WITHHELD at event 3"));
    expect(fullWithWithheld).toContain("keeps its content but holds withheld values");
    expect(hashWithPlaintext).toContain("claims to hide its content but does not");
    expect(fullWithWithheld).not.toBe(hashWithPlaintext);
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
