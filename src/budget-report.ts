// Plain-language reading of a budget replay result. Pure: used by the replay screen and by the command line, so
// both say the same thing. Every sentence is counterfactual: it describes what a guard with these limits would
// have done to the recorded run, never something the tool did.
import { formatPico, type Breach, type BudgetPolicy, type BudgetReplayResult, type LimitId, type Totals } from "./budget-replay.js";

export const COUNTERFACTUAL_NOTE =
  "This is a what-if. DropScope never controls an agent: it re-applies the limits you typed to the numbers the trace recorded, and says where a guard with those limits would have fired.";

export function group(value: bigint | number): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export const LIMIT_LABEL: Record<LimitId, string> = {
  totalTokens: "Total tokens", inputTokens: "Input tokens", outputTokens: "Output tokens", modelCalls: "Model calls",
  toolCalls: "Tool calls", steps: "Steps", duration: "Time", cost: "Cost",
};

export function formatSeconds(ns: bigint): string {
  const whole = ns / 1_000_000_000n;
  const frac = (ns % 1_000_000_000n).toString().padStart(9, "0").replace(/0+$/, "");
  return frac ? `${group(whole)}.${frac} s` : `${group(whole)} s`;
}

/** A limit's own value in its own unit: "4,000 tokens", "5 s", "0.50 USD". */
export function formatLimitValue(limit: LimitId, value: bigint, policy: BudgetPolicy): string {
  switch (limit) {
    case "totalTokens": case "inputTokens": case "outputTokens": return `${group(value)} token${value === 1n ? "" : "s"}`;
    case "modelCalls": return `${group(value)} model call${value === 1n ? "" : "s"}`;
    case "toolCalls": return `${group(value)} tool call${value === 1n ? "" : "s"}`;
    case "steps": return `${group(value)} step${value === 1n ? "" : "s"}`;
    case "duration": return formatSeconds(value);
    case "cost": return `${formatPico(value)} ${policy.cost?.currency ?? ""}`.trim();
  }
}

/** The limits that are set, in a fixed order, with their label and value. */
export function activeLimits(policy: BudgetPolicy): Array<{ limit: LimitId; label: string; max: bigint; text: string }> {
  const list: Array<{ limit: LimitId; max: bigint | null }> = [
    { limit: "totalTokens", max: policy.maxTotalTokens }, { limit: "inputTokens", max: policy.maxInputTokens },
    { limit: "outputTokens", max: policy.maxOutputTokens }, { limit: "modelCalls", max: policy.maxModelCalls },
    { limit: "toolCalls", max: policy.maxToolCalls }, { limit: "steps", max: policy.maxSteps },
    { limit: "duration", max: policy.maxDurationNs },
    { limit: "cost", max: policy.cost === null ? null : policy.cost.maxMicro * 1_000_000n },
  ];
  return list.filter((l): l is { limit: LimitId; max: bigint } => l.max !== null)
    .map((l) => ({ limit: l.limit, label: LIMIT_LABEL[l.limit], max: l.max, text: formatLimitValue(l.limit, l.max, policy) }));
}

/** How much of each set limit the recorded run had used at a position. */
export function gaugesAt(result: BudgetReplayResult, position: number): Array<{ limit: LimitId; label: string; used: string; max: string; percent: number; over: boolean }> {
  const t: Totals = result.totalsAt(position);
  const pico = result.costPicoAt(position);
  const usedOf = (limit: LimitId): bigint => {
    switch (limit) {
      case "totalTokens": return t.totalTokens;
      case "inputTokens": return t.inputTokens;
      case "outputTokens": return t.outputTokens;
      case "modelCalls": return BigInt(t.modelCalls);
      case "toolCalls": return BigInt(t.toolCalls);
      case "steps": return BigInt(t.steps);
      case "duration": return t.elapsedNs;
      case "cost": return pico ?? 0n;
    }
  };
  return activeLimits(result.policy).map((l) => {
    const used = usedOf(l.limit);
    const over = used > l.max;
    const percent = l.max === 0n ? (used > 0n ? 100 : 0) : Math.min(100, Number((used * 1000n) / l.max) / 10);
    return { limit: l.limit, label: l.label, used: formatLimitValue(l.limit, used, result.policy), max: l.text, percent, over };
  });
}

