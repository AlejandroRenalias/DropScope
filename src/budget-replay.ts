// Budget replay: re-applies a budget that the user supplies to a recorded run, offline.
//
// It is COUNTERFACTUAL. DropScope never controls an agent. "Would have stopped" means: had a guard with these
// limits been watching, using only the numbers the trace recorded, it would have fired at this point. The
// module only reads a history that the reducer has already validated; it adds no model call and no network.
//
// Rules (all arithmetic is exact: whole numbers only, no floating point):
// - Tokens and cost are charged after the fact: when a UsageRecorded event arrives (the call has finished).
//   A limit is exceeded when the running total is strictly greater than the limit. The stop point is just after
//   that usage event: the tokens were already spent.
// - Counts (model calls, tool calls, steps) are checked when a step starts. The call that would make the count
//   exceed the limit would not have started. The stop point is that StepStarted event.
// - Duration is measured from the earliest recorded step start, at step start and step end events. Only step start
//   and end times are used, by design: log records carry timestamps too, but they are not used here. Elapsed time is the greatest elapsed time reached so far, so it never goes down even if a
//   hand-edited history lists events out of time order. A limit is exceeded by the first such event that makes it
//   strictly greater than the limit. The stop point is that event. The moment the limit was really passed can be
//   earlier than that event, because only step start and end times are used.
// - Steps already running at the stop point could not be recalled: they are reported as "in flight".
// - A token count the trace did not report counts as zero, and the result says how many were missing.
import type { RunEvent, StepKind } from "./run-events.js";

export type LimitId = "totalTokens" | "inputTokens" | "outputTokens" | "modelCalls" | "toolCalls" | "steps" | "duration" | "cost";

export type BudgetPolicy = {
  maxTotalTokens: bigint | null;
  maxInputTokens: bigint | null;
  maxOutputTokens: bigint | null;
  maxModelCalls: bigint | null;
  maxToolCalls: bigint | null;
  maxSteps: bigint | null;
  maxDurationNs: bigint | null;
  // Prices are per million tokens, and every amount is in millionths of the currency unit.
  cost: { maxMicro: bigint; inputPriceMicro: bigint; outputPriceMicro: bigint; currency: string } | null;
};

export const emptyPolicy = (): BudgetPolicy => ({
  maxTotalTokens: null, maxInputTokens: null, maxOutputTokens: null, maxModelCalls: null, maxToolCalls: null,
  maxSteps: null, maxDurationNs: null, cost: null,
});

// ---- parsing what a person typed ----
export type BudgetPolicyInput = {
  maxTotalTokens?: string; maxInputTokens?: string; maxOutputTokens?: string; maxModelCalls?: string; maxToolCalls?: string;
  maxSteps?: string; maxSeconds?: string; maxCost?: string; inputPrice?: string; outputPrice?: string; currency?: string;
};

const blank = (text: string | undefined): boolean => text === undefined || text.trim() === "";
const cleaned = (text: string): string => text.trim().replace(/[,_ ]/g, "");

function whole(text: string | undefined, label: string, errors: string[]): bigint | null {
  if (blank(text)) return null;
  const value = cleaned(text as string);
  if (!/^[0-9]{1,18}$/.test(value)) {
    errors.push(`${label} must be a whole number (digits only, at most 18).`);
    return null;
  }
  return BigInt(value);
}

/** A decimal with at most `places` fractional digits, as an exact integer scaled by 10^places. */
function decimal(text: string | undefined, places: number, label: string, errors: string[]): bigint | null {
  if (blank(text)) return null;
  const value = cleaned(text as string);
  const match = /^([0-9]{1,12})(?:\.([0-9]{1,12}))?$/.exec(value);
  if (!match || (match[2] ?? "").length > places) {
    errors.push(`${label} must be a plain number with at most ${places} decimal places.`);
    return null;
  }
  return BigInt(match[1]) * 10n ** BigInt(places) + BigInt((match[2] ?? "").padEnd(places, "0") || "0");
}

