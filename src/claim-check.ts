// Claim checking: is a claim supported by the content a run recorded? Pure, deterministic and offline. It makes
// no model calls and never guesses.
//
// A claim is written by the user (a claims file, see parseClaimFile). It names where the evidence should be (a
// tool name or a step id, and one field of that step) and the exact pieces of text that must appear there.
//
// Rules (the tests pin each one):
//  1. Evidence is only what the run file stored. A run imported in the default HASH_ONLY mode keeps only the size
//     and fingerprint of content, so a claim about it is CANNOT_CHECK (reason CONTENT_WITHHELD), never a guess.
//  2. A claim is SUPPORTED when, for at least one matching step, every listed text appears in that step's recorded
//     field. Matching is plain substring matching on the stored text, case sensitive unless the claim says
//     otherwise. Only leaf values are searched (text, numbers, true/false); the names of fields are not.
//  3. All content recorded for one step and one field is joined (in event order) before searching, so the listed
//     texts may be spread over several recorded items of the same step.
//  4. NOT_SUPPORTED is only said when every candidate could be read: no step matched (NO_MATCHING_STEP), every
//     matching step's content was readable and lacked a text (NOT_FOUND), or the only content of the matching
//     steps was recorded after the event where the claim was made (TOO_LATE, see atEvent).
//  5. If any matching step cannot be read (content withheld, or never recorded) and none supports the claim, the
//     result is CANNOT_CHECK: an unread step might have supported it.
//  6. "Supported" means the text is present in the recording. It does not prove the claim is true.
import { ImportError } from "./run-import-error.js";
import type { Field, RunEvent, TaggedValue } from "./run-events.js";
import { DEFAULT_JSON_LIMITS, isJsonNumber, parseStrictJson, type JsonValue } from "./strict-json.js";

export type ClaimField = "result" | "arguments" | "input" | "output";
export const CLAIM_FIELD_NAME: Record<ClaimField, string> = {
  result: "gen_ai.tool.call.result",
  arguments: "gen_ai.tool.call.arguments",
  input: "gen_ai.input.messages",
  output: "gen_ai.output.messages",
};

export const CLAIM_LIMITS = {
  maxBytes: 1024 * 1024,
  maxClaims: 100,
  maxTextLength: 500,
  maxStrings: 5,
  maxStringLength: 500,
  maxToolNameLength: 200,
  // Total characters searched across one check; above this the remaining claims say "too much work".
  maxScannedCharacters: 1_000_000_000,
} as const;

export type Claim = {
  id: string;
  text: string;
  tool: string | null;
  stepId: string | null;
  field: ClaimField;
  mustContain: string[];
  caseSensitive: boolean;
  atEvent: number | null;
};

export type ClaimVerdict = "SUPPORTED" | "NOT_SUPPORTED" | "CANNOT_CHECK";
export type ClaimReason = "FOUND" | "NO_MATCHING_STEP" | "NOT_FOUND" | "TOO_LATE" | "CONTENT_WITHHELD" | "NO_CONTENT" | "TOO_MUCH_WORK";

export type ClaimResult = {
  claim: Claim;
  verdict: ClaimVerdict;
  reason: ClaimReason;
  // The step that supports the claim, or the closest candidate (fewest missing texts); null when none matched.
  stepId: string | null;
  stepsChecked: number;
  // Event where the supporting content was recorded (SUPPORTED), or where late content was recorded (TOO_LATE).
  evidenceEvent: number | null;
  stepFailed: boolean;
  // Texts not found in the closest candidate (NOT_FOUND only).
  missing: string[];
};

export type ClaimCheckResult = {
  results: ClaimResult[];
  counts: { supported: number; notSupported: number; cannotCheck: number };
  contentMode: "HASH_ONLY" | "FULL";
  // Names of the tools that ran in this run (cleaned for display, at most 10), to help with a misspelled name.
  knownTools: string[];
  knownToolsTotal: number;
};

// ---- the claims file ----
const ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const STEP_ID_PATTERN = /^[0-9a-f]{16}$/;
const CLAIM_KEYS = new Set(["id", "text", "tool", "stepId", "field", "mustContain", "caseSensitive", "atEvent"]);
const MAX_ERRORS = 20;

/** Cleans a name for a one-line message: control and bidirectional characters become spaces, at most 80 characters. */
export function tidyName(text: string): string {
  const flat = text.replace(/[\u0000-\u001f\u007f-\u009f؜‎‏‪-‮⁦-⁩]/g, " ").replace(/\s+/g, " ").trim();
  return flat.length > 80 ? `${flat.slice(0, 80)}…` : flat;
}

export type ParsedClaims = { claims: Claim[]; errors: string[] };

