// The run reducer: validates a run-event history (spec section 9) and rebuilds the recorded state at any
// step (spec section 8.3). Pure and deterministic. It never trusts its input: every event is checked
// against the schemas, the ordering rules and, for HASH_ONLY runs, the privacy rules, so a run file that
// was edited by hand cannot smuggle content past the importer's guarantees.
//
// "State" here is only what the recording shows. It makes no claim about the model's hidden context.
import { runEventSchema, type Field, type RunEvent, type StepKind } from "./run-events.js";
import { ALLOWLIST, SCHEMA_URL, SCOPE_NAME, SCOPE_VERSION } from "./run-privacy.js";
import { ImportError } from "./run-import-error.js";
import { MAX_OUTPUT_EVENTS } from "./run-emit.js";

export type RunState = {
  sequenceNumber: number;
  openStepIds: string[];
  closedStepIds: string[];
  // Steps started so far, by kind.
  stepsByKind: Record<StepKind, number>;
  // Exact cumulative totals as decimal strings. A missing metric adds nothing (it is not zero).
  inputTokens: string;
  outputTokens: string;
  // Content recorded so far, counted by "channel:field".
  content: Record<string, number>;
  // Steps that ended with status code 2.
  errorStepIds: string[];
  notes: Record<string, number>;
  logCount: number;
  ended: boolean;
};

const fail = (reason: string, event?: RunEvent): never => {
  throw new ImportError("E_INVALID_LOG", "reduce", null, event === undefined ? reason : `${reason} at event ${event.sequenceNumber}`);
};

// ---- HASH_ONLY privacy re-check ----
const isWithheld = (f: Field): boolean => "w" in f;
const verbatimString = (f: Field): string | null => ("v" in f && f.v.t === "s" ? f.v.v : null);

function checkAttributes(
  list: Array<{ ordinal: number; key: Field; value: Field }>, allowlisted: boolean, event: RunEvent,
): void {
  for (const a of list) {
    const key = verbatimString(a.key);
    if (!isWithheld(a.key)) {
      if (!allowlisted || key === null || !ALLOWLIST.has(key)) fail("CONTENT_NOT_WITHHELD", event);
    }
    if (!isWithheld(a.value)) {
      const check = key === null ? undefined : ALLOWLIST.get(key);
      if (!allowlisted || check === undefined || !("v" in a.value) || !check(a.value.v)) fail("CONTENT_NOT_WITHHELD", event);
    }
  }
}

function checkPatternOrEmpty(f: Field, pattern: RegExp, event: RunEvent): void {
  if (isWithheld(f)) return;
  const text = verbatimString(f);
  if (text === null || (text !== "" && !pattern.test(text))) fail("CONTENT_NOT_WITHHELD", event);
}

function checkHashOnly(event: RunEvent, contextIds: Set<string>): void {
  const mustBeWithheld = (f: Field | null | undefined): void => {
    if (f !== null && f !== undefined && !isWithheld(f)) fail("CONTENT_NOT_WITHHELD", event);
  };
  switch (event.type) {
    case "RunStarted":
      for (const context of event.payload.contexts) {
        contextIds.add(context.contextId);
        checkAttributes(context.resource.attributes, false, event);
        checkAttributes(context.scope.attributes, true, event);
        checkPatternOrEmpty(context.resource.schemaUrl, SCHEMA_URL, event);
        checkPatternOrEmpty(context.scope.schemaUrl, SCHEMA_URL, event);
        checkPatternOrEmpty(context.scope.name, SCOPE_NAME, event);
        checkPatternOrEmpty(context.scope.version, SCOPE_VERSION, event);
      }
      break;
    case "StepStarted": {
      const p = event.payload;
      mustBeWithheld(p.name);
      mustBeWithheld(p.traceState);
      mustBeWithheld(p.unknownFields);
      p.links.forEach(mustBeWithheld);
      checkAttributes(p.attributes, true, event);
      if (p.operationName !== null && !isWithheld(p.operationName)) {
        const check = ALLOWLIST.get("gen_ai.operation.name");
        if (!("v" in p.operationName) || check === undefined || !check(p.operationName.v)) fail("CONTENT_NOT_WITHHELD", event);
      }
      break;
    }
    case "StepEnded":
      mustBeWithheld(event.payload.statusMessage);
      for (const e of event.payload.events) {
        mustBeWithheld(e.name);
        checkAttributes(e.attributes, true, event);
      }
      break;
    case "LogRecorded":
      mustBeWithheld(event.payload.severityText);
      mustBeWithheld(event.payload.eventName);
      checkAttributes(event.payload.attributes, true, event);
      break;
    case "ContentRecorded":
      mustBeWithheld(event.payload.value);
      // The key is withheld too, except the importer's own fixed key for a log body.
      if (event.payload.fieldKey !== undefined && verbatimString(event.payload.fieldKey) !== "log.body") mustBeWithheld(event.payload.fieldKey);
      break;
    default:
      break;
  }
}