const stepOfEvent = (events: ReadonlyArray<{ type: string; payload: unknown }>, sequence: number): string | null =>
  (events[sequence - 1]?.payload as { stepId?: string } | undefined)?.stepId ?? null;

/** One sentence saying why and where a limit fires. */
export function describeBreach(
  breach: Breach, policy: BudgetPolicy, events: ReadonlyArray<{ type: string; payload: unknown }>, titleOf: (stepId: string) => string,
): string {
  const limitText = formatLimitValue(breach.limit, breach.limitValue, policy);
  const usedText = formatLimitValue(breach.limit, breach.usedAtBreach, policy);
  const stepId = stepOfEvent(events, breach.breachEvent);
  const step = stepId === null ? "the last step" : titleOf(stepId);
  switch (breach.basis) {
    case "AFTER_THE_FACT":
      return `After ${step} finished, the run had used ${usedText}, over your limit of ${limitText}. A guard that checks after each call would have stopped the agent here.`;
    case "BEFORE_START":
      return `${step} would have been number ${group(breach.usedAtBreach)}, over your limit of ${limitText}, so it would not have started.`;
    case "TIME": {
      const event = events[breach.breachEvent - 1] as { type: string; payload: { endNs?: string | null; endEffectiveNs?: string } } | undefined;
      const began = event?.type === "StepStarted";
      const estimated = !began && event?.payload !== undefined
        && (event.payload.endNs === null || event.payload.endNs === undefined || BigInt(event.payload.endNs) !== BigInt(event.payload.endEffectiveNs ?? "0"));
      return `${formatSeconds(breach.usedAtBreach)} into the run, past your limit of ${limitText}, at the moment ${step} ${began ? "began" : "ended"}${estimated ? " (its end time was missing or invalid, so the importer estimated it)" : ""}. The agent would have been stopped before that.`;
    }
  }
}

export type RemainderLines = { notStarted: string[]; inFlight: string[]; tokens: string[] };

/** What would not have happened, as short lines. */
export function describeRemainder(result: BudgetReplayResult, titleOf: (stepId: string) => string): RemainderLines {
  const r = result.remainder;
  if (r === null) return { notStarted: [], inFlight: [], tokens: [] };
  const list = (steps: Array<{ stepId: string; startSequence: number }>, max = 6): string[] => {
    // The event number tells apart steps that have the same title (two calls to the same tool, say).
    const shown = steps.slice(0, max).map((s) => `${titleOf(s.stepId)} (started at event ${s.startSequence})`);
    if (steps.length > max) shown.push(`and ${steps.length - max} more`);
    return shown;
  };
  const notStarted = r.notStarted.length === 0
    ? ["Every step had already started."]
    : [`${group(r.notStarted.length)} step${r.notStarted.length === 1 ? "" : "s"} would never have started (${group(r.modelCallsNotStarted)} model call${r.modelCallsNotStarted === 1 ? "" : "s"}, ${group(r.toolCallsNotStarted)} tool call${r.toolCallsNotStarted === 1 ? "" : "s"}):`, ...list(r.notStarted)];
  const inFlight = r.inFlight.length === 0
    ? ["No step was running at that moment."]
    : [`${group(r.inFlight.length)} step${r.inFlight.length === 1 ? " was" : "s were"} already running and could not have been recalled:`, ...list(r.inFlight)];
  const tokens: string[] = [];
  const ni = r.tokensNotStarted; const fi = r.tokensInFlight;
  tokens.push(`Tokens recorded for steps that would not have started: ${group(ni.input)} in, ${group(ni.output)} out.`);
  if (r.inFlight.length > 0) tokens.push(`Tokens recorded for steps already running: ${group(fi.input)} in, ${group(fi.output)} out.`);
  if (result.policy.cost !== null) {
    const price = (i: bigint, o: bigint) => formatPico(i * result.policy.cost!.inputPriceMicro + o * result.policy.cost!.outputPriceMicro);
    tokens.push(`Cost of the steps that would not have started: ${price(ni.input, ni.output)} ${result.policy.cost.currency}.`);
  }
  return { notStarted, inFlight, tokens };
}