/** Reads a claims file (UTF-8 JSON bytes). Never repeats text from the file except claim ids, which are restricted. */
export function parseClaimFile(bytes: Uint8Array): ParsedClaims {
  let root: JsonValue;
  try {
    root = parseStrictJson(bytes, "claims", {
      ...DEFAULT_JSON_LIMITS, maxBytes: CLAIM_LIMITS.maxBytes, maxDepth: 8, maxNodes: 20_000, maxElements: 1_000, maxStringBytes: 8 * 1024,
    });
  } catch (error) {
    if (error instanceof ImportError) {
      if (error.code === "E_LIMIT") return { claims: [], errors: ["The claims file is too large or too deeply nested."] };
      if (error.code === "E_UNICODE") return { claims: [], errors: ["The claims file is not valid UTF-8 text."] };
    }
    return { claims: [], errors: ["The claims file is not valid JSON (check commas and quotes, and that no field name is repeated)."] };
  }
  const errors: string[] = [];
  const add = (message: string): void => { errors.push(message); };
  if (!(root instanceof Map)) return { claims: [], errors: ['The claims file must be a JSON object like {"claims": [ ... ]}.'] };
  for (const key of root.keys()) if (key !== "claims") add(`The claims file has an unknown top-level field (only "claims" is allowed).`);
  const list = root.get("claims");
  if (!Array.isArray(list)) return { claims: [], errors: [...errors, 'The claims file needs a "claims" list.'] };
  if (list.length === 0) return { claims: [], errors: [...errors, "The claims file lists no claims."] };
  if (list.length > CLAIM_LIMITS.maxClaims) return { claims: [], errors: [...errors, `The claims file lists ${list.length} claims; the limit is ${CLAIM_LIMITS.maxClaims}.`] };

  const claims: Claim[] = [];
  const seenIds = new Set<string>();
  list.forEach((entry, index) => {
    const where = `Claim ${index + 1}`;
    const before = errors.length;
    if (!(entry instanceof Map)) { add(`${where}: must be an object.`); return; }
    const id = entry.get("id");
    if (typeof id !== "string" || !ID_PATTERN.test(id)) add(`${where}: "id" must be 1 to 64 letters, digits, dots, dashes or underscores.`);
    else if (seenIds.has(id)) add(`${where}: the id "${id}" is used twice.`);
    else seenIds.add(id);
    const label = typeof id === "string" && ID_PATTERN.test(id) ? `${where} (${id})` : where;
    for (const key of entry.keys()) if (!CLAIM_KEYS.has(key)) add(`${label}: unknown field ${JSON.stringify(tidyName(key))} (allowed: ${[...CLAIM_KEYS].join(", ")}).`);

    const text = entry.get("text");
    if (typeof text !== "string" || text.trim() === "" || text.length > CLAIM_LIMITS.maxTextLength) add(`${label}: "text" must say what was claimed, in 1 to ${CLAIM_LIMITS.maxTextLength} characters.`);

    const tool = entry.get("tool");
    const stepId = entry.get("stepId");
    if ((tool === undefined) === (stepId === undefined)) add(`${label}: give exactly one of "tool" (a tool name) or "stepId" (a step id).`);
    if (tool !== undefined && (typeof tool !== "string" || tool === "" || tool.length > CLAIM_LIMITS.maxToolNameLength)) add(`${label}: "tool" must be a tool name.`);
    if (stepId !== undefined && (typeof stepId !== "string" || !STEP_ID_PATTERN.test(stepId))) add(`${label}: "stepId" must be 16 lowercase hexadecimal characters.`);

    const fieldValue = entry.get("field");
    let field: ClaimField = "result";
    if (fieldValue === undefined) {
      if (stepId !== undefined) add(`${label}: "field" is required with "stepId" (result, arguments, input or output).`);
    } else if (typeof fieldValue === "string" && Object.hasOwn(CLAIM_FIELD_NAME, fieldValue)) field = fieldValue as ClaimField;
    else add(`${label}: "field" must be one of result, arguments, input, output.`);

    const must = entry.get("mustContain");
    const strings: string[] = [];
    if (!Array.isArray(must) || must.length === 0 || must.length > CLAIM_LIMITS.maxStrings) add(`${label}: "mustContain" must list 1 to ${CLAIM_LIMITS.maxStrings} texts.`);
    else for (const piece of must) {
      if (typeof piece !== "string" || piece === "" || piece.length > CLAIM_LIMITS.maxStringLength) { add(`${label}: each "mustContain" text must be 1 to ${CLAIM_LIMITS.maxStringLength} characters.`); break; }
      strings.push(piece);
    }

    const caseSensitive = entry.get("caseSensitive");
    if (caseSensitive !== undefined && typeof caseSensitive !== "boolean") add(`${label}: "caseSensitive" must be true or false.`);

    const at = entry.get("atEvent");
    let atEvent: number | null = null;
    if (at !== undefined) {
      if (isJsonNumber(at) && /^[1-9][0-9]{0,8}$/.test(at.lexeme)) atEvent = Number(at.lexeme);
      else add(`${label}: "atEvent" must be a whole number of 1 or more.`);
    }

    if (errors.length === before) {
      claims.push({
        id: id as string, text: text as string, tool: typeof tool === "string" ? tool : null, stepId: typeof stepId === "string" ? stepId : null,
        field, mustContain: strings, caseSensitive: caseSensitive !== false, atEvent,
      });
    }
  });
  if (errors.length > MAX_ERRORS) {
    const extra = errors.length - MAX_ERRORS;
    errors.length = MAX_ERRORS;
    errors.push(`…and ${extra} more problem${extra === 1 ? "" : "s"}.`);
  }
  return errors.length > 0 ? { claims: [], errors } : { claims, errors: [] };
}

