// Phases 3 to 6 of the import (spec section 2): select the trace, filter to it, collapse duplicates,
// repair parents, then repair times. The result is a normalized run that the emitter (phase 7) orders
// and writes out. Every list here is sorted by content, never by input position, so permuting the
// input spans or logs cannot change the outcome.
import { canonicalJson, compareUtf8, sha256Hex } from "./canonical.js";
import { ImportError } from "./run-import-error.js";
import type { ImportNoteCode } from "./run-events.js";
import type { ParsedContext, ParsedLogRecord, ParsedSpan } from "./otlp-structure.js";

export type ImportNoteDraft = {
  code: ImportNoteCode;
  stepId: string | null;
  detail: Record<string, number | string>;
};

export type NormalSpan = Omit<ParsedSpan, "contextIndex"> & {
  contextId: string;
  parentStepId: string | null;
  depth: number;
  endEffectiveNs: string;
};

export type NormalLog = Omit<ParsedLogRecord, "contextIndex"> & {
  contextId: string;
  // The step this log belongs to, or null for an orphan.
  stepId: string | null;
  // Canonical serialization (identity and final ordering tie-breaker).
  canonical: string;
};

export type NormalizedRun = {
  traceId: string;
  selectedTrace: "ONLY" | "EXPLICIT";
  spans: NormalSpan[];
  logs: NormalLog[];
  contexts: Array<{ contextId: string; context: ParsedContext }>;
  // Largest start or valid end time among the selected spans (spec 4.1).
  maxNs: string;
  notes: ImportNoteDraft[];
};

export type NormalizeInput = {
  spans: ParsedSpan[];
  spanContexts: ParsedContext[];
  logs?: ParsedLogRecord[];
  logContexts?: ParsedContext[];
  selectTrace?: string;
};

export const MAX_SPAN_TREE_DEPTH = 256;

const bigOf = (text: string): bigint => BigInt(text);

