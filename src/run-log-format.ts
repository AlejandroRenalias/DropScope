// Reading a run log (spec section 11.5), without any file access: pure, so the same validated reader runs in
// Node (the command line and the store) and in the browser (the replay screen).
import { canonicalJson } from "./canonical-json.js";
import { ImportError } from "./run-import-error.js";
import type { RunEvent } from "./run-events.js";
import { MAX_RUN_LOG_BYTES } from "./run-limits.js";
import { validateRunHistory } from "./run-reducer.js";
import { parseStrictJson } from "./strict-json.js";

// A persisted line is read with caps that account for the tagged form, which nests about three levels deeper
// per level of input JSON, and for one line (the header) carrying every context.
const RUN_LOG_LINE_LIMITS = {
  maxBytes: MAX_RUN_LOG_BYTES,
  maxDepth: 256,
  maxNodes: 20_000_000,
  maxElements: 100_000,
  maxKeyBytes: 1024,
  maxStringBytes: 16 * 1024 * 1024,
  maxNumberLexeme: 256,
};

const invalid = (reason: string): never => {
  throw new ImportError("E_INVALID_LOG", "read-log", null, reason);
};

// Reads a run log: every line must parse strictly, match the schema, be in canonical form, and the whole
// history must satisfy the reducer's admission rules. Any deviation fails closed.
export function parseRunLog(bytes: Uint8Array): RunEvent[] {
  if (bytes.length === 0 || bytes.length > MAX_RUN_LOG_BYTES) return invalid("SIZE");
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return invalid("BOM");
  if (bytes[bytes.length - 1] !== 0x0a) return invalid("NO_FINAL_NEWLINE");
  if (bytes.includes(0x0d)) return invalid("CARRIAGE_RETURN");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return invalid("UTF8");
  }
  const lines = text.slice(0, -1).split("\n");
  const events: unknown[] = [];
  lines.forEach((line, index) => {
    if (line.length === 0) invalid(`BLANK_LINE ${index + 1}`);
    let value: unknown;
    try {
      parseStrictJson(new TextEncoder().encode(line), "read-log", RUN_LOG_LINE_LIMITS);
      value = JSON.parse(line);
    } catch {
      return invalid(`LINE_SYNTAX ${index + 1}`);
    }
    if (canonicalJson(value) !== line) invalid(`LINE_NOT_CANONICAL ${index + 1}`);
    events.push(value);
  });
  return validateRunHistory(events);
}