export function parseBudgetPolicy(input: BudgetPolicyInput): { policy: BudgetPolicy | null; errors: string[] } {
  const errors: string[] = [];
  const policy = emptyPolicy();
  policy.maxTotalTokens = whole(input.maxTotalTokens, "Total tokens", errors);
  policy.maxInputTokens = whole(input.maxInputTokens, "Input tokens", errors);
  policy.maxOutputTokens = whole(input.maxOutputTokens, "Output tokens", errors);
  policy.maxModelCalls = whole(input.maxModelCalls, "Model calls", errors);
  policy.maxToolCalls = whole(input.maxToolCalls, "Tool calls", errors);
  policy.maxSteps = whole(input.maxSteps, "Steps", errors);
  policy.maxDurationNs = decimal(input.maxSeconds, 9, "Time limit (seconds)", errors);

  const maxCost = decimal(input.maxCost, 6, "Cost limit", errors);
  const inputPrice = decimal(input.inputPrice, 6, "Input price per million tokens", errors);
  const outputPrice = decimal(input.outputPrice, 6, "Output price per million tokens", errors);
  const currency = blank(input.currency) ? "USD" : (input.currency as string).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) errors.push("Currency must be a three-letter code such as USD.");
  if (maxCost !== null) {
    if (inputPrice === null || outputPrice === null) errors.push("A cost limit needs both an input price and an output price (per million tokens).");
    else policy.cost = { maxMicro: maxCost, inputPriceMicro: inputPrice, outputPriceMicro: outputPrice, currency };
  } else if (inputPrice !== null || outputPrice !== null) {
    errors.push("Prices only matter together with a cost limit.");
  }

  const anyLimit = Object.entries(policy).some(([, v]) => v !== null);
  if (errors.length === 0 && !anyLimit) errors.push("Set at least one limit.");
  return errors.length > 0 ? { policy: null, errors } : { policy, errors };
}

// ---- running totals, kept sparsely so any position can be answered quickly ----
export type Totals = {
  inputTokens: bigint;
  outputTokens: bigint;
  totalTokens: bigint;
  modelCalls: number;
  toolCalls: number;
  steps: number;
  elapsedNs: bigint;
};

type Series = {
  usageSeq: number[]; usageIn: bigint[]; usageOut: bigint[];
  startSeq: number[]; startSteps: number[]; startModel: number[]; startTool: number[];
  timeSeq: number[]; timeNs: bigint[];
};

/** Index of the last entry whose sequence is at most `position`, or -1. */
function lastAtOrBefore(sequences: number[], position: number): number {
  let lo = 0;
  let hi = sequences.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sequences[mid] <= position) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}

export type StepRecord = { stepId: string; kind: StepKind; startSequence: number; endSequence: number };

export type Breach = {
  limit: LimitId;
  // The event whose arrival makes the limit exceeded.
  breachEvent: number;
  // Events from this sequence number on would not have happened (steps) or are "after the stop".
  stopBefore: number;
  basis: "AFTER_THE_FACT" | "BEFORE_START" | "TIME";
  // What was recorded up to the stop point, and the limit, as plain integers (for the limit's own unit).
  usedAtBreach: bigint;
  limitValue: bigint;
};

export type Remainder = {
  // Steps that started at or after the stop point.
  notStarted: StepRecord[];
  // Steps already running at the stop point.
  inFlight: StepRecord[];
  tokensNotStarted: { input: bigint; output: bigint };
  tokensInFlight: { input: bigint; output: bigint };
  modelCallsNotStarted: number;
  toolCallsNotStarted: number;
};

export type BudgetReplayResult = {
  policy: BudgetPolicy;
  breaches: Breach[]; // every limit that was exceeded, earliest stop point first
  first: Breach | null;
  alsoAtSameStop: LimitId[];
  remainder: Remainder | null;
  steps: StepRecord[];
  recorded: Totals;
  totalsAt(position: number): Totals;
  costPicoAt(position: number): bigint | null; // cost in 10^-12 currency units, exact
  usageGaps: { modelCallsWithoutUsage: number; partialUsage: number };
  // Step end times the importer had to estimate (missing, or before the start). Time results depend on them.
  estimatedEnds: number;
};

const costPico = (policy: BudgetPolicy, t: Totals): bigint | null =>
  policy.cost === null ? null : t.inputTokens * policy.cost.inputPriceMicro + t.outputTokens * policy.cost.outputPriceMicro;
const MICRO_TO_PICO = 1_000_000n;

