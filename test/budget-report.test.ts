import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseBudgetPolicy, replayBudget } from "../src/budget-replay.js";
import { activeLimits, budgetCaveats, budgetReportLines, describeBreach, describeRemainder, formatSeconds, gaugesAt, group } from "../src/budget-report.js";
import { runCli } from "../src/run-cli.js";
import type { PlatformChecks } from "../src/run-files.js";
import { importTraceBytes } from "../src/run-import.js";
import { serializeRunLog } from "../src/run-store.js";
import { buildRunModel, loadRunFromBytes } from "../src/frontend/run-replay-model.js";
import { readFileSync } from "node:fs";

const demoUrl = new URL("../src/frontend/assets/demo-run.runlog.jsonl", import.meta.url);
const model = loadRunFromBytes(new Uint8Array(readFileSync(demoUrl)));
const titleOf = (id: string) => model.stepsById.get(id)?.title ?? "a step";
const policy = (input: Parameters<typeof parseBudgetPolicy>[0]) => {
  const parsed = parseBudgetPolicy(input);
  if (!parsed.policy) throw new Error(parsed.errors.join("; "));
  return parsed.policy;
};
const run = (input: Parameters<typeof parseBudgetPolicy>[0]) => replayBudget(model.events, policy(input));

describe("budget report wording", () => {
  it("formats numbers and seconds exactly", () => {
    expect(group(1234567n)).toBe("1,234,567");
    expect(formatSeconds(8_200_000_000n)).toBe("8.2 s");
    expect(formatSeconds(1_000_000_000n)).toBe("1 s");
    expect(formatSeconds(1n)).toBe("0.000000001 s");
  });

  it("says in a sentence where a token limit fires, after the call, naming the step", () => {
    const r = run({ maxTotalTokens: "4000" });
    expect(r.first?.breachEvent).toBe(31);
    const text = describeBreach(r.first!, r.policy, model.events, titleOf);
    expect(text).toContain("After Model call: chat sim-model-1 finished");
    expect(text).toContain("4,065 tokens");
    expect(text).toContain("over your limit of 4,000 tokens");
    expect(text).toContain("would have stopped the agent here");
  });

  it("says a count limit stops the step before it starts", () => {
    const r = run({ maxModelCalls: "2" });
    const text = describeBreach(r.first!, r.policy, model.events, titleOf);
    expect(text).toMatch(/would have been number 3, over your limit of 2 model calls, so it would not have started/);
  });

  it("says a time limit is measured from the first step and names the moment", () => {
    const text = describeBreach(run({ maxSeconds: "5" }).first!, policy({ maxSeconds: "5" }), model.events, titleOf);
    expect(text).toMatch(/into the run, past your limit of 5 s/);
    expect(text).toContain("The agent would have been stopped before that");
  });

  it("lists what would not have happened, in steps, calls and tokens, and separates running steps", () => {
    const r = run({ maxTotalTokens: "2000" });
    const lines = describeRemainder(r, titleOf);
    expect(lines.notStarted[0]).toMatch(/^\d+ steps? would never have started \(\d+ model calls?, \d+ tool calls?\):$/);
    expect(lines.inFlight[0]).toMatch(/already running and could not have been recalled/);
    expect(lines.tokens[0]).toMatch(/^Tokens recorded for steps that would not have started: [\d,]+ in, [\d,]+ out\.$/);
  });

  it("adds the cost of the skipped steps when prices are given, from exact arithmetic", () => {
    const r = run({ maxCost: "0.01", inputPrice: "3", outputPrice: "15" });
    expect(r.first?.limit).toBe("cost");
    expect(describeRemainder(r, titleOf).tokens.join(" ")).toMatch(/Cost of the steps that would not have started: \d+\.\d{2,6} USD\./);
  });

  it("gives gauges that follow the position and say 'over' in words", () => {
    const r = run({ maxTotalTokens: "4000", maxModelCalls: "4" });
    const early = gaugesAt(r, 1);
    expect(early.map((g) => [g.label, g.used, g.percent, g.over])).toEqual([["Total tokens", "0 tokens", 0, false], ["Model calls", "0 model calls", 0, false]]);
    const end = gaugesAt(r, model.events.length);
    expect(end[0]).toMatchObject({ used: "6,315 tokens", max: "4,000 tokens", percent: 100, over: true });
    expect(end[1]).toMatchObject({ used: "4 model calls", percent: 100, over: false });
    expect(activeLimits(r.policy).map((l) => l.label)).toEqual(["Total tokens", "Model calls"]);
  });

  it("always carries the counterfactual caveats and warns about missing token counts", () => {
    expect(budgetCaveats(run({ maxTotalTokens: "1" })).length).toBeGreaterThanOrEqual(2);
    const events = importTraceBytes({ spans: new TextEncoder().encode(JSON.stringify({ resourceSpans: [{ scopeSpans: [{ spans: [
      { traceId: "1".repeat(32), spanId: "00000000000000a1", name: "n", startTimeUnixNano: "5", endTimeUnixNano: "9", attributes: [{ key: "gen_ai.operation.name", value: { stringValue: "chat" } }] },
    ] }] }] })) });
    const r = replayBudget(events, policy({ maxTotalTokens: "5" }));
    expect(budgetCaveats(r).join(" ")).toMatch(/1 model call reported no token counts/);
  });

  it("explains a breach by less than a millionth of a currency unit, instead of showing 0.00 over 0.00", () => {
    const events = importTraceBytes({ spans: new TextEncoder().encode(JSON.stringify({ resourceSpans: [{ scopeSpans: [{ spans: [
      { traceId: "1".repeat(32), spanId: "00000000000000a1", name: "n", startTimeUnixNano: "5", endTimeUnixNano: "9", attributes: [
        { key: "gen_ai.operation.name", value: { stringValue: "chat" } }, { key: "gen_ai.usage.input_tokens", value: { intValue: "1" } }] },
    ] }] }] })) });
    const r = replayBudget(events, policy({ maxCost: "0", inputPrice: "0.000001", outputPrice: "0" }));
    const text = describeBreach(r.first!, r.policy, events, () => "the step");
    expect(text).toContain("used 0.000000000001 USD, over your limit of 0.00 USD");
  });

  it("says when a time breach rests on an end time the importer had to estimate", () => {
    const events = importTraceBytes({ spans: new TextEncoder().encode(JSON.stringify({ resourceSpans: [{ scopeSpans: [{ spans: [
      { traceId: "1".repeat(32), spanId: "00000000000000a1", name: "n", startTimeUnixNano: "1000000000", attributes: [{ key: "gen_ai.operation.name", value: { stringValue: "chat" } }] },
      { traceId: "1".repeat(32), spanId: "00000000000000a2", name: "m", startTimeUnixNano: "1000000000", endTimeUnixNano: "11000000000" },
    ] }] }] })) });
    const r = replayBudget(events, policy({ maxSeconds: "5" }));
    const text = describeBreach(r.first!, r.policy, events, () => "Model call");
    expect(text).toContain("its end time was missing or invalid, so the importer estimated it");
    // A recorded end is stated as a fact, without the disclosure.
    expect(describeBreach(run({ maxSeconds: "5" }).first!, policy({ maxSeconds: "5" }), model.events, titleOf)).not.toContain("estimated it");
  });

  it("tells the reader that time is checked only at step events, and how many ends were estimated", () => {
    const events = importTraceBytes({ spans: new TextEncoder().encode(JSON.stringify({ resourceSpans: [{ scopeSpans: [{ spans: [
      { traceId: "1".repeat(32), spanId: "00000000000000a1", name: "n", startTimeUnixNano: "1000000000" },
      { traceId: "1".repeat(32), spanId: "00000000000000a2", name: "m", startTimeUnixNano: "1000000000", endTimeUnixNano: "11000000000" },
    ] }] }] })) });
    const notes = budgetCaveats(replayBudget(events, policy({ maxSeconds: "5" }))).join(" ");
    expect(notes).toContain("Time is checked only at step starts and step ends");
    expect(notes).toContain("1 step end time was estimated");
    expect(budgetCaveats(run({ maxTotalTokens: "1" })).join(" ")).not.toContain("Time is checked");
  });

  it("states the time rule truthfully when the run also has timestamped log records", () => {
    const events = importTraceBytes({
      spans: new TextEncoder().encode(JSON.stringify({ resourceSpans: [{ scopeSpans: [{ spans: [
        { traceId: "1".repeat(32), spanId: "00000000000000a1", name: "n", startTimeUnixNano: "1000000000", endTimeUnixNano: "3000000000" },
      ] }] }] })),
      logs: new TextEncoder().encode(JSON.stringify({ resourceLogs: [{ scopeLogs: [{ logRecords: [
        { traceId: "1".repeat(32), spanId: "00000000000000a1", timeUnixNano: "7000000000", observedTimeUnixNano: "7000000001", body: { stringValue: "late log" } },
      ] }] }] })),
    });
    expect(events.some((e) => e.type === "LogRecorded" && e.payload.timeNs === "7000000000")).toBe(true); // a log really carries a time
    const notes = budgetCaveats(replayBudget(events, policy({ maxSeconds: "1" }))).join(" ");
    expect(notes).not.toContain("no other event carries a time");
    expect(notes).toContain("uses only those times, by design, and ignores the timestamps on log records");
    // The log's later timestamp does not move the result: elapsed time stops at the last step end (2 s).
    expect(replayBudget(events, policy({ maxSeconds: "1" })).recorded.elapsedNs).toBe(2_000_000_000n);
  });

  it("writes a full report, with and without a breach", () => {
    const stop = budgetReportLines(run({ maxTotalTokens: "4000", maxSeconds: "8" }), model.events, titleOf).join("\n");
    expect(stop).toMatch(/^This is a what-if\. DropScope never controls an agent/);
    expect(stop).toContain("Result: a guard with these limits would have fired at event");
    expect(stop).toContain("Would not have happened:");
    expect(stop).toContain("Recorded in the whole run: 5,530 input and 785 output tokens");
    const fine = budgetReportLines(run({ maxTotalTokens: "100000" }), model.events, titleOf).join("\n");
    expect(fine).toContain("the whole run fits inside every limit. Nothing would have been stopped.");
    expect(fine).not.toContain("Would not have happened");
  });
});