/** Same as parseClaimFile, for text typed or pasted into the screen. */
export function parseClaimText(text: string): ParsedClaims {
  return parseClaimFile(new TextEncoder().encode(text));
}

// ---- reading the evidence out of a run ----
type Item = { sequence: number; value: Field };
type StepInfo = { stepId: string; startSequence: number; tool: string | null; failed: boolean; content: Map<string, Item[]> };

function verbatimAttribute(attributes: Array<{ key: Field; value: Field }>, key: string): string | null {
  for (const a of attributes) {
    if ("v" in a.key && a.key.v.t === "s" && a.key.v.v === key && "v" in a.value && a.value.v.t === "s") return a.value.v.v;
  }
  return null;
}

/** The searchable text of a stored value: its text, number and true/false leaves in order, one per line. */
export function searchableText(value: TaggedValue): string {
  const leaves: string[] = [];
  const stack: TaggedValue[] = [value];
  while (stack.length > 0) {
    const current = stack.pop() as TaggedValue;
    switch (current.t) {
      case "s": leaves.push(current.v); break;
      case "i": case "d": case "o": leaves.push(String(current.v)); break;
      case "b": break;
      case "a": for (let i = current.v.length - 1; i >= 0; i -= 1) stack.push(current.v[i]); break;
      case "k": for (let i = current.v.length - 1; i >= 0; i -= 1) stack.push(current.v[i][1]); break;
    }
  }
  return leaves.join("\n");
}

function indexSteps(events: readonly RunEvent[]): Map<string, StepInfo> {
  const steps = new Map<string, StepInfo>();
  const logStep = new Map<number, string | null>();
  for (const event of events) {
    switch (event.type) {
      case "StepStarted":
        steps.set(event.payload.stepId, {
          stepId: event.payload.stepId, startSequence: event.sequenceNumber, tool: verbatimAttribute(event.payload.attributes, "gen_ai.tool.name"),
          failed: false, content: new Map(),
        });
        break;
      case "StepEnded": {
        const step = steps.get(event.payload.stepId);
        if (step) step.failed = event.payload.statusCode === 2;
        break;
      }
      case "LogRecorded": logStep.set(event.payload.logOrdinal, event.payload.stepId); break;
      case "ContentRecorded": {
        const owner = event.payload.stepId ?? (event.payload.logOrdinal === null ? null : logStep.get(event.payload.logOrdinal) ?? null);
        const step = owner === null ? undefined : steps.get(owner);
        if (!step) break;
        const list = step.content.get(event.payload.field) ?? [];
        list.push({ sequence: event.sequenceNumber, value: event.payload.value });
        step.content.set(event.payload.field, list);
        break;
      }
      default: break;
    }
  }
  return steps;
}

type StepOutcome =
  | { kind: "SUPPORTED"; evidenceEvent: number }
  | { kind: "MISSING"; missing: string[] }
  | { kind: "LATE"; lateEvent: number }
  | { kind: "WITHHELD" }
  | { kind: "NO_CONTENT" }
  | { kind: "TOO_MUCH_WORK" };