export function replayBudget(events: readonly RunEvent[], policy: BudgetPolicy): BudgetReplayResult {
  // Pass 1: where the run starts (the earliest recorded step start).
  let runStart: bigint | null = null;
  for (const event of events) {
    if (event.type !== "StepStarted") continue;
    const start = BigInt(event.payload.startNs);
    if (runStart === null || start < runStart) runStart = start;
  }
  const origin = runStart ?? 0n;
  const elapsed = (ns: string): bigint => {
    const t = BigInt(ns) - origin;
    return t < 0n ? 0n : t;
  };

  const series: Series = { usageSeq: [], usageIn: [], usageOut: [], startSeq: [], startSteps: [], startModel: [], startTool: [], timeSeq: [], timeNs: [] };
  const steps = new Map<string, StepRecord>();
  const usageByStep = new Map<string, { input: bigint; output: bigint; sequence: number }>();
  let input = 0n;
  let output = 0n;
  let stepCount = 0;
  let modelCount = 0;
  let toolCount = 0;
  let partialUsage = 0;
  let lastEvent = 0;
  let maxElapsed = 0n;
  let estimatedEnds = 0;
  const reached = (t: bigint): bigint => {
    if (t > maxElapsed) maxElapsed = t;
    return maxElapsed;
  };

  for (const event of events) {
    const sequence = event.sequenceNumber;
    lastEvent = sequence;
    if (event.type === "StepStarted") {
      const p = event.payload;
      stepCount += 1;
      if (p.kind === "LLM_CALL") modelCount += 1;
      if (p.kind === "TOOL_CALL") toolCount += 1;
      steps.set(p.stepId, { stepId: p.stepId, kind: p.kind, startSequence: sequence, endSequence: Number.MAX_SAFE_INTEGER });
      series.startSeq.push(sequence); series.startSteps.push(stepCount); series.startModel.push(modelCount); series.startTool.push(toolCount);
      series.timeSeq.push(sequence); series.timeNs.push(reached(elapsed(p.startNs)));
    } else if (event.type === "StepEnded") {
      const step = steps.get(event.payload.stepId);
      if (step) step.endSequence = sequence;
      if (event.payload.endNs === null || BigInt(event.payload.endNs) !== BigInt(event.payload.endEffectiveNs)) estimatedEnds += 1;
      series.timeSeq.push(sequence); series.timeNs.push(reached(elapsed(event.payload.endEffectiveNs)));
    } else if (event.type === "UsageRecorded") {
      const i = event.payload.inputTokens === null ? 0n : BigInt(event.payload.inputTokens);
      const o = event.payload.outputTokens === null ? 0n : BigInt(event.payload.outputTokens);
      if (event.payload.inputTokens === null || event.payload.outputTokens === null) partialUsage += 1;
      input += i;
      output += o;
      usageByStep.set(event.payload.stepId, { input: i, output: o, sequence });
      series.usageSeq.push(sequence); series.usageIn.push(input); series.usageOut.push(output);
    }
  }

  const stepList = [...steps.values()];
  const modelCallsWithoutUsage = stepList.filter((s) => s.kind === "LLM_CALL" && !usageByStep.has(s.stepId)).length;

  const totalsAt = (position: number): Totals => {
    const u = lastAtOrBefore(series.usageSeq, position);
    const s = lastAtOrBefore(series.startSeq, position);
    const t = lastAtOrBefore(series.timeSeq, position);
    const inTok = u < 0 ? 0n : series.usageIn[u];
    const outTok = u < 0 ? 0n : series.usageOut[u];
    return {
      inputTokens: inTok, outputTokens: outTok, totalTokens: inTok + outTok,
      modelCalls: s < 0 ? 0 : series.startModel[s], toolCalls: s < 0 ? 0 : series.startTool[s], steps: s < 0 ? 0 : series.startSteps[s],
      elapsedNs: t < 0 ? 0n : series.timeNs[t],
    };
  };
  const recorded = totalsAt(lastEvent);

  // ---- find where each limit is first exceeded ----
  const breaches: Breach[] = [];
  const tokenLimit = (limit: LimitId, max: bigint | null, value: (i: bigint, o: bigint) => bigint): void => {
    if (max === null) return;
    for (let k = 0; k < series.usageSeq.length; k += 1) {
      const used = value(series.usageIn[k], series.usageOut[k]);
      if (used > max) {
        breaches.push({ limit, breachEvent: series.usageSeq[k], stopBefore: series.usageSeq[k] + 1, basis: "AFTER_THE_FACT", usedAtBreach: used, limitValue: max });
        return;
      }
    }
  };
  tokenLimit("totalTokens", policy.maxTotalTokens, (i, o) => i + o);
  tokenLimit("inputTokens", policy.maxInputTokens, (i) => i);
  tokenLimit("outputTokens", policy.maxOutputTokens, (_i, o) => o);
  if (policy.cost !== null) {
    const { maxMicro, inputPriceMicro, outputPriceMicro } = policy.cost;
    const maxPico = maxMicro * MICRO_TO_PICO;
    for (let k = 0; k < series.usageSeq.length; k += 1) {
      const used = series.usageIn[k] * inputPriceMicro + series.usageOut[k] * outputPriceMicro;
      if (used > maxPico) {
        breaches.push({ limit: "cost", breachEvent: series.usageSeq[k], stopBefore: series.usageSeq[k] + 1, basis: "AFTER_THE_FACT", usedAtBreach: used, limitValue: maxPico });
        break;
      }
    }
  }
  const countLimit = (limit: LimitId, max: bigint | null, counts: number[]): void => {
    if (max === null) return;
    for (let k = 0; k < series.startSeq.length; k += 1) {
      if (BigInt(counts[k]) > max) {
        breaches.push({ limit, breachEvent: series.startSeq[k], stopBefore: series.startSeq[k], basis: "BEFORE_START", usedAtBreach: BigInt(counts[k]), limitValue: max });
        return;
      }
    }
  };
  countLimit("modelCalls", policy.maxModelCalls, series.startModel);
  countLimit("toolCalls", policy.maxToolCalls, series.startTool);
  countLimit("steps", policy.maxSteps, series.startSteps);
  if (policy.maxDurationNs !== null) {
    for (let k = 0; k < series.timeSeq.length; k += 1) {
      if (series.timeNs[k] > policy.maxDurationNs) {
        breaches.push({ limit: "duration", breachEvent: series.timeSeq[k], stopBefore: series.timeSeq[k], basis: "TIME", usedAtBreach: series.timeNs[k], limitValue: policy.maxDurationNs });
        break;
      }
    }
  }
  breaches.sort((a, b) => a.stopBefore - b.stopBefore || a.breachEvent - b.breachEvent || (a.limit < b.limit ? -1 : 1));
  const first = breaches[0] ?? null;
  const alsoAtSameStop = first === null ? [] : breaches.filter((b) => b !== first && b.stopBefore === first.stopBefore).map((b) => b.limit);

  // ---- what would not have happened ----
  let remainder: Remainder | null = null;
  if (first !== null) {
    const cut = first.stopBefore;
    const notStarted = stepList.filter((s) => s.startSequence >= cut);
    const inFlight = stepList.filter((s) => s.startSequence < cut && s.endSequence >= cut);
    const sum = (list: StepRecord[]) => {
      let i = 0n;
      let o = 0n;
      for (const s of list) {
        const u = usageByStep.get(s.stepId);
        if (u) { i += u.input; o += u.output; }
      }
      return { input: i, output: o };
    };
    remainder = {
      notStarted, inFlight, tokensNotStarted: sum(notStarted), tokensInFlight: sum(inFlight),
      modelCallsNotStarted: notStarted.filter((s) => s.kind === "LLM_CALL").length,
      toolCallsNotStarted: notStarted.filter((s) => s.kind === "TOOL_CALL").length,
    };
  }

  return {
    policy, breaches, first, alsoAtSameStop, remainder, steps: stepList, recorded, totalsAt,
    costPicoAt: (position) => costPico(policy, totalsAt(position)),
    usageGaps: { modelCallsWithoutUsage, partialUsage },
    estimatedEnds,
  };
}

// ---- formatting exact amounts ----
/**
 * Cost in 10^-12 currency units, shown with every digit it is computed with (2 to 12 decimals, trailing zeros
 * trimmed) and no float, so a breach by a tiny amount can still be explained.
 */
export function formatPico(pico: bigint): string {
  const unit = 10n ** 12n;
  const whole = pico / unit;
  const decimals = (pico % unit).toString().padStart(12, "0").replace(/0+$/, "").padEnd(2, "0");
  return `${whole.toString()}.${decimals}`;
}
export function formatMicro(micro: bigint): string {
  return formatPico(micro * MICRO_TO_PICO);
}