describe("budget command", () => {
  const fake: PlatformChecks = { name: "fake", fileAttributes: () => 0, prepareRunsDirectory: () => {} };
  let dir: string;
  let file: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "dropscope-budget-"));
    file = path.join(dir, "demo.runlog.jsonl");
    copyFileSync(demoUrl, file);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const cli = (args: string[]) => {
    let out = ""; let err = "";
    const code = runCli(args, { out: (t) => { out += t; }, err: (t) => { err += t; } }, { checks: fake });
    return { code, out, err };
  };

  it("prints the what-if report and exits 0 whether or not a limit is exceeded", () => {
    const r = cli(["budget", file, "--max-total-tokens", "4000"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("would have fired at event 31 of 42");
    expect(cli(["budget", file, "--max-total-tokens", "99999"]).out).toContain("Nothing would have been stopped");
  });

  it("matches the screen's module exactly (same numbers in --json)", () => {
    const r = cli(["budget", file, "--max-total-tokens", "4000", "--max-model-calls", "3", "--json"]);
    const parsed = JSON.parse(r.out);
    const expected = run({ maxTotalTokens: "4000", maxModelCalls: "3" });
    expect(parsed.counterfactual).toBe(true);
    expect(parsed.firstBreach.breachEvent).toBe(expected.first?.breachEvent);
    expect(parsed.firstBreach.limit).toBe(expected.first?.limit);
    expect(parsed.breaches.map((b: { limit: string }) => b.limit)).toEqual(expected.breaches.map((b) => b.limit));
    expect(parsed.recorded.totalTokens).toBe(expected.recorded.totalTokens.toString());
    expect(parsed.remainder.notStarted.length).toBe(expected.remainder?.notStarted.length);
  });

  it("applies cost limits with exact prices", () => {
    const r = cli(["budget", file, "--max-cost", "0.01", "--input-price", "3", "--output-price", "15", "--currency", "eur"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("cost 0.01 EUR");
    expect(r.out).toContain("Recorded cost with your prices:");
  });

  it("explains bad limits in a sentence, exits 2, and never echoes what was typed", () => {
    for (const [args, message] of [
      [["--max-total-tokens", "SECRET-ABC"], /Total tokens must be a whole number/],
      [[], /Set at least one limit/],
      [["--max-cost", "1"], /needs both an input price and an output price/],
    ] as Array<[string[], RegExp]>) {
      const r = cli(["budget", file, ...args]);
      expect(r.code).toBe(2);
      expect(r.err).toMatch(message);
      expect(r.err).not.toContain("SECRET-ABC");
    }
  });

  it("never lets a trace put terminal control codes or a forged line into the report", () => {
    const hostile = "\u001b[2JINJECT\nFORGED \u202eevil";
    const events = importTraceBytes({
      spans: new TextEncoder().encode(JSON.stringify({ resourceSpans: [{ scopeSpans: [{ spans: [{
        traceId: "1".repeat(32), spanId: "00000000000000a1", name: "n", startTimeUnixNano: "1000000000", endTimeUnixNano: "2000000000",
        attributes: [{ key: "gen_ai.operation.name", value: { stringValue: "execute_tool" } }, { key: "gen_ai.tool.name", value: { stringValue: hostile } }],
      }] }] }] })),
      contentMode: "FULL", // a file that keeps its content keeps the tool name as written
    });
    const hostileFile = path.join(dir, "hostile.runlog.jsonl");
    writeFileSync(hostileFile, serializeRunLog(events));
    const report = cli(["budget", hostileFile, "--max-tool-calls", "0"]);
    expect(report.code).toBe(0);
    expect(report.out).toContain("Tool call: [2JINJECT FORGED");
    // Not one raw control character except the report's own line breaks, no forged line, no bidirectional override.
    expect(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(report.out)).toBe(false);
    expect(report.out.split("\n").some((line) => line.startsWith("FORGED"))).toBe(false);
    // The screen shows the same title as one tidy line.
    const title = loadRunFromBytes(serializeRunLog(events)).steps[0].title;
    expect(title).not.toMatch(/[\u0000-\u001f]/);
    expect(title.length).toBeLessThanOrEqual(100);
  });

  it("rejects a bad run file with a closed error and unknown flags with usage", () => {
    expect(cli(["budget", path.join(dir, "missing.runlog.jsonl"), "--max-steps", "1"]).code).toBe(1);
    const usage = cli(["budget", file, "--bogus", "1"]);
    expect(usage.code).toBe(2);
    expect(usage.err).toContain("Usage:");
    expect(cli(["budget"]).code).toBe(2);
  });
});

describe("a model loaded from the demo run supports every function the screen uses", () => {
  it("builds the run model the command line also uses", () => {
    expect(buildRunModel(model.events).steps.length).toBe(10);
  });
});
