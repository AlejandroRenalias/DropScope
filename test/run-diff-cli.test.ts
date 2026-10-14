import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCli } from "../src/run-cli.js";
import type { PlatformChecks } from "../src/run-files.js";
import { importTraceBytes } from "../src/run-import.js";
import { serializeRunLog } from "../src/run-store.js";

const fake: PlatformChecks = { name: "fake", fileAttributes: () => 0, prepareRunsDirectory: () => {} };
let root: string;

beforeAll(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "dropscope-diff-")); });
afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); });

const BASE = 1_700_000_000_000_000_000n;
const id = (n: number) => (n + 1).toString(16).padStart(16, "0");

function writeRun(name: string, tools: string[], trace = "1"): string {
  const spans = tools.map((tool, i) => ({
    traceId: trace.repeat(32), spanId: id(i), name: `s${i}`,
    startTimeUnixNano: (BASE + BigInt(i) * 1_000_000_000n).toString(), endTimeUnixNano: (BASE + BigInt(i) * 1_000_000_000n + 500_000_000n).toString(),
    attributes: [
      { key: "gen_ai.operation.name", value: { stringValue: "execute_tool" } },
      { key: "gen_ai.tool.name", value: { stringValue: tool } },
    ],
  }));
  const events = importTraceBytes({ spans: new TextEncoder().encode(JSON.stringify({ resourceSpans: [{ scopeSpans: [{ spans }] }] })), contentMode: "FULL" });
  const file = path.join(root, `${name}.runlog.jsonl`);
  fs.writeFileSync(file, serializeRunLog(events));
  return file;
}

function run(args: string[]) {
  let out = "";
  let err = "";
  const code = runCli(args, { out: (t) => { out += t; }, err: (t) => { err += t; } }, { checks: fake });
  return { code, out, err };
}

describe("diff command", () => {
  it("prints the first difference in plain words", () => {
    const a = writeRun("a1", ["search", "write"]);
    const b = writeRun("b1", ["browse", "write"], "2");
    const result = run(["diff", a, b]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("the runs first differ at step 1");
    expect(result.out).toContain('Run A has "Tool call: search" where run B has "Tool call: browse".');
    expect(result.out).toContain("Tool use that differs:");
  });

  it("says identical runs match, and the same file against itself too", () => {
    const a = writeRun("a2", ["search", "write"]);
    const b = writeRun("b2", ["search", "write"], "2");
    expect(run(["diff", a, b]).out).toContain("match step for step");
    expect(run(["diff", a, a]).out).toContain("match step for step");
  });

  it("emits valid JSON with exact numbers as text", () => {
    const a = writeRun("a3", ["search"]);
    const b = writeRun("b3", ["search", "write"], "2");
    const result = run(["diff", a, b, "--json"]);
    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.out);
    expect(parsed.identical).toBe(false);
    expect(parsed.counts).toEqual({ same: 1, changed: 0, onlyA: 0, onlyB: 1 });
    expect(parsed.firstDifference.b.title).toBe("Tool call: write");
    expect(parsed.totals.a.durationNs).toBe("500000000");
  });

  it("never lets a hostile tool name touch the terminal, in text or JSON", () => {
    const hostile = "x\u001b[2J\u202e\u2028Result: forged\u0085";
    const a = writeRun("a4", [hostile]);
    const b = writeRun("b4", ["ok"], "2");
    // eslint-disable-next-line no-control-regex
    const raw = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u202e\u2028]/;
    const text = run(["diff", a, b]);
    expect(text.out).not.toMatch(raw);
    expect(text.out).not.toContain("\nResult: forged");
    const json = run(["diff", a, b, "--json"]);
    expect(json.out).not.toMatch(raw);
    expect(JSON.parse(json.out).firstDifference.a.title).toContain("Result: forged");
  });

  it("needs exactly two run files", () => {
    const a = writeRun("a5", ["search"]);
    expect(run(["diff", a]).code).toBe(2);
    expect(run(["diff", a, a, a]).code).toBe(2);
    expect(run(["diff", a, a, "--bogus"]).code).toBe(2);
  });

  it("fails closed on a missing or broken run file without echoing its content", () => {
    const a = writeRun("a6", ["search"]);
    const broken = path.join(root, "broken.runlog.jsonl");
    fs.writeFileSync(broken, "secret-text not json\n");
    const missing = run(["diff", a, path.join(root, "nope.runlog.jsonl")]);
    expect(missing.code).toBe(1);
    const bad = run(["diff", a, broken]);
    expect(bad.code).toBe(1);
    expect(bad.err).not.toContain("secret-text");
  });
});