// ---- admission (spec section 9) ----
export function validateRunHistory(input: unknown): RunEvent[] {
  if (!Array.isArray(input) || input.length === 0) return fail("EMPTY_HISTORY");
  if (input.length > MAX_OUTPUT_EVENTS) throw new ImportError("E_LIMIT", "reduce");
  const events: RunEvent[] = [];
  for (const raw of input) {
    const parsed = runEventSchema.safeParse(raw);
    if (!parsed.success) return fail("EVENT_SCHEMA", undefined);
    events.push(parsed.data);
  }

  const first = events[0];
  if (first.type !== "RunStarted") return fail("FIRST_NOT_RUN_STARTED", first);
  const hashOnly = first.payload.contentMode === "HASH_ONLY";
  const runId = first.runId;
  if (first.payload.traceId !== runId) fail("RUN_ID_MISMATCH", first);

  const contextIds = new Set<string>();
  const kindOf = new Map<string, StepKind>();
  const parentOf = new Map<string, string | null>();
  const open = new Set<string>();
  const closed = new Set<string>();
  const usageSeen = new Set<string>();
  const logOrdinals = new Set<number>();
  const logStep = new Map<number, string | null>();
  const orphanNotes = new Set<number>();
  let sawNote = false;
  let ended = false;

  events.forEach((event, index) => {
    if (event.sequenceNumber !== index + 1) fail("SEQUENCE_BREAK", event);
    if (event.runId !== runId) fail("RUN_ID_MISMATCH", event);
    if (ended) fail("EVENT_AFTER_RUN_ENDED", event);
    if (event.type !== "RunStarted" && event.type !== "ImportNote" && event.type !== "RunEnded" && sawNote) fail("EVENT_AFTER_NOTE", event);
    if (hashOnly) checkHashOnly(event, contextIds);
    else if (event.type === "RunStarted") event.payload.contexts.forEach((c) => contextIds.add(c.contextId));

    switch (event.type) {
      case "RunStarted":
        if (index !== 0) fail("RUN_STARTED_NOT_UNIQUE", event);
        break;
      case "StepStarted": {
        const p = event.payload;
        if (kindOf.has(p.stepId)) fail("DUPLICATE_STEP", event);
        if (!contextIds.has(p.contextId)) fail("UNKNOWN_CONTEXT", event);
        kindOf.set(p.stepId, p.kind);
        parentOf.set(p.stepId, p.parentStepId);
        open.add(p.stepId);
        break;
      }
      case "StepEnded": {
        const id = event.payload.stepId;
        if (!kindOf.has(id)) fail("END_WITHOUT_START", event);
        if (!open.has(id)) fail("STEP_ENDED_TWICE", event);
        open.delete(id);
        closed.add(id);
        break;
      }
      case "UsageRecorded": {
        const id = event.payload.stepId;
        if (kindOf.get(id) !== "LLM_CALL") fail("USAGE_ON_NON_LLM_STEP", event);
        if (!closed.has(id)) fail("USAGE_BEFORE_STEP_END", event);
        if (usageSeen.has(id)) fail("USAGE_TWICE", event);
        usageSeen.add(id);
        break;
      }
      case "LogRecorded": {
        const p = event.payload;
        if (!contextIds.has(p.contextId)) fail("UNKNOWN_CONTEXT", event);
        if (logOrdinals.has(p.logOrdinal)) fail("DUPLICATE_LOG_ORDINAL", event);
        if (p.stepId !== null && !kindOf.has(p.stepId)) fail("LOG_FOR_UNKNOWN_STEP", event);
        logOrdinals.add(p.logOrdinal);
        logStep.set(p.logOrdinal, p.stepId);
        break;
      }
      case "ContentRecorded": {
        const p = event.payload;
        if (p.channel === "SPAN_ATTRIBUTE" && p.stepId === null) fail("CONTENT_CHANNEL_MISMATCH", event);
        if (p.channel === "LOG_RECORD" && p.logOrdinal === null) fail("CONTENT_CHANNEL_MISMATCH", event);
        if (p.stepId !== null && !kindOf.has(p.stepId)) fail("CONTENT_FOR_UNKNOWN_STEP", event);
        if (p.logOrdinal !== null && !logOrdinals.has(p.logOrdinal)) fail("CONTENT_FOR_UNKNOWN_LOG", event);
        break;
      }
      case "ImportNote": {
        sawNote = true;
        const detail = event.payload.detail;
        if (event.payload.code === "ORPHAN_LOG_RECORD" && typeof detail.logOrdinal === "number") orphanNotes.add(detail.logOrdinal);
        break;
      }
      case "RunEnded":
        if (index !== events.length - 1) fail("RUN_ENDED_NOT_LAST", event);
        if (open.size > 0) fail("OPEN_STEPS_AT_END", event);
        if (event.payload.eventCount !== events.length) fail("EVENT_COUNT_MISMATCH", event);
        ended = true;
        break;
    }
  });

  const last = events[events.length - 1];
  if (last.type !== "RunEnded") return fail("MISSING_RUN_ENDED", last);
  // Parent references are checked for existence only (clock skew can start a child before its parent).
  for (const parent of parentOf.values()) if (parent !== null && !kindOf.has(parent)) fail("PARENT_MISSING", last);
  // A log with no step needs its orphan note.
  for (const [ordinal, step] of logStep) if (step === null && !orphanNotes.has(ordinal)) fail("ORPHAN_LOG_WITHOUT_NOTE", last);
  for (let i = 0; i < logOrdinals.size; i += 1) if (!logOrdinals.has(i)) fail("LOG_ORDINAL_GAP", last);
  return events;
}

