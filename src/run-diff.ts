// Run diff: compares two recorded runs offline and finds where they first differ.
//
// Step ids are random per run, so steps are matched by what they are (their title: kind plus tool or agent name),
// in the order of the step tree, never by id. Matching uses the longest common sequence of titles, so one inserted
// or missing step does not make every later step look different. Matched steps are then compared on outcome
// (failed or not), token counts and recorded content. Content is compared by fingerprint: a withheld value keeps
// the SHA-256 of its canonical text, and a stored value can be fingerprinted the same way, so a run imported with
// content and one imported without it can still be compared.
// Not compared per step: how long it took (two honest runs never take exactly as long); the totals show duration.
// No model call and no network. It reads only runs the reducer has already validated.
import { canonicalJson, sha256Hex } from "./canonical.js";
import type { RunModel, StepView } from "./frontend/run-replay-model.js";

/** Runs with more steps than this are not compared (the answer would be too slow to be useful). */
export const DIFF_LIMITS = { maxSteps: 5000, maxAlignCells: 4_000_000 } as const;

export type DiffChangeCode = "STATUS" | "INPUT_TOKENS" | "OUTPUT_TOKENS" | "CONTENT";
export type DiffChange = { code: DiffChangeCode; a: string; b: string; fields: string[] };

export type DiffItem = {
  status: "same" | "changed" | "onlyA" | "onlyB";
  a: StepView | null;
  b: StepView | null;
  changes: DiffChange[];
};

export type RunTotals = {
  steps: number;
  modelCalls: number;
  toolCalls: number;
  failedSteps: number;
  inputTokens: bigint;
  outputTokens: bigint;
  durationNs: bigint;
  // Steps whose token counts the trace did not report (counted as zero above).
  stepsMissingTokens: number;
};

export type DiffResult = {
  tooLarge: boolean;
  /** False when the two runs were too different to line up in full; the unmatched middle is listed as removed and added. */
  fullyAligned: boolean;
  items: DiffItem[];
  firstIndex: number; // index in `items` of the first difference, or -1
  first: DiffItem | null;
  counts: { same: number; changed: number; onlyA: number; onlyB: number };
  totals: { a: RunTotals; b: RunTotals };
  tools: Array<{ tool: string; a: number; b: number }>; // only tools whose call counts differ
  contentComparable: boolean; // false when no step in either run recorded any content
  identical: boolean;
};

type Fingerprints = Map<string, string>;

const fingerprintOf = (field: { v: unknown } | { w: { n: number; h: string } }): string => {
  if ("w" in field) return `${field.w.n}:${field.w.h}`;
  const text = canonicalJson(field.v);
  return `${Buffer.byteLength(text, "utf8")}:${sha256Hex(text)}`;
};

function contentByStep(model: RunModel): Map<string, Fingerprints> {
  const byStep = new Map<string, Fingerprints>();
  for (const event of model.events) {
    if (event.type !== "ContentRecorded") continue;
    const p = event.payload;
    const stepId = p.stepId;
    if (stepId === null) continue;
    const key = `${p.channel}|${p.field}|${p.fieldKey === undefined ? "" : fingerprintOf(p.fieldKey)}|${p.ordinal}`;
    const map = byStep.get(stepId) ?? new Map<string, string>();
    map.set(key, fingerprintOf(p.value));
    byStep.set(stepId, map);
  }
  return byStep;
}

const fieldNameOf = (key: string): string => key.split("|")[1];

function totalsOf(model: RunModel): RunTotals {
  let modelCalls = 0;
  let toolCalls = 0;
  let failed = 0;
  let missing = 0;
  let input = 0n;
  let output = 0n;
  let first: bigint | null = null;
  let last: bigint | null = null;
  for (const step of model.steps) {
    if (step.kind === "LLM_CALL") modelCalls += 1;
    if (step.kind === "TOOL_CALL") toolCalls += 1;
    if (step.failed) failed += 1;
    if (step.kind === "LLM_CALL" && (step.inputTokens === null || step.outputTokens === null)) missing += 1;
    input += step.inputTokens === null ? 0n : BigInt(step.inputTokens);
    output += step.outputTokens === null ? 0n : BigInt(step.outputTokens);
    const start = BigInt(step.startNs);
    const end = BigInt(step.endEffectiveNs);
    if (first === null || start < first) first = start;
    if (last === null || end > last) last = end;
  }
  return {
    steps: model.steps.length, modelCalls, toolCalls, failedSteps: failed, inputTokens: input, outputTokens: output,
    durationNs: first === null || last === null || last < first ? 0n : last - first, stepsMissingTokens: missing,
  };
}

const emptyTotals = (): RunTotals => ({
  steps: 0, modelCalls: 0, toolCalls: 0, failedSteps: 0, inputTokens: 0n, outputTokens: 0n, durationNs: 0n, stepsMissingTokens: 0,
});

