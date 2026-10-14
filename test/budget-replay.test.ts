import { describe, expect, it } from "vitest";
import {
  emptyPolicy, formatMicro, formatPico, parseBudgetPolicy, replayBudget, type BudgetPolicy, type LimitId,
} from "../src/budget-replay.js";
import type { RunEvent } from "../src/run-events.js";
import { importTraceBytes } from "../src/run-import.js";
import { createReplay } from "../src/run-reducer.js";

// ---- building runs through the real importer ----
type Step = { op?: "chat" | "execute_tool" | "invoke_agent"; start: number; end: number | null; input?: number | null; output?: number | null; parent?: number };
const T = "1".repeat(32);
const BASE = 1_700_000_000_000_000_000n;
const ns = (seconds: number): string => (BASE + BigInt(Math.round(seconds * 1e9))).toString();
const id = (n: number) => (n + 1).toString(16).padStart(16, "0");

function runOf(steps: Step[]): RunEvent[] {
  const spans = steps.map((s, i) => ({
    traceId: T, spanId: id(i), ...(s.parent !== undefined ? { parentSpanId: id(s.parent) } : {}), name: `s${i}`,
    startTimeUnixNano: ns(s.start), ...(s.end === null ? {} : { endTimeUnixNano: ns(s.end) }),
    attributes: [
      ...(s.op ? [{ key: "gen_ai.operation.name", value: { stringValue: s.op } }] : []),
      ...(s.input === undefined || s.input === null ? [] : [{ key: "gen_ai.usage.input_tokens", value: { intValue: String(s.input) } }]),
      ...(s.output === undefined || s.output === null ? [] : [{ key: "gen_ai.usage.output_tokens", value: { intValue: String(s.output) } }]),
    ],
  }));
  const bytes = new TextEncoder().encode(JSON.stringify({ resourceSpans: [{ scopeSpans: [{ spans }] }] }));
  return importTraceBytes({ spans: bytes });
}
const policyOf = (input: Parameters<typeof parseBudgetPolicy>[0]): BudgetPolicy => {
  const parsed = parseBudgetPolicy(input);
  if (!parsed.policy) throw new Error(parsed.errors.join("; "));
  return parsed.policy;
};
const seqOf = (events: RunEvent[], type: string, nth: number, stepId?: string) =>
  events.filter((e) => e.type === type && (stepId === undefined || (e.payload as { stepId?: string }).stepId === stepId))[nth].sequenceNumber;

// A hand-checkable run: three sequential model calls with 100/50, 200/100 and 400/200 tokens, one tool call.
const simple = () => runOf([
  { op: "chat", start: 0, end: 1, input: 100, output: 50 },
  { op: "execute_tool", start: 1, end: 2 },
  { op: "chat", start: 2, end: 4, input: 200, output: 100 },
  { op: "chat", start: 4, end: 7, input: 400, output: 200 },
]);

