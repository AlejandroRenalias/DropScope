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
//  3. Each listed text must appear inside ONE recorded value (one text, number or true/false). Nothing is joined
//     and no separator is ever added, so a text can never match characters the recording does not contain. Different
//     listed texts may be found in different values, even of different recorded items of the same step and field.
//     The evidence event of a supported claim is the event at which the last listed text first became available.
//  4. NOT_SUPPORTED is only said when every candidate could be read: no step matched (NO_MATCHING_STEP), every
//     matching step's content was readable and lacked a text (NOT_FOUND), or the only content of the matching
//     steps was recorded after the event where the claim was made (TOO_LATE, see atEvent).
//  5. If any matching step cannot be read (content withheld, or never recorded) and none supports the claim, the
//     result is CANNOT_CHECK: an unread step might have supported it.
//     The same holds for a tool name: a step whose tool name was kept only as a fingerprint (a name outside the
//     allowed pattern, in the default mode) might have been the one the claim names, so a claim about a tool that
//     would otherwise be NOT_SUPPORTED is CANNOT_CHECK (reason TOOL_NAME_WITHHELD).
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
  // Work allowed across one check, in "work units"; above this the remaining claims say "too much work". One unit is
  // one character looked at. Every recorded item and every value also costs a fixed number of units, so a run
  // full of empty values cannot make the check do unlimited work for free.
  maxScannedCharacters: 1_000_000_000,
  fixedCostPerValue: 8,
  // Lower-casing can make text longer. It is charged at the worst case before it happens: a text that is not plain
  // ASCII may grow to this many times its length (a test checks every Unicode character stays within it).
  lowerCaseGrowthBound: 3,
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
export type ClaimReason = "FOUND" | "NO_MATCHING_STEP" | "NOT_FOUND" | "TOO_LATE" | "CONTENT_WITHHELD" | "NO_CONTENT" | "TOO_MUCH_WORK" | "TOOL_NAME_WITHHELD";

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

// Edit distance between two short strings (insert, delete, replace), used only to suggest an allowed field name.
function editDistance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const next = [i];
    for (let j = 1; j <= b.length; j += 1) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}

/** ", did you mean "mustContain"?" when the unknown name is within two edits of an allowed one; otherwise nothing. */
function closestAllowed(unknown: string): string {
  if (unknown.length > 40) return "";
  let best: { name: string; distance: number } | null = null;
  for (const name of CLAIM_KEYS) {
    const distance = editDistance(unknown.toLowerCase(), name.toLowerCase());
    if (distance <= 2 && (best === null || distance < best.distance)) best = { name, distance };
  }
  return best === null ? "" : ` (did you mean "${best.name}"?)`;
}

export type ParsedClaims ={ claims: Claim[]; errors: string[] };