// ---- state ----
class Accumulator {
  open = new Set<string>();
  closed = new Set<string>();
  kinds = new Map<string, StepKind>();
  byKind: Record<StepKind, number> = { LLM_CALL: 0, TOOL_CALL: 0, AGENT: 0, OTHER: 0 };
  input = 0n;
  output = 0n;
  content = new Map<string, number>();
  errors = new Set<string>();
  notes = new Map<string, number>();
  logCount = 0;
  ended = false;
  sequenceNumber = 0;

  clone(): Accumulator {
    const copy = new Accumulator();
    copy.open = new Set(this.open);
    copy.closed = new Set(this.closed);
    copy.kinds = new Map(this.kinds);
    copy.byKind = { ...this.byKind };
    copy.input = this.input;
    copy.output = this.output;
    copy.content = new Map(this.content);
    copy.errors = new Set(this.errors);
    copy.notes = new Map(this.notes);
    copy.logCount = this.logCount;
    copy.ended = this.ended;
    copy.sequenceNumber = this.sequenceNumber;
    return copy;
  }

  apply(event: RunEvent): void {
    this.sequenceNumber = event.sequenceNumber;
    switch (event.type) {
      case "StepStarted":
        this.open.add(event.payload.stepId);
        this.kinds.set(event.payload.stepId, event.payload.kind);
        this.byKind[event.payload.kind] += 1;
        break;
      case "StepEnded":
        this.open.delete(event.payload.stepId);
        this.closed.add(event.payload.stepId);
        if (event.payload.statusCode === 2) this.errors.add(event.payload.stepId);
        break;
      case "UsageRecorded":
        if (event.payload.inputTokens !== null) this.input += BigInt(event.payload.inputTokens);
        if (event.payload.outputTokens !== null) this.output += BigInt(event.payload.outputTokens);
        break;
      case "ContentRecorded": {
        const key = `${event.payload.channel}:${event.payload.field}`;
        this.content.set(key, (this.content.get(key) ?? 0) + 1);
        break;
      }
      case "LogRecorded":
        this.logCount += 1;
        break;
      case "ImportNote":
        this.notes.set(event.payload.code, (this.notes.get(event.payload.code) ?? 0) + 1);
        break;
      case "RunEnded":
        this.ended = true;
        break;
      default:
        break;
    }
  }

  snapshot(): RunState {
    const sorted = (set: Set<string>) => [...set].sort();
    const record = (map: Map<string, number>) => Object.fromEntries([...map.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    return {
      sequenceNumber: this.sequenceNumber,
      openStepIds: sorted(this.open),
      closedStepIds: sorted(this.closed),
      stepsByKind: { ...this.byKind },
      inputTokens: this.input.toString(),
      outputTokens: this.output.toString(),
      content: record(this.content),
      errorStepIds: sorted(this.errors),
      notes: record(this.notes),
      logCount: this.logCount,
      ended: this.ended,
    };
  }
}

const CHECKPOINT_EVERY = 256;

export type RunReplay = {
  readonly events: readonly RunEvent[];
  readonly length: number;
  // State after applying events 1..n (n is a sequenceNumber, 1 to length).
  stateAt(n: number): RunState;
};

// Validates once, then answers "state at step N" for any N, resuming from the nearest checkpoint.
export function createReplay(history: unknown): RunReplay {
  const events = validateRunHistory(history);
  const checkpoints: Accumulator[] = [];
  const running = new Accumulator();
  events.forEach((event, index) => {
    running.apply(event);
    if ((index + 1) % CHECKPOINT_EVERY === 0) checkpoints[(index + 1) / CHECKPOINT_EVERY] = running.clone();
  });
  return {
    events,
    length: events.length,
    stateAt(n: number): RunState {
      if (!Number.isInteger(n) || n < 1 || n > events.length) throw new ImportError("E_INVALID_LOG", "reduce", null, "STEP_OUT_OF_RANGE");
      const base = Math.floor(n / CHECKPOINT_EVERY);
      const acc = base > 0 ? (checkpoints[base] as Accumulator).clone() : new Accumulator();
      for (let i = base * CHECKPOINT_EVERY; i < n; i += 1) acc.apply(events[i]);
      return acc.snapshot();
    },
  };
}

export function reduceRun(history: unknown, at?: number): RunState {
  const replay = createReplay(history);
  return replay.stateAt(at ?? replay.length);
}