describe("budget replay: hand-checked cases", () => {
  const events = simple();

  it("reports no breach when the run stays inside every limit", () => {
    const r = replayBudget(events, policyOf({ maxTotalTokens: "1050", maxModelCalls: "3", maxToolCalls: "1", maxSteps: "4", maxSeconds: "7" }));
    expect(r.first).toBeNull();
    expect(r.breaches).toEqual([]);
    expect(r.remainder).toBeNull();
    expect(r.recorded).toMatchObject({ inputTokens: 700n, outputTokens: 350n, totalTokens: 1050n, modelCalls: 3, toolCalls: 1, steps: 4 });
  });

  it("treats a limit equal to the total as not exceeded, and one less as exceeded by the last usage", () => {
    const exact = replayBudget(events, policyOf({ maxTotalTokens: "1050" }));
    expect(exact.first).toBeNull();
    const over = replayBudget(events, policyOf({ maxTotalTokens: "1049" }));
    expect(over.first).toMatchObject({ limit: "totalTokens", basis: "AFTER_THE_FACT", usedAtBreach: 1050n, limitValue: 1049n });
    expect(over.first?.breachEvent).toBe(seqOf(events, "UsageRecorded", 2));
    expect(over.first?.stopBefore).toBe(over.first!.breachEvent + 1);
  });

  it("stops after the usage event that crosses a token limit, and reports what would not have run", () => {
    const r = replayBudget(events, policyOf({ maxTotalTokens: "400" })); // 150 -> 450 crosses at the second model call
    expect(r.first?.breachEvent).toBe(seqOf(events, "UsageRecorded", 1));
    expect(r.first?.usedAtBreach).toBe(450n);
    expect(r.remainder?.notStarted.map((s) => s.stepId)).toEqual([id(3)]);
    expect(r.remainder?.inFlight).toEqual([]);
    expect(r.remainder?.tokensNotStarted).toEqual({ input: 400n, output: 200n });
    expect(r.remainder?.modelCallsNotStarted).toBe(1);
  });

  it("separates input, output and total token limits", () => {
    expect(replayBudget(events, policyOf({ maxInputTokens: "299" })).first).toMatchObject({ limit: "inputTokens", usedAtBreach: 300n });
    expect(replayBudget(events, policyOf({ maxOutputTokens: "149" })).first).toMatchObject({ limit: "outputTokens", usedAtBreach: 150n });
    expect(replayBudget(events, policyOf({ maxInputTokens: "700", maxOutputTokens: "350" })).first).toBeNull();
  });

  it("stops a count limit before the call that would exceed it starts", () => {
    const r = replayBudget(events, policyOf({ maxModelCalls: "2" }));
    expect(r.first).toMatchObject({ limit: "modelCalls", basis: "BEFORE_START", usedAtBreach: 3n, limitValue: 2n });
    expect(r.first?.breachEvent).toBe(seqOf(events, "StepStarted", 3));
    expect(r.first?.stopBefore).toBe(r.first?.breachEvent);
    expect(r.remainder?.notStarted.map((s) => s.stepId)).toEqual([id(3)]);
    expect(r.remainder?.tokensNotStarted).toEqual({ input: 400n, output: 200n });
    expect(replayBudget(events, policyOf({ maxToolCalls: "0" })).first?.breachEvent).toBe(seqOf(events, "StepStarted", 1));
    expect(replayBudget(events, policyOf({ maxSteps: "3" })).first).toMatchObject({ limit: "steps", usedAtBreach: 4n });
  });

  it("measures time from the first step start and treats the limit as inclusive", () => {
    const inside = replayBudget(events, policyOf({ maxSeconds: "7" }));
    expect(inside.first).toBeNull();
    const r = replayBudget(events, policyOf({ maxSeconds: "6.999999999" }));
    expect(r.first).toMatchObject({ limit: "duration", basis: "TIME", usedAtBreach: 7_000_000_000n, limitValue: 6_999_999_999n });
    expect(r.first?.breachEvent).toBe(seqOf(events, "StepEnded", 3));
    expect(r.remainder?.inFlight.map((s) => s.stepId)).toEqual([id(3)]);
    expect(r.remainder?.notStarted).toEqual([]);
  });

  it("reports the earliest stop point when several limits are exceeded, and names ties", () => {
    const r = replayBudget(events, policyOf({ maxTotalTokens: "100", maxModelCalls: "1", maxSeconds: "1.5" }));
    // Order of stop points: the second model call would not start (event of step 2) vs usage of the first call.
    expect(r.breaches.map((b) => b.limit).sort()).toEqual(["duration", "modelCalls", "totalTokens"]);
    const stops = r.breaches.map((b) => b.stopBefore);
    expect(stops).toEqual([...stops].sort((a, b) => a - b));
    expect(r.first?.stopBefore).toBe(Math.min(...stops));
    const tie = replayBudget(events, policyOf({ maxTotalTokens: "149", maxInputTokens: "99" }));
    expect(tie.first?.stopBefore).toBe(seqOf(events, "UsageRecorded", 0) + 1);
    expect(tie.alsoAtSameStop.length).toBe(1);
  });

  it("allows a zero limit, which is exceeded by the first thing counted", () => {
    expect(replayBudget(events, policyOf({ maxTotalTokens: "0" })).first?.breachEvent).toBe(seqOf(events, "UsageRecorded", 0));
    expect(replayBudget(events, policyOf({ maxSteps: "0" })).first?.breachEvent).toBe(seqOf(events, "StepStarted", 0));
    expect(replayBudget(events, policyOf({ maxSeconds: "0" })).first?.breachEvent).toBe(seqOf(events, "StepEnded", 0));
  });

  it("tells running steps apart from steps that never started when the stop falls in the middle of parallel work", () => {
    const parallel = runOf([
      { op: "invoke_agent", start: 0, end: 10 },
      { op: "chat", start: 1, end: 3, input: 500, output: 100, parent: 0 },
      { op: "chat", start: 1.5, end: 6, input: 800, output: 200, parent: 0 },
      { op: "chat", start: 4, end: 5, input: 300, output: 50, parent: 0 },
      { op: "chat", start: 7, end: 8, input: 900, output: 100, parent: 0 },
    ]);
    const r = replayBudget(parallel, policyOf({ maxTotalTokens: "700" })); // crossed when step 1 ends (600) then step 3 (950)
    expect(r.first?.usedAtBreach).toBe(950n);
    const at = r.first!.stopBefore;
    expect(r.remainder?.inFlight.map((s) => s.stepId).sort()).toEqual([id(0), id(2)].sort());
    expect(r.remainder?.notStarted.map((s) => s.stepId)).toEqual([id(4)]);
    expect(r.remainder?.tokensInFlight).toEqual({ input: 800n, output: 200n });
    for (const s of r.remainder!.inFlight) expect(s.startSequence < at && s.endSequence >= at).toBe(true);
  });

  it("counts a token metric the trace did not report as zero and says so", () => {
    const partial = runOf([
      { op: "chat", start: 0, end: 1, input: 100, output: null },
      { op: "chat", start: 1, end: 2 },
      { op: "chat", start: 2, end: 3, input: 50, output: 20 },
    ]);
    const r = replayBudget(partial, policyOf({ maxTotalTokens: "1000" }));
    expect(r.recorded.totalTokens).toBe(170n);
    expect(r.usageGaps).toEqual({ modelCallsWithoutUsage: 1, partialUsage: 1 });
  });

  it("does not charge tool or agent steps and handles a run with no usage at all", () => {
    const none = runOf([{ op: "execute_tool", start: 0, end: 1 }, { start: 1, end: 2 }]);
    const r = replayBudget(none, policyOf({ maxTotalTokens: "0", maxToolCalls: "1" }));
    expect(r.breaches).toEqual([]);
    expect(r.recorded).toMatchObject({ totalTokens: 0n, toolCalls: 1, steps: 2 });
  });

  it("keeps exact arithmetic beyond 2^53 tokens", () => {
    const big = runOf([
      { op: "chat", start: 0, end: 1, input: 9_007_199_254_740_991, output: 9_007_199_254_740_991 },
      { op: "chat", start: 1, end: 2, input: 9_007_199_254_740_991, output: 9_007_199_254_740_991 },
    ]);
    const r = replayBudget(big, policyOf({ maxTotalTokens: "36028797018963964" }));
    expect(r.recorded.totalTokens).toBe(36_028_797_018_963_964n);
    expect(r.first).toBeNull();
    expect(replayBudget(big, policyOf({ maxTotalTokens: "36028797018963963" })).first?.usedAtBreach).toBe(36_028_797_018_963_964n);
  });
});