/** Honest caveats that always apply, plus data-quality warnings for this run. */
export function budgetCaveats(result: BudgetReplayResult): string[] {
  const notes = [
    "Token and cost limits are checked when a call's usage is recorded, which is after the call has finished. A real guard cannot know a call's cost before it runs.",
    "Steps that were already running at the stop point are counted as running: nothing can recall work that has started.",
  ];
  if (result.policy.cost !== null) notes.push("Prices are the ones you typed. DropScope does not look prices up.");
  if (result.policy.maxDurationNs !== null) {
    notes.push("Time is checked only when a step starts or ends, because no other event carries a time. The moment the limit was really passed can be earlier than the event shown.");
    if (result.estimatedEnds > 0) notes.push(`${result.estimatedEnds} step end time${result.estimatedEnds === 1 ? " was" : "s were"} estimated by the importer (missing, or earlier than the start), so time results may be off.`);
  }
  const gaps = result.usageGaps;
  if (gaps.modelCallsWithoutUsage > 0) notes.push(`${gaps.modelCallsWithoutUsage} model call${gaps.modelCallsWithoutUsage === 1 ? "" : "s"} reported no token counts, so the tokens and cost used may be higher than shown.`);
  if (gaps.partialUsage > 0) notes.push(`${gaps.partialUsage} usage record${gaps.partialUsage === 1 ? "" : "s"} reported only input or only output tokens; the missing number is counted as zero.`);
  return notes;
}

/** The whole result as lines of text for the command line. */
export function budgetReportLines(
  result: BudgetReplayResult, events: ReadonlyArray<{ type: string; payload: unknown }>, titleOf: (stepId: string) => string,
): string[] {
  const lines: string[] = [COUNTERFACTUAL_NOTE, ""];
  lines.push(`Limits: ${activeLimits(result.policy).map((l) => `${l.label.toLowerCase()} ${l.text}`).join("; ")}`);
  if (result.first === null) {
    lines.push("Result: the whole run fits inside every limit. Nothing would have been stopped.");
  } else {
    lines.push(`Result: a guard with these limits would have fired at event ${result.first.breachEvent} of ${events.length}.`);
    lines.push(`  ${describeBreach(result.first, result.policy, events, titleOf)}`);
    if (result.alsoAtSameStop.length > 0) lines.push(`  Also exceeded at the same point: ${result.alsoAtSameStop.map((l) => LIMIT_LABEL[l].toLowerCase()).join(", ")}.`);
    const rest = describeRemainder(result, titleOf);
    lines.push("Would not have happened:");
    for (const line of [...rest.notStarted, ...rest.inFlight, ...rest.tokens]) lines.push(`  ${line}`);
    const others = result.breaches.filter((b) => b !== result.first && !result.alsoAtSameStop.includes(b.limit));
    if (others.length > 0) {
      lines.push("Other limits, exceeded later:");
      for (const b of others) lines.push(`  ${LIMIT_LABEL[b.limit]}: at event ${b.breachEvent}.`);
    }
  }
  const r = result.recorded;
  lines.push(`Recorded in the whole run: ${group(r.inputTokens)} input and ${group(r.outputTokens)} output tokens, ${group(r.modelCalls)} model calls, ${group(r.toolCalls)} tool calls, ${group(r.steps)} steps, ${formatSeconds(r.elapsedNs)}.`);
  if (result.policy.cost !== null) lines.push(`Recorded cost with your prices: ${formatPico(result.costPicoAt(events.length) ?? 0n)} ${result.policy.cost.currency}.`);
  lines.push("Notes:");
  for (const note of budgetCaveats(result)) lines.push(`  - ${note}`);
  return lines;
}