function compareSteps(a: StepView, b: StepView, ca: Fingerprints | undefined, cb: Fingerprints | undefined): DiffChange[] {
  const changes: DiffChange[] = [];
  if (a.failed !== b.failed) changes.push({ code: "STATUS", a: a.failed ? "failed" : "ok", b: b.failed ? "failed" : "ok", fields: [] });
  const tokens = (code: DiffChangeCode, x: string | null, y: string | null): void => {
    if (x !== y) changes.push({ code, a: x ?? "not reported", b: y ?? "not reported", fields: [] });
  };
  tokens("INPUT_TOKENS", a.inputTokens, b.inputTokens);
  tokens("OUTPUT_TOKENS", a.outputTokens, b.outputTokens);
  if (ca !== undefined || cb !== undefined) {
    const differing = new Set<string>();
    for (const [key, value] of ca ?? []) if (cb?.get(key) !== value) differing.add(fieldNameOf(key));
    for (const key of cb?.keys() ?? []) if (!ca?.has(key)) differing.add(fieldNameOf(key));
    if (differing.size > 0) changes.push({ code: "CONTENT", a: "", b: "", fields: [...differing].sort() });
  }
  return changes;
}

/** Longest common subsequence of two title lists, as aligned pairs and gaps, in order. Deterministic on ties. */
function align(a: string[], b: string[]): Array<{ kind: "both" | "onlyA" | "onlyB"; i: number; j: number }> {
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const table = new Uint16Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * width + j] = a[i] === b[j] ? table[(i + 1) * width + j + 1] + 1
        : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  const out: Array<{ kind: "both" | "onlyA" | "onlyB"; i: number; j: number }> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ kind: "both", i, j }); i += 1; j += 1; }
    else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) { out.push({ kind: "onlyA", i, j }); i += 1; }
    else { out.push({ kind: "onlyB", i, j }); j += 1; }
  }
  while (i < n) { out.push({ kind: "onlyA", i, j }); i += 1; }
  while (j < m) { out.push({ kind: "onlyB", i, j }); j += 1; }
  return out;
}

export function diffRuns(runA: RunModel, runB: RunModel): DiffResult {
  const totals = { a: totalsOf(runA), b: totalsOf(runB) };
  if (runA.steps.length > DIFF_LIMITS.maxSteps || runB.steps.length > DIFF_LIMITS.maxSteps) {
    return {
      tooLarge: true, fullyAligned: false, items: [], firstIndex: -1, first: null, counts: { same: 0, changed: 0, onlyA: 0, onlyB: 0 },
      totals: { a: emptyTotals(), b: emptyTotals() }, tools: [], contentComparable: false, identical: false,
    };
  }
  const sa = runA.steps;
  const sb = runB.steps;
  const ta = sa.map((s) => s.title);
  const tb = sb.map((s) => s.title);

  // Trim what both runs share at the start and the end, then align only the middle.
  let prefix = 0;
  while (prefix < ta.length && prefix < tb.length && ta[prefix] === tb[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < ta.length - prefix && suffix < tb.length - prefix && ta[ta.length - 1 - suffix] === tb[tb.length - 1 - suffix]) suffix += 1;
  const midA = ta.slice(prefix, ta.length - suffix);
  const midB = tb.slice(prefix, tb.length - suffix);
  const fullyAligned = (midA.length + 1) * (midB.length + 1) <= DIFF_LIMITS.maxAlignCells;

  const pairs: Array<{ kind: "both" | "onlyA" | "onlyB"; i: number; j: number }> = [];
  for (let k = 0; k < prefix; k += 1) pairs.push({ kind: "both", i: k, j: k });
  if (fullyAligned) {
    for (const p of align(midA, midB)) pairs.push({ ...p, i: p.i + prefix, j: p.j + prefix });
  } else {
    for (let k = 0; k < midA.length; k += 1) pairs.push({ kind: "onlyA", i: prefix + k, j: prefix });
    for (let k = 0; k < midB.length; k += 1) pairs.push({ kind: "onlyB", i: prefix + midA.length, j: prefix + k });
  }
  for (let k = 0; k < suffix; k += 1) pairs.push({ kind: "both", i: ta.length - suffix + k, j: tb.length - suffix + k });

  const contentA = contentByStep(runA);
  const contentB = contentByStep(runB);
  const items: DiffItem[] = pairs.map((p) => {
    if (p.kind === "onlyA") return { status: "onlyA", a: sa[p.i], b: null, changes: [] };
    if (p.kind === "onlyB") return { status: "onlyB", a: null, b: sb[p.j], changes: [] };
    const changes = compareSteps(sa[p.i], sb[p.j], contentA.get(sa[p.i].stepId), contentB.get(sb[p.j].stepId));
    return { status: changes.length === 0 ? "same" : "changed", a: sa[p.i], b: sb[p.j], changes };
  });
  const counts = { same: 0, changed: 0, onlyA: 0, onlyB: 0 };
  for (const item of items) counts[item.status] += 1;
  const firstIndex = items.findIndex((item) => item.status !== "same");

  const toolCounts = new Map<string, [number, number]>();
  const bump = (steps: StepView[], slot: 0 | 1): void => {
    for (const s of steps) {
      if (s.kind !== "TOOL_CALL") continue;
      const entry = toolCounts.get(s.title) ?? [0, 0];
      entry[slot] += 1;
      toolCounts.set(s.title, entry);
    }
  };
  bump(sa, 0);
  bump(sb, 1);
  const tools = [...toolCounts.entries()].filter(([, [x, y]]) => x !== y)
    .map(([tool, [x, y]]) => ({ tool, a: x, b: y })).sort((p, q) => (p.tool < q.tool ? -1 : p.tool > q.tool ? 1 : 0));

  const identical = firstIndex === -1;
  return {
    tooLarge: false, fullyAligned, items, firstIndex, first: firstIndex === -1 ? null : items[firstIndex], counts, totals, tools,
    contentComparable: contentA.size > 0 || contentB.size > 0, identical,
  };
}