describe("budget replay: cost", () => {
  const events = runOf([
    { op: "chat", start: 0, end: 1, input: 1_000_000, output: 0 },
    { op: "chat", start: 1, end: 2, input: 0, output: 500_000 },
    { op: "chat", start: 2, end: 3, input: 3, output: 3 },
  ]);

  it("is exact: tokens times the price per million, with no rounding", () => {
    const p = policyOf({ maxCost: "100", inputPrice: "3", outputPrice: "15" });
    const r = replayBudget(events, p);
    expect(formatPico(r.costPicoAt(events.length)!)).toBe("10.500054"); // 3.00 + 7.50 + 0.000009 + 0.000045
    expect(r.costPicoAt(1)).toBe(0n);
    expect(r.first).toBeNull();
  });

  it("breaches when the running cost is strictly greater than the limit", () => {
    expect(replayBudget(events, policyOf({ maxCost: "10.500054", inputPrice: "3", outputPrice: "15" })).first).toBeNull();
    const r = replayBudget(events, policyOf({ maxCost: "10.500053", inputPrice: "3", outputPrice: "15" }));
    expect(r.first).toMatchObject({ limit: "cost", basis: "AFTER_THE_FACT" });
    expect(r.first?.breachEvent).toBe(seqOf(events, "UsageRecorded", 2));
    const second = replayBudget(events, policyOf({ maxCost: "5", inputPrice: "3", outputPrice: "15" }));
    expect(second.first?.breachEvent).toBe(seqOf(events, "UsageRecorded", 1));
  });

  it("supports six-decimal prices and formats amounts", () => {
    const p = policyOf({ maxCost: "0.000001", inputPrice: "0.000001", outputPrice: "0" });
    expect(replayBudget(events, p).first?.limit).toBe("cost"); // 1,000,000 tokens * 0.000001 / 1,000,000 = 0.000001, then +3 tokens
    expect(formatMicro(10_500_054n)).toBe("10.500054");
    expect(formatMicro(3_000_000n)).toBe("3.00");
    expect(formatMicro(1_500_000n)).toBe("1.50");
    expect(formatPico(0n)).toBe("0.00");
  });
});