/** Reads a claims file (UTF-8 JSON bytes). Never repeats text from the file except claim ids, which are restricted. */
export function parseClaimFile(rawBytes: Uint8Array): ParsedClaims {
  // Windows editors often save UTF-8 with a byte order mark. One leading mark is accepted and ignored, so the
  // command line and the screen (whose text decoder drops it) treat the same file the same way.
  const bytes = rawBytes.length >= 3 && rawBytes[0] === 0xef && rawBytes[1] === 0xbb && rawBytes[2] === 0xbf ? rawBytes.subarray(3) : rawBytes;
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
    // The unknown name is never copied into the message (it is file content). A close allowed name is suggested instead.
    for (const key of entry.keys()) if (!CLAIM_KEYS.has(key)) add(`${label}: a field name is not allowed${closestAllowed(key)} (allowed: ${[...CLAIM_KEYS].join(", ")}).`);

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

/**
 * Turns the bytes of a claims file into text for the screen's box. Invalid UTF-8 throws. Any byte order mark is KEPT
 * in the text (ignoreBOM), so the rule "one leading mark is accepted, a second is not" is applied exactly once, by
 * parseClaimFile, to the same bytes the command line reads. Decoding with the default would silently drop one mark
 * here and make the screen accept a file the command line refuses.
 */
export function decodeClaimBytes(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
}

/** Same as parseClaimFile, for text typed or pasted into the screen. */
export function parseClaimText(text: string): ParsedClaims {
  return parseClaimFile(new TextEncoder().encode(text));
}

// ---- reading the evidence out of a run ----
type Item = { sequence: number; value: Field };
type StepInfo = { stepId: string; startSequence: number; tool: string | null; toolWithheld: boolean; failed: boolean; content: Map<string, Item[]> };

function verbatimAttribute(attributes: Array<{ key: Field; value: Field }>, key: string): string | null {
  for (const a of attributes) {
    if ("v" in a.key && a.key.v.t === "s" && a.key.v.v === key && "v" in a.value && a.value.v.t === "s") return a.value.v.v;
  }
  return null;
}

/** True when the step has a tool name that the run file kept only as a fingerprint (so it cannot be matched by name). */
function toolNameWithheld(attributes: Array<{ key: Field; value: Field }>): boolean {
  return attributes.some((a) => "v" in a.key && a.key.v.t === "s" && a.key.v.v === "gen_ai.tool.name" && "w" in a.value);
}

/** The searchable values of a stored value: its text, number and true/false leaves, in order, each searched on its own. */
export function searchableLeaves(value: TaggedValue): string[] {
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
  return leaves;
}

function indexSteps(events: readonly RunEvent[]): Map<string, StepInfo> {
  const steps = new Map<string, StepInfo>();
  const logStep = new Map<number, string | null>();
  for (const event of events) {
    switch (event.type) {
      case "StepStarted":
        steps.set(event.payload.stepId, {
          stepId: event.payload.stepId, startSequence: event.sequenceNumber, tool: verbatimAttribute(event.payload.attributes, "gen_ai.tool.name"),
          toolWithheld: toolNameWithheld(event.payload.attributes), failed: false, content: new Map(),
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

const ASCII_ONLY = /^[\x00-\x7f]*$/;

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
  // The leaves of each recorded item, extracted once. They are the strings already held by the run (numbers
  // become short strings), so this adds no copies of large text. Nothing else is retained between claims.
  const leavesOf = new Map<Item, string[]>();
  const leavesFor = (item: Item): string[] => {
    let leaves = leavesOf.get(item);
    if (leaves === undefined) {
      leaves = "v" in item.value ? searchableLeaves(item.value.v) : [];
      leavesOf.set(item, leaves);
    }
    return leaves;
  };

  const outcomeFor = (claim: Claim, step: StepInfo): StepOutcome => {
    const fieldName = CLAIM_FIELD_NAME[claim.field];
    const all = step.content.get(fieldName) ?? [];
    if (all.length === 0) return { kind: "NO_CONTENT" };
    // Even looking at the list of items costs something (a run can record up to a million of them).
    scanBudget -= CLAIM_LIMITS.fixedCostPerValue * all.length;
    if (scanBudget < 0) return { kind: "TOO_MUCH_WORK" };
    const limit = claim.atEvent ?? Number.MAX_SAFE_INTEGER;
    const early = all.filter((item) => item.sequence <= limit);
    if (early.length === 0) return { kind: "LATE", lateEvent: all[0].sequence };
    if (early.some((item) => "w" in item.value)) return { kind: "WITHHELD" };

    if (scanBudget < 0) return { kind: "TOO_MUCH_WORK" }; // spent already: do not even extract values

    // Search value by value, in event order. Each text is resolved at the first value that contains it. The work is
    // charged BEFORE anything large is created or scanned, so the limit also bounds memory.
    const needles = claim.caseSensitive ? claim.mustContain : claim.mustContain.map((piece) => piece.toLowerCase());
    const foundAt: Array<number | null> = needles.map(() => null);
    let unresolved = needles.length;
    search: for (const item of early) {
      for (const leaf of leavesFor(item)) {
        // Charge first, create later. Every value costs its length plus a fixed amount (so empty values are not free)
        // for each text still being looked for. Case-insensitive search also pays for a worst-case lower-cased copy,
        // and for the check that tells plain ASCII (which cannot grow) from other text, before either is made.
        const fixed = CLAIM_LIMITS.fixedCostPerValue;
        let searched = leaf.length + fixed;
        if (!claim.caseSensitive) {
          scanBudget -= leaf.length + fixed; // looking at the value to decide how much it can grow
          if (scanBudget < 0) return { kind: "TOO_MUCH_WORK" };
          searched = (ASCII_ONLY.test(leaf) ? leaf.length : leaf.length * CLAIM_LIMITS.lowerCaseGrowthBound) + fixed;
          scanBudget -= searched; // making the lower-cased copy
        }
        scanBudget -= searched * unresolved;
        if (scanBudget < 0) return { kind: "TOO_MUCH_WORK" };
        const haystack = claim.caseSensitive ? leaf : leaf.toLowerCase();
        for (let i = 0; i < needles.length; i += 1) {
          if (foundAt[i] === null && haystack.includes(needles[i])) { foundAt[i] = item.sequence; unresolved -= 1; }
        }
        if (unresolved === 0) break search;
      }
    }
    if (unresolved > 0) return { kind: "MISSING", missing: claim.mustContain.filter((_, i) => foundAt[i] === null) };
    return { kind: "SUPPORTED", evidenceEvent: Math.max(...(foundAt as number[])) };
  };

  const unnamedTools = ordered.filter((step) => step.toolWithheld);
  const results: ClaimResult[] = claims.map((claim) => {
    const result = checkOne(claim);
    // A step whose tool name was withheld might be the one this claim names, so "not supported" cannot be said. Only a
    // step that recorded the claimed field by the claim's cutoff event could have supported it; a nameless step whose
    // content came later (or never) changes nothing.
    if (result.verdict === "NOT_SUPPORTED" && claim.stepId === null) {
      const limit = claim.atEvent ?? Number.MAX_SAFE_INTEGER;
      const possible = unnamedTools.find((step) => (step.content.get(CLAIM_FIELD_NAME[claim.field]) ?? []).some((item) => item.sequence <= limit));
      if (possible !== undefined) return { ...result, verdict: "CANNOT_CHECK" as const, reason: "TOOL_NAME_WITHHELD" as const, stepId: possible.stepId };
    }
    return result;
  });
  function checkOne(claim: Claim): ClaimResult {
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
  }

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
