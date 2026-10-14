// Run diff: compares two recorded runs offline and finds where they first differ.
//
// Step ids are random per run, so steps are matched by what they are, in the order of the step tree, never by id.
// "What they are" is a signature built from complete recorded values (kind, label, operation name, tool name and
// agent name; the label carries the operation and the model name), not from the shortened title shown to people,
// so names that differ only past the title's cut-off are still different. Matching uses the longest common sequence of signatures, so one inserted
// or missing step does not make every later step look different. Matched steps are then compared on where they sit
// (the step they are nested under, through the matching, not through ids), outcome (failed or not), the status
// message, token counts and recorded content. Content is compared by fingerprint: a withheld value keeps
// the SHA-256 of its canonical text, and a stored value can be fingerprinted the same way, so a run imported with
// content and one imported without it can still be compared. Content that arrived through log records is kept
// as an ordered list of whole records (everything one record carried), so a body and an attribute cannot move
// from one record to another unnoticed.
// Not compared: how long a step took (two honest runs never take exactly as long; the totals show duration),
// step events, log record times and severities, log records that carry no content, attributes that are neither a
// name used for matching (operation, model, tool, agent) nor recorded content, and content of log records that
// belong to no step. The report says so.
// No model call and no network. It reads only runs the reducer has already validated.
import { canonicalJson, sha256Hex } from "./canonical.js";
import type { RunModel, StepView } from "./frontend/run-replay-model.js";

/** Runs with more steps than this are not compared (the answer would be too slow to be useful). */
export const DIFF_LIMITS = { maxSteps: 5000, maxAlignCells: 4_000_000 } as const;

export type DiffChangeCode = "STATUS" | "STATUS_MESSAGE" | "PARENT" | "INPUT_TOKENS" | "OUTPUT_TOKENS" | "CONTENT";
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
  /** Matched steps whose nesting could not be checked because a parent fell in the part that was not lined up. */
  unverifiedNesting: number;
  identical: boolean;
};

type Fingerprints = Map<string, string>;
type StepFacts = { signature: string; message: string; content: Fingerprints; logRecords: string[] };
type FieldLike = { v: unknown } | { w: { n: number; h: string } };

const fingerprintOf = (field: FieldLike): string => {
  if ("w" in field) return `${field.w.n}:${field.w.h}`;
  const text = canonicalJson(field.v);
  return `${Buffer.byteLength(text, "utf8")}:${sha256Hex(text)}`;
};

function attributeFingerprint(attributes: Array<{ key: FieldLike; value: FieldLike }>, name: string): string {
  for (const a of attributes) {
    const key = a.key as { v?: { t?: string; v?: unknown } };
    if (key.v?.t === "s" && key.v.v === name) return fingerprintOf(a.value);
  }
  return "-";
}

/**
 * What each step is and what was recorded for it, from complete values. The signature uses the kind, label,
 * operation name, tool name and agent name. Content is kept as a list per key in event order, so a key recorded
 * twice is not collapsed to its last value. Content that arrived through log records counts for the step the log
 * record belongs to, kept as one entry per record (in event order) holding everything that record carried;
 * content of a log record with no step is not compared.
 */