describe("budget policy parsing", () => {
  it("accepts whole numbers with separators, decimals, and a default currency", () => {
    const { policy, errors } = parseBudgetPolicy({ maxTotalTokens: "1,000,000", maxSeconds: "2.5", maxCost: "0.50", inputPrice: "3", outputPrice: "15" });
    expect(errors).toEqual([]);
    expect(policy).toMatchObject({ maxTotalTokens: 1_000_000n, maxDurationNs: 2_500_000_000n, cost: { maxMicro: 500_000n, inputPriceMicro: 3_000_000n, outputPriceMicro: 15_000_000n, currency: "USD" } });
    expect(parseBudgetPolicy({ maxCost: "1", inputPrice: "1", outputPrice: "1", currency: "eur" }).policy?.cost?.currency).toBe("EUR");
  });

  it("rejects bad input with a sentence for each problem and never guesses", () => {
    const bad: Array<[Parameters<typeof parseBudgetPolicy>[0], RegExp]> = [
      [{}, /at least one limit/],
      [{ maxTotalTokens: "  " }, /at least one limit/],
      [{ maxTotalTokens: "-5" }, /whole number/],
      [{ maxTotalTokens: "1.5" }, /whole number/],
      [{ maxTotalTokens: "abc" }, /whole number/],
      [{ maxTotalTokens: "1234567890123456789" }, /whole number/],
      [{ maxModelCalls: "1e3" }, /whole number/],
      [{ maxSeconds: "1.1234567891" }, /decimal places/],
      [{ maxSeconds: "-1" }, /plain number/],
      [{ maxCost: "1" }, /both an input price and an output price/],
      [{ maxCost: "1", inputPrice: "1" }, /both an input price and an output price/],
      [{ maxTotalTokens: "5", inputPrice: "1" }, /only matter together/],
      [{ maxCost: "1", inputPrice: "1", outputPrice: "1", currency: "dollars" }, /three-letter/],
      [{ maxCost: "1.1234567", inputPrice: "1", outputPrice: "1" }, /decimal places/],
    ];
    for (const [input, message] of bad) {
      const result = parseBudgetPolicy(input);
      expect(result.policy, JSON.stringify(input)).toBeNull();
      expect(result.errors.join(" "), JSON.stringify(input)).toMatch(message);
    }
  });
});