export function normalizeRun(input: NormalizeInput): NormalizedRun {
  const stage = "normalize";
  const notes: ImportNoteDraft[] = [];
  const logs = input.logs ?? [];
  const logContexts = input.logContexts ?? [];

  // Phase 3: select the trace.
  if (input.spans.length === 0) throw new ImportError("E_EMPTY", stage);
  const traceIds = [...new Set(input.spans.map((s) => s.traceId))].sort();
  let traceId: string;
  let selectedTrace: "ONLY" | "EXPLICIT";
  if (input.selectTrace !== undefined) {
    if (!/^[0-9a-fA-F]{32}$/.test(input.selectTrace)) throw new ImportError("E_ID", stage);
    traceId = input.selectTrace.toLowerCase();
    if (!traceIds.includes(traceId)) throw new ImportError("E_TRACE_NOT_FOUND", stage);
    selectedTrace = "EXPLICIT";
  } else {
    if (traceIds.length > 1) throw new ImportError("E_MULTIPLE_TRACES", stage);
    traceId = traceIds[0];
    selectedTrace = "ONLY";
  }

  // Phase 4: filter to the selected trace before anything else.
  const selectedSpans = input.spans.filter((s) => s.traceId === traceId);
  const selectedLogs = logs.filter((l) => l.traceId === null || l.traceId === traceId);
  const excludedSpans = input.spans.length - selectedSpans.length;
  const excludedLogs = logs.length - selectedLogs.length;
  if (excludedSpans + excludedLogs > 0) {
    notes.push({ code: "OTHER_TRACE_EXCLUDED", stepId: null, detail: { spans: excludedSpans, logs: excludedLogs } });
  }

  // Phase 5: collapse duplicates. Contexts are content-addressed so identity needs no input position.
  // A context (resource and scope) is shared by many spans and logs, so it is serialized and hashed once.
  // The hash stands in for the full context in span and log identities, which keeps those identities
  // small however large the shared resource is.
  const contextByKey = new Map<string, ParsedContext>();
  const keyOfContext = new Map<ParsedContext, string>();
  const keyOfResource = new Map<ParsedContext["resource"], string>();
  const resourceKeyOf = (resource: ParsedContext["resource"]): string => {
    const known = keyOfResource.get(resource);
    if (known !== undefined) return known;
    const key = sha256Hex(canonicalJson(resource));
    keyOfResource.set(resource, key);
    return key;
  };
  const contextKeyOf = (context: ParsedContext): string => {
    const known = keyOfContext.get(context);
    if (known !== undefined) return known;
    // The (possibly large) resource is shared by every scope under it, so only its hash is combined here.
    const key = sha256Hex(canonicalJson({ resource: resourceKeyOf(context.resource), scope: context.scope, unknownCount: context.unknownCount }));
    keyOfContext.set(context, key);
    if (!contextByKey.has(key)) contextByKey.set(key, context);
    return key;
  };
  const spanEntries = selectedSpans.map((span) => {
    const { contextIndex, ...rest } = span;
    return { span: rest, contextKey: contextKeyOf(input.spanContexts[contextIndex]) };
  });
  const logEntries = selectedLogs.map((log) => {
    const { contextIndex, ...rest } = log;
    return { log: rest, contextKey: contextKeyOf(logContexts[contextIndex]) };
  });

  const spanById = new Map<string, { span: Omit<ParsedSpan, "contextIndex">; contextKey: string; identity: string }>();
  let collapsedSpans = 0;
  for (const entry of spanEntries) {
    const identity = canonicalJson({ span: entry.span, context: entry.contextKey });
    const existing = spanById.get(entry.span.spanId);
    if (existing === undefined) spanById.set(entry.span.spanId, { ...entry, identity });
    else if (existing.identity === identity) collapsedSpans += 1;
    else throw new ImportError("E_CONFLICTING_DUPLICATE", stage);
  }
  if (collapsedSpans > 0) notes.push({ code: "DUPLICATE_SPAN_COLLAPSED", stepId: null, detail: { count: collapsedSpans } });

  const logByIdentity = new Map<string, (typeof logEntries)[number]>();
  let collapsedLogs = 0;
  for (const entry of logEntries) {
    const identity = canonicalJson({ log: entry.log, context: entry.contextKey });
    if (logByIdentity.has(identity)) collapsedLogs += 1;
    else logByIdentity.set(identity, entry);
  }
  if (collapsedLogs > 0) notes.push({ code: "DUPLICATE_LOG_COLLAPSED", stepId: null, detail: { count: collapsedLogs } });

  // Context ids come from the sorted canonical contexts that are actually used.
  const usedKeys = new Set<string>();
  for (const e of spanById.values()) usedKeys.add(e.contextKey);
  for (const e of logByIdentity.values()) usedKeys.add(e.contextKey);
  const sortedKeys = [...usedKeys].sort();
  const contextIdOf = new Map(sortedKeys.map((key, index) => [key, `c${index}`]));
  const contexts = sortedKeys.map((key) => ({
    contextId: contextIdOf.get(key) as string,
    context: contextByKey.get(key) as ParsedContext,
  }));

  // Phase 6a: repair parents. A missing parent makes the span a root; each cycle loses one edge.
  const ids = [...spanById.keys()].sort();
  const parent = new Map<string, string | null>();
  for (const id of ids) {
    const declared = (spanById.get(id) as { span: Omit<ParsedSpan, "contextIndex"> }).span.parentSpanId;
    if (declared !== null && !spanById.has(declared)) {
      parent.set(id, null);
      notes.push({ code: "MISSING_PARENT", stepId: id, detail: {} });
    } else {
      parent.set(id, declared);
    }
  }
  const visit = new Map<string, 1 | 2>();
  for (const start of ids) {
    if (visit.get(start) === 2) continue;
    const path: string[] = [];
    let current: string | null = start;
    while (current !== null && visit.get(current) === undefined) {
      visit.set(current, 1);
      path.push(current);
      current = parent.get(current) as string | null;
    }
    if (current !== null && visit.get(current) === 1) {
      const cycle = path.slice(path.indexOf(current));
      const smallest = cycle.reduce((a, b) => (b < a ? b : a));
      parent.set(smallest, null);
      notes.push({ code: "PARENT_CYCLE_BROKEN", stepId: smallest, detail: {} });
    }
    for (const id of path) visit.set(id, 2);
  }
  const depth = new Map<string, number>();
  for (const id of ids) {
    const chain: string[] = [];
    let current: string | null = id;
    while (current !== null && !depth.has(current)) {
      chain.push(current);
      current = parent.get(current) as string | null;
    }
    let d = current === null ? -1 : (depth.get(current) as number);
    for (let i = chain.length - 1; i >= 0; i -= 1) {
      d += 1;
      if (d > MAX_SPAN_TREE_DEPTH) throw new ImportError("E_LIMIT", stage);
      depth.set(chain[i], d);
    }
  }

  // Phase 6b: repair times. M ignores unfinished spans, so it does not depend on their repair.
  let maxNs = 0n;
  for (const id of ids) {
    const { span } = spanById.get(id) as { span: Omit<ParsedSpan, "contextIndex"> };
    const start = bigOf(span.startNs);
    if (start > maxNs) maxNs = start;
    if (span.endNs !== null) {
      const end = bigOf(span.endNs);
      if (end !== 0n && end >= start && end > maxNs) maxNs = end;
    }
  }
  const effectiveEnd = new Map<string, bigint>();
  for (const id of ids) {
    const { span } = spanById.get(id) as { span: Omit<ParsedSpan, "contextIndex"> };
    const start = bigOf(span.startNs);
    const end = span.endNs === null ? 0n : bigOf(span.endNs);
    if (end === 0n) {
      effectiveEnd.set(id, maxNs);
      notes.push({ code: "UNFINISHED_SPAN_CLOSED", stepId: id, detail: {} });
    } else if (end < start) {
      effectiveEnd.set(id, start);
      notes.push({ code: "NEGATIVE_DURATION_CLAMPED", stepId: id, detail: {} });
    } else {
      effectiveEnd.set(id, end);
    }
  }
  for (const id of ids) {
    const parentId = parent.get(id);
    if (parentId === null || parentId === undefined) continue;
    const { span } = spanById.get(id) as { span: Omit<ParsedSpan, "contextIndex"> };
    const parentEnd = effectiveEnd.get(parentId) as bigint;
    if (bigOf(span.startNs) >= parentEnd || (effectiveEnd.get(id) as bigint) > parentEnd) {
      notes.push({ code: "CHILD_OUTSIDE_PARENT_INTERVAL", stepId: id, detail: {} });
    }
  }

  const spans: NormalSpan[] = ids.map((id) => {
    const entry = spanById.get(id) as { span: Omit<ParsedSpan, "contextIndex">; contextKey: string };
    return {
      ...entry.span,
      contextId: contextIdOf.get(entry.contextKey) as string,
      parentStepId: parent.get(id) as string | null,
      depth: depth.get(id) as number,
      endEffectiveNs: (effectiveEnd.get(id) as bigint).toString(),
    };
  });

  // Logs associate by (trace id, span id). Anything else of the selected trace is an orphan.
  const normalLogs: NormalLog[] = [...logByIdentity.entries()]
    .map(([canonical, entry]) => {
      const stepId = entry.log.traceId === traceId && entry.log.spanId !== null && spanById.has(entry.log.spanId)
        ? entry.log.spanId
        : null;
      return { ...entry.log, contextId: contextIdOf.get(entry.contextKey) as string, stepId, canonical };
    })
    .sort((a, b) => compareUtf8(a.canonical, b.canonical));

  return { traceId, selectedTrace, spans, logs: normalLogs, contexts, maxNs: maxNs.toString(), notes };
}

// A stable fingerprint of a normalized run, handy for tests that prove order independence.
export function fingerprintRun(run: NormalizedRun): string {
  return sha256Hex(canonicalJson(run));
}