export function checkClaims(events: readonly RunEvent[], claims: readonly Claim[]): ClaimCheckResult {
  const header = events[0];
  const contentMode = header !== undefined && header.type === "RunStarted" ? header.payload.contentMode : "HASH_ONLY";
  const steps = indexSteps(events);
  const ordered = [...steps.values()].sort((a, b) => a.startSequence - b.startSequence);
  let scanBudget = CLAIM_LIMITS.maxScannedCharacters;
  const textCache = new Map<string, { text: string; lower: string | null }>();

  const joined = (step: StepInfo, fieldName: string, items: Item[], upTo: number): { text: string; lower: string | null } => {
    const key = `${step.stepId}|${fieldName}|${upTo}`;
    let cached = textCache.get(key);
    if (cached === undefined) {
      cached = { text: items.map((item) => ("v" in item.value ? searchableText(item.value.v) : "")).join("\n"), lower: null };
      textCache.set(key, cached);
    }
    return cached;
  };

  const outcomeFor = (claim: Claim, step: StepInfo): StepOutcome => {
    const fieldName = CLAIM_FIELD_NAME[claim.field];
    const all = step.content.get(fieldName) ?? [];
    if (all.length === 0) return { kind: "NO_CONTENT" };
    const limit = claim.atEvent ?? Number.MAX_SAFE_INTEGER;
    const early = all.filter((item) => item.sequence <= limit);
    if (early.length === 0) return { kind: "LATE", lateEvent: all[0].sequence };
    if (early.some((item) => "w" in item.value)) return { kind: "WITHHELD" };
    const cached = joined(step, fieldName, early, limit);
    if (!claim.caseSensitive && cached.lower === null) cached.lower = cached.text.toLowerCase();
    const haystack = claim.caseSensitive ? cached.text : (cached.lower as string);
    const missing: string[] = [];
    for (const piece of claim.mustContain) {
      scanBudget -= haystack.length;
      if (scanBudget < 0) return { kind: "TOO_MUCH_WORK" };
      const needle = claim.caseSensitive ? piece : piece.toLowerCase();
      if (!haystack.includes(needle)) missing.push(piece);
    }
    return missing.length === 0 ? { kind: "SUPPORTED", evidenceEvent: early[0].sequence } : { kind: "MISSING", missing };
  };

  const results: ClaimResult[] = claims.map((claim) => {
    const base = { claim, stepsChecked: 0, evidenceEvent: null, stepFailed: false, missing: [] as string[], stepId: null as string | null };
    const matching = ordered.filter((s) => (claim.stepId !== null ? s.stepId === claim.stepId : s.tool === claim.tool));
    if (matching.length === 0) return { ...base, verdict: "NOT_SUPPORTED", reason: "NO_MATCHING_STEP" };
    const outcomes = matching.map((step) => ({ step, outcome: outcomeFor(claim, step) }));
    const common = { ...base, stepsChecked: matching.length };

    const supported = outcomes.find((o) => o.outcome.kind === "SUPPORTED");
    if (supported !== undefined) {
      const outcome = supported.outcome as Extract<StepOutcome, { kind: "SUPPORTED" }>;
      return { ...common, verdict: "SUPPORTED", reason: "FOUND", stepId: supported.step.stepId, evidenceEvent: outcome.evidenceEvent, stepFailed: supported.step.failed };
    }
    const closest = (): { stepId: string; missing: string[] } | null => {
      let best: { stepId: string; missing: string[] } | null = null;
      for (const o of outcomes) {
        if (o.outcome.kind === "MISSING" && (best === null || o.outcome.missing.length < best.missing.length)) best = { stepId: o.step.stepId, missing: o.outcome.missing };
      }
      return best;
    };
    const firstOf = (kind: StepOutcome["kind"]) => outcomes.find((o) => o.outcome.kind === kind);

    // An unread step might have supported the claim, so the answer is "cannot check", not "not supported" (rule 5).
    const work = firstOf("TOO_MUCH_WORK");
    if (work !== undefined) return { ...common, verdict: "CANNOT_CHECK", reason: "TOO_MUCH_WORK", stepId: work.step.stepId };
    const withheld = firstOf("WITHHELD");
    if (withheld !== undefined) return { ...common, verdict: "CANNOT_CHECK", reason: "CONTENT_WITHHELD", stepId: withheld.step.stepId };
    const none = firstOf("NO_CONTENT");
    if (none !== undefined) return { ...common, verdict: "CANNOT_CHECK", reason: "NO_CONTENT", stepId: none.step.stepId };
    const late = firstOf("LATE");
    const best = closest();
    if (best !== null) return { ...common, verdict: "NOT_SUPPORTED", reason: "NOT_FOUND", stepId: best.stepId, missing: best.missing };
    const lateOutcome = late?.outcome as Extract<StepOutcome, { kind: "LATE" }>;
    return { ...common, verdict: "NOT_SUPPORTED", reason: "TOO_LATE", stepId: (late as NonNullable<typeof late>).step.stepId, evidenceEvent: lateOutcome.lateEvent };
  });

  const tools = [...new Set(ordered.map((s) => s.tool).filter((t): t is string => t !== null).map(tidyName))];
  return {
    results,
    counts: {
      supported: results.filter((r) => r.verdict === "SUPPORTED").length,
      notSupported: results.filter((r) => r.verdict === "NOT_SUPPORTED").length,
      cannotCheck: results.filter((r) => r.verdict === "CANNOT_CHECK").length,
    },
    contentMode,
    knownTools: tools.slice(0, 10),
    knownToolsTotal: tools.length,
  };
}