// ---- the independent oracle ----
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Recomputes everything from scratch at every event. Slow, simple, and written separately from the module. */
function oracle(events: RunEvent[], policy: BudgetPolicy) {
  const starts = events.filter((e) => e.type === "StepStarted");
  const origin = starts.map((e) => BigInt((e.payload as { startNs: string }).startNs)).reduce((m, v) => (v < m ? v : m), BigInt((starts[0].payload as { startNs: string }).startNs));
  const found: Array<{ limit: LimitId; breachEvent: number; stopBefore: number }> = [];
  const upTo = (p: number) => events.slice(0, p);
  const tokens = (p: number) => {
    let i = 0n; let o = 0n;
    for (const e of upTo(p)) if (e.type === "UsageRecorded") { i += BigInt(e.payload.inputTokens ?? "0"); o += BigInt(e.payload.outputTokens ?? "0"); }
    return { i, o };
  };
  const started = (p: number, kind?: string) => upTo(p).filter((e) => e.type === "StepStarted" && (kind === undefined || e.payload.kind === kind)).length;
  const tokenChecks: Array<[LimitId, bigint | null, (i: bigint, o: bigint) => bigint]> = [
    ["totalTokens", policy.maxTotalTokens, (i, o) => i + o], ["inputTokens", policy.maxInputTokens, (i) => i], ["outputTokens", policy.maxOutputTokens, (_i, o) => o],
  ];
  for (const [limit, max, f] of tokenChecks) {
    if (max === null) continue;
    for (let p = 1; p <= events.length; p += 1) {
      if (events[p - 1].type !== "UsageRecorded") continue;
      const { i, o } = tokens(p);
      if (f(i, o) > max) { found.push({ limit, breachEvent: p, stopBefore: p + 1 }); break; }
    }
  }
  if (policy.cost !== null) {
    for (let p = 1; p <= events.length; p += 1) {
      if (events[p - 1].type !== "UsageRecorded") continue;
      const { i, o } = tokens(p);
      if (i * policy.cost.inputPriceMicro + o * policy.cost.outputPriceMicro > policy.cost.maxMicro * 1_000_000n) { found.push({ limit: "cost", breachEvent: p, stopBefore: p + 1 }); break; }
    }
  }
  const countChecks: Array<[LimitId, bigint | null, string | undefined]> = [["modelCalls", policy.maxModelCalls, "LLM_CALL"], ["toolCalls", policy.maxToolCalls, "TOOL_CALL"], ["steps", policy.maxSteps, undefined]];
  for (const [limit, max, kind] of countChecks) {
    if (max === null) continue;
    for (let p = 1; p <= events.length; p += 1) {
      if (events[p - 1].type !== "StepStarted") continue;
      if (BigInt(started(p, kind)) > max) { found.push({ limit, breachEvent: p, stopBefore: p }); break; }
    }
  }
  if (policy.maxDurationNs !== null) {
    for (let p = 1; p <= events.length; p += 1) {
      const e = events[p - 1];
      let t: bigint | null = null;
      if (e.type === "StepStarted") t = BigInt(e.payload.startNs) - origin;
      if (e.type === "StepEnded") t = BigInt(e.payload.endEffectiveNs) - origin;
      if (t !== null && t > policy.maxDurationNs) { found.push({ limit: "duration", breachEvent: p, stopBefore: p }); break; }
    }
  }
  found.sort((a, b) => a.stopBefore - b.stopBefore || a.breachEvent - b.breachEvent || (a.limit < b.limit ? -1 : 1));
  let remainder: { notStarted: string[]; inFlight: string[] } | null = null;
  if (found.length > 0) {
    const cut = found[0].stopBefore;
    const startSeq = new Map<string, number>(); const endSeq = new Map<string, number>();
    for (const e of events) {
      if (e.type === "StepStarted") startSeq.set(e.payload.stepId, e.sequenceNumber);
      if (e.type === "StepEnded") endSeq.set(e.payload.stepId, e.sequenceNumber);
    }
    remainder = {
      notStarted: [...startSeq].filter(([, s]) => s >= cut).map(([k]) => k).sort(),
      inFlight: [...startSeq].filter(([k, s]) => s < cut && (endSeq.get(k) as number) >= cut).map(([k]) => k).sort(),
    };
  }
  return { found, remainder };
}

function randomRun(rand: () => number): Step[] {
  const count = 2 + Math.floor(rand() * 14);
  const steps: Step[] = [];
  for (let i = 0; i < count; i += 1) {
    const start = Math.floor(rand() * 20 * 4) / 4;
    const op = (["chat", "chat", "execute_tool", "invoke_agent", undefined] as const)[Math.floor(rand() * 5)];
    const tokens = (): number | null => (rand() < 0.15 ? null : Math.floor(rand() * 900));
    steps.push({ op, start, end: start + Math.floor(rand() * 12 * 4) / 4, input: op === "chat" ? tokens() : undefined, output: op === "chat" ? tokens() : undefined });
  }
  return steps;
}