function factsByStep(model: RunModel): Map<string, StepFacts> {
  const facts = new Map<string, StepFacts>();
  const logStep = new Map<number, string>();
  const lists = new Map<string, Map<string, string[]>>();
  const bundles = new Map<number, { stepId: string; items: string[] }>();
  for (const event of model.events) {
    if (event.type === "StepStarted") {
      const p = event.payload;
      const signature = JSON.stringify([
        p.kind, p.label, p.operationName === null ? "-" : fingerprintOf(p.operationName),
        attributeFingerprint(p.attributes, "gen_ai.tool.name"), attributeFingerprint(p.attributes, "gen_ai.agent.name"),
      ]);
      facts.set(p.stepId, { signature, message: "", content: new Map(), logRecords: [] });
    } else if (event.type === "StepEnded") {
      const f = facts.get(event.payload.stepId);
      if (f) f.message = fingerprintOf(event.payload.statusMessage);
    } else if (event.type === "LogRecorded" && event.payload.stepId !== null) {
      logStep.set(event.payload.logOrdinal, event.payload.stepId);
    } else if (event.type === "ContentRecorded") {
      const p = event.payload;
      const fieldKey = p.fieldKey === undefined ? "" : fingerprintOf(p.fieldKey);
      if (p.stepId === null) {
        const logOrdinal = p.logOrdinal as number;
        const owner = logStep.get(logOrdinal);
        if (owner === undefined) continue;
        const bundle = bundles.get(logOrdinal) ?? { stepId: owner, items: [] };
        bundle.items.push(`${p.field}|${fieldKey}|${p.ordinal}=${fingerprintOf(p.value)}`);
        bundles.set(logOrdinal, bundle);
        continue;
      }
      const stepId = p.stepId;
      const key = `${p.channel}|${p.field}|${fieldKey}|${p.ordinal}`;
      const perStep = lists.get(stepId) ?? new Map<string, string[]>();
      const list = perStep.get(key) ?? [];
      list.push(fingerprintOf(p.value));
      perStep.set(key, list);
      lists.set(stepId, perStep);
    }
  }
  for (const bundle of bundles.values()) facts.get(bundle.stepId)?.logRecords.push(bundle.items.join(","));
  for (const [stepId, perStep] of lists) {
    const f = facts.get(stepId);
    if (f) for (const [key, list] of perStep) f.content.set(key, list.join(","));
  }
  return facts;
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

function compareSteps(a: StepView, b: StepView, fa: StepFacts, fb: StepFacts, sameParent: boolean): DiffChange[] {
  const changes: DiffChange[] = [];
  if (!sameParent) changes.push({ code: "PARENT", a: "", b: "", fields: [] });
  if (a.failed !== b.failed) changes.push({ code: "STATUS", a: a.failed ? "failed" : "ok", b: b.failed ? "failed" : "ok", fields: [] });
  if (fa.message !== fb.message) changes.push({ code: "STATUS_MESSAGE", a: "", b: "", fields: [] });
  const tokens = (code: DiffChangeCode, x: string | null, y: string | null): void => {
    if (x !== y) changes.push({ code, a: x ?? "not reported", b: y ?? "not reported", fields: [] });
  };
  tokens("INPUT_TOKENS", a.inputTokens, b.inputTokens);
  tokens("OUTPUT_TOKENS", a.outputTokens, b.outputTokens);
  if (fa.content.size > 0 || fb.content.size > 0 || fa.logRecords.length > 0 || fb.logRecords.length > 0) {
    const differing = new Set<string>();
    for (const [key, value] of fa.content) if (fb.content.get(key) !== value) differing.add(fieldNameOf(key));
    for (const key of fb.content.keys()) if (!fa.content.has(key)) differing.add(fieldNameOf(key));
    if (fa.logRecords.length !== fb.logRecords.length || fa.logRecords.some((record, k) => record !== fb.logRecords[k])) differing.add("log records");
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
      totals: { a: emptyTotals(), b: emptyTotals() }, tools: [], contentComparable: false, unverifiedNesting: 0, identical: false,
    };
  }
  const sa = runA.steps;
  const sb = runB.steps;
  const factsA = factsByStep(runA);
  const factsB = factsByStep(runB);
  const ta = sa.map((s) => (factsA.get(s.stepId) as StepFacts).signature);
  const tb = sb.map((s) => (factsB.get(s.stepId) as StepFacts).signature);

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

  // Where each step sits: the index of its parent step, or -1 for a top-level step. A parent is "the same" when
  // it is matched to the other run's parent. (Ids are never compared.)
  const indexA = new Map(sa.map((x, k) => [x.stepId, k]));
  const indexB = new Map(sb.map((x, k) => [x.stepId, k]));
  const parentOf = (step: StepView, index: Map<string, number>): number => (step.parentStepId === null ? -1 : index.get(step.parentStepId) ?? -1);
  const partner = new Map<number, number>();
  const partnerBack = new Map<number, number>();
  for (const p of pairs) if (p.kind === "both") { partner.set(p.i, p.j); partnerBack.set(p.j, p.i); }
  let unverifiedNesting = 0;
  const items: DiffItem[] = pairs.map((p) => {
    if (p.kind === "onlyA") return { status: "onlyA", a: sa[p.i], b: null, changes: [] };
    if (p.kind === "onlyB") return { status: "onlyB", a: null, b: sb[p.j], changes: [] };
    const pa = parentOf(sa[p.i], indexA);
    const pb = parentOf(sb[p.j], indexB);
    // When the runs were too different to line up in full, a parent that sits in the unlined part has no known
    // partner, so the nesting of its children is unknown, not changed.
    const unresolved = !fullyAligned && ((pa !== -1 && !partner.has(pa)) || (pb !== -1 && !partnerBack.has(pb)));
    if (unresolved) unverifiedNesting += 1;
    const sameParent = unresolved || (pa === -1 ? pb === -1 : partner.get(pa) === pb);
    const changes = compareSteps(sa[p.i], sb[p.j], factsA.get(sa[p.i].stepId) as StepFacts, factsB.get(sb[p.j].stepId) as StepFacts, sameParent);
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
    contentComparable: [...factsA.values(), ...factsB.values()].some((f) => f.content.size > 0 || f.logRecords.length > 0),
    unverifiedNesting, identical,
  };
}
