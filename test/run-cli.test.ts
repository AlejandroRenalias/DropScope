import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { escapeForTerminal, runCli } from "../src/run-cli.js";
import type { PlatformChecks } from "../src/run-files.js";

const fake: PlatformChecks = { name: "fake", fileAttributes: () => 0, prepareRunsDirectory: () => {} };
const spikeDir = new URL("../docs/development/spike-2026-10-13/traces/", import.meta.url);
let root: string;
let runs: string;
let counter = 0;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "dropscope-cli-"));
  // Copy the real traces out of the repository so the test does not depend on where the repository lives.
  for (const name of ["trace-a.json", "trace-d.json", "trace-d.logs.json"]) fs.copyFileSync(new URL(name, spikeDir), path.join(root, name));
});
afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); });

function run(args: string[], runsDirectory = runs) {
  let out = "";
  let err = "";
  const code = runCli(args, { out: (t) => { out += t; }, err: (t) => { err += t; } }, { runsDirectory, checks: fake });
  return { code, out, err };
}
const newRuns = () => { runs = path.join(root, `runs-${(counter += 1)}`); return runs; };

describe("import", () => {
  it("imports a trace with its logs, then reports it as already imported on the second run", () => {
    newRuns();
    const args = ["import", path.join(root, "trace-d.json"), "--logs", path.join(root, "trace-d.logs.json")];
    const first = run(args);
    expect(first.code).toBe(0);
    expect(first.out).toMatch(/^Imported run [0-9a-f]{32}/);
    expect(first.out).toContain("content mode: HASH_ONLY");
    expect(first.out).toMatch(/steps: 56 {2}logs: 28/);
    expect(first.out).toMatch(/tokens: input \d+, output \d+/);
    expect(fs.readdirSync(runs).length).toBe(1);
    const second = run(args);
    expect(second.code).toBe(0);
    expect(second.out).toMatch(/^Already imported run/);
    expect(fs.readdirSync(runs).length).toBe(1);
  });

  it("keeps content out of the saved file by default and in it with --full", () => {
    newRuns();
    const original = JSON.parse(fs.readFileSync(path.join(root, "trace-a.json"), "utf8")) as { resourceSpans: Array<{ scopeSpans: Array<{ spans: Array<{ attributes?: Array<{ key: string; value: { stringValue?: string } }> }> }> }> };
    const prompts: string[] = [];
    for (const r of original.resourceSpans) for (const s of r.scopeSpans) for (const sp of s.spans) for (const a of sp.attributes ?? []) {
      if (a.key === "gen_ai.input.messages" && a.value.stringValue) prompts.push(JSON.stringify(a.value.stringValue.slice(0, 40)).slice(1, -1));
    }
    expect(prompts.length).toBeGreaterThan(0);
    expect(run(["import", path.join(root, "trace-a.json")]).code).toBe(0);
    expect(run(["import", path.join(root, "trace-a.json"), "--full"]).code).toBe(0);
    const texts = fs.readdirSync(runs).map((f) => fs.readFileSync(path.join(runs, f), "utf8"));
    const full = texts.filter((t) => t.includes('"contentMode":"FULL"'));
    const hashed = texts.filter((t) => t.includes('"contentMode":"HASH_ONLY"'));
    expect(full.length).toBe(1);
    expect(hashed.length).toBe(1);
    expect(full[0].includes(prompts[0])).toBe(true);
    for (const p of prompts) expect(hashed[0].includes(p), p).toBe(false);
  });

  it("fails with a closed error and writes nothing for bad input", () => {
    newRuns();
    const bad = path.join(root, "bad.json");
    fs.writeFileSync(bad, '{"resourceSpans": [secret-text');
    const result = run(["import", bad]);
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/^error: E_SYNTAX at stage parse-spans, byte \d+/);
    expect(result.err).not.toContain("secret-text");
    expect(fs.existsSync(runs) ? fs.readdirSync(runs) : []).toEqual([]);
    expect(run(["import", path.join(root, "missing.json")]).code).toBe(1);
  });

  it("fails closed on a multi-trace file unless a trace is chosen", () => {
    newRuns();
    const spans = (traceId: string, n: number) => ({ traceId, spanId: n.toString(16).padStart(16, "0"), name: "n", startTimeUnixNano: "1", endTimeUnixNano: "2" });
    const file = path.join(root, "two.json");
    const T1 = "1".repeat(32);
    const T2 = "2".repeat(32);
    fs.writeFileSync(file, JSON.stringify({ resourceSpans: [{ scopeSpans: [{ spans: [spans(T1, 1), spans(T2, 2)] }] }] }));
    expect(run(["import", file]).err).toContain("E_MULTIPLE_TRACES");
    expect(run(["import", file, "--trace", T2]).code).toBe(0);
    expect(run(["import", file, "--trace", "3".repeat(32)]).err).toContain("E_TRACE_NOT_FOUND");
  });

  it("prints usage and exits 2 for wrong arguments", () => {
    newRuns();
    for (const args of [[], ["nope"], ["import"], ["import", "a", "b"], ["import", "a", "--bogus"], ["import", "a", "--logs"], ["state"], ["state", "f", "--at", "x"]]) {
      const result = run(args);
      expect(result.code, args.join(" ")).toBe(2);
      expect(result.err).toContain("Usage:");
    }
  });
});

describe("state", () => {
  it("prints the recorded state at a step, defaulting to the last one", () => {
    newRuns();
    run(["import", path.join(root, "trace-d.json"), "--logs", path.join(root, "trace-d.logs.json")]);
    const file = path.join(runs, fs.readdirSync(runs)[0]);
    const last = JSON.parse(run(["state", file]).out);
    expect(last.at).toBe(last.of);
    expect(last.event).toBe("RunEnded");
    expect(last.state.ended).toBe(true);
    expect(last.state.openStepIds).toEqual([]);
    const middle = JSON.parse(run(["state", file, "--at", "40"]).out);
    expect(middle).toMatchObject({ at: 40, state: { sequenceNumber: 40, ended: false } });
    expect(BigInt(middle.state.inputTokens) <= BigInt(last.state.inputTokens)).toBe(true);
  });

  it("rejects an out-of-range step and a tampered or invalid file", () => {
    newRuns();
    run(["import", path.join(root, "trace-a.json")]);
    const file = path.join(runs, fs.readdirSync(runs)[0]);
    expect(run(["state", file, "--at", "0"]).code).toBe(2);
    expect(run(["state", file, "--at", "99999999"]).code).toBe(2);
    const tampered = path.join(root, "tampered.runlog.jsonl");
    fs.writeFileSync(tampered, fs.readFileSync(file, "utf8").replace("\n", "\n\n"));
    const result = run(["state", tampered]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("E_INVALID_LOG");
  });
});

describe("terminal safety", () => {
  it("escapes control characters and bidirectional overrides", () => {
    expect(escapeForTerminal("a\u001b[31mb‮c\nd\u0007")).toBe("a\\u{1b}[31mb\\u{202e}c\\u{a}d\\u{7}");
    expect(escapeForTerminal("plain text.json")).toBe("plain text.json");
  });
});