describe("budget replay: agrees with the independent oracle on random runs and random budgets", () => {
  it("400 random cases", () => {
    const rand = mulberry32(20261014);
    let withBreach = 0;
    for (let c = 0; c < 400; c += 1) {
      const events = runOf(randomRun(rand));
      const replay = createReplay(events);
      const full = replayBudget(events, emptyPolicy());
      const total = full.recorded;
      const pick = (max: bigint): string | undefined => (rand() < 0.5 ? undefined : String(max === 0n ? 0n : BigInt(Math.floor(rand() * Number(max + 2n))) - (rand() < 0.3 ? 1n : 0n) < 0n ? 0n : BigInt(Math.floor(rand() * Number(max + 2n)))));
      const input: Parameters<typeof parseBudgetPolicy>[0] = {
        maxTotalTokens: pick(total.totalTokens), maxInputTokens: pick(total.inputTokens), maxOutputTokens: pick(total.outputTokens),
        maxModelCalls: pick(BigInt(total.modelCalls)), maxToolCalls: pick(BigInt(total.toolCalls)), maxSteps: pick(BigInt(total.steps)),
        maxSeconds: rand() < 0.5 ? undefined : String(Math.floor(rand() * 30 * 4) / 4),
        ...(rand() < 0.3 ? { maxCost: String(Math.floor(rand() * 5)), inputPrice: String(Math.floor(rand() * 4)), outputPrice: String(Math.floor(rand() * 20)) } : {}),
      };
      const parsed = parseBudgetPolicy(input);
      if (!parsed.policy) continue;
      const got = replayBudget(events, parsed.policy);
      const want = oracle(events, parsed.policy);

      expect(got.breaches.map((b) => ({ limit: b.limit, breachEvent: b.breachEvent, stopBefore: b.stopBefore })), `case ${c}`).toEqual(want.found);
      if (want.remainder) {
        withBreach += 1;
        expect(got.remainder?.notStarted.map((s) => s.stepId).sort(), `case ${c} notStarted`).toEqual(want.remainder.notStarted);
        expect(got.remainder?.inFlight.map((s) => s.stepId).sort(), `case ${c} inFlight`).toEqual(want.remainder.inFlight);
      } else {
        expect(got.remainder).toBeNull();
      }
      // The totals at every position agree with the reducer's own replay.
      for (let p = 1; p <= events.length; p += 7) {
        const state = replay.stateAt(p);
        const t = got.totalsAt(p);
        expect(t.inputTokens.toString(), `case ${c} @${p}`).toBe(state.inputTokens);
        expect(t.outputTokens.toString()).toBe(state.outputTokens);
        expect(t.modelCalls).toBe(state.stepsByKind.LLM_CALL);
        expect(t.toolCalls).toBe(state.stepsByKind.TOOL_CALL);
        expect(t.steps).toBe(state.stepsByKind.LLM_CALL + state.stepsByKind.TOOL_CALL + state.stepsByKind.AGENT + state.stepsByKind.OTHER);
      }
      // Totals never decrease as the position moves forward.
      let lastTotal = -1n; let lastElapsed = -1n;
      for (let p = 1; p <= events.length; p += 1) {
        const t = got.totalsAt(p);
        expect(t.totalTokens >= lastTotal).toBe(true);
        lastTotal = t.totalTokens; lastElapsed = t.elapsedNs > lastElapsed ? t.elapsedNs : lastElapsed;
      }
    }
    expect(withBreach).toBeGreaterThan(60); // the random budgets really do exercise breaches
  }, 120_000);

  it("a tighter limit never moves the stop point later (monotonic)", () => {
    const rand = mulberry32(7);
    for (let c = 0; c < 60; c += 1) {
      const events = runOf(randomRun(rand));
      const total = replayBudget(events, emptyPolicy()).recorded.totalTokens;
      let previousStop = Number.MAX_SAFE_INTEGER;
      for (let limit = total + 1n; limit >= 0n; limit -= (total / 8n + 1n)) {
        const r = replayBudget(events, policyOf({ maxTotalTokens: String(limit) }));
        const stop = r.first?.stopBefore ?? Number.MAX_SAFE_INTEGER;
        expect(stop <= previousStop).toBe(true);
        previousStop = stop;
        if (limit === 0n) break;
      }
    }
  });
});

describe("budget replay: scale", () => {
  it("handles a run with 10,000 steps quickly and answers any position", () => {
    const steps: Step[] = Array.from({ length: 10_000 }, (_, i) => ({ op: "chat" as const, start: i, end: i + 1, input: 10, output: 5 }));
    const events = runOf(steps);
    const started = performance.now();
    const r = replayBudget(events, policyOf({ maxTotalTokens: "100000", maxModelCalls: "9000", maxSeconds: "9500", maxCost: "1", inputPrice: "3", outputPrice: "15" }));
    for (let p = 1; p <= events.length; p += 997) r.totalsAt(p);
    expect(performance.now() - started).toBeLessThan(5000);
    expect(r.first?.limit).toBeDefined();
    expect(r.recorded.modelCalls).toBe(10_000);
  });
});
