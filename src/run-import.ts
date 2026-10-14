// The import pipeline from bytes to run events (spec section 2). Pure: no files are read or written here.
import { sha256Hex } from "./canonical.js";
import { DEFAULT_STRUCTURE_LIMITS, DEFAULT_WORK_UNITS, parseLogsRequest, parseTraceRequest } from "./otlp-structure.js";
import { emitRunEvents, type EmitInput } from "./run-emit.js";
import type { ContentMode, RunEvent } from "./run-events.js";
import { ImportError } from "./run-import-error.js";
import { DEFAULT_JSON_LIMITS, parseStrictJsonCounted } from "./strict-json.js";
import { normalizeRun } from "./trace-normalize.js";

export type ImportRequest = {
  spans: Uint8Array;
  logs?: Uint8Array;
  contentMode?: ContentMode;
  selectTrace?: string;
  // Test hook for the output limit; defaults to the 128 MiB limit of spec section 10.
  maxOutputBytes?: number;
};

// Spec section 10: 64 MiB per import in total, and 2,000,000 parsed nodes in total (not per file).
export const MAX_IMPORT_BYTES = 64 * 1024 * 1024;

export function importTraceBytes(request: ImportRequest): RunEvent[] {
  if (request.spans.length + (request.logs?.length ?? 0) > MAX_IMPORT_BYTES) throw new ImportError("E_LIMIT", "import", null, "INPUT_TOTAL_BYTES");
  const parsedSpans = parseStrictJsonCounted(request.spans, "parse-spans");
  const spansJson = parsedSpans.value;
  const logsJson = request.logs === undefined ? undefined : parseStrictJsonCounted(request.logs, "parse-logs", {
    ...DEFAULT_JSON_LIMITS, maxNodes: DEFAULT_JSON_LIMITS.maxNodes - parsedSpans.nodes,
  }).value;
  // One work budget for the whole import: the logs file gets what the spans file left.
  const budget = { remaining: DEFAULT_WORK_UNITS };
  const spans = parseTraceRequest(spansJson, "structure-spans", DEFAULT_STRUCTURE_LIMITS, budget);
  const logs = logsJson === undefined ? undefined : parseLogsRequest(logsJson, "structure-logs", DEFAULT_STRUCTURE_LIMITS, budget);

  const run = normalizeRun({
    spans: spans.spans, spanContexts: spans.contexts,
    logs: logs?.logs, logContexts: logs?.contexts, selectTrace: request.selectTrace,
  });
  const inputs: EmitInput[] = [{
    role: "spans", byteLength: request.spans.length, sha256: sha256Hex(request.spans), enumNamesAccepted: spans.stats.enumNamesAccepted,
  }];
  if (request.logs !== undefined && logs !== undefined) {
    inputs.push({ role: "logs", byteLength: request.logs.length, sha256: sha256Hex(request.logs), enumNamesAccepted: logs.stats.enumNamesAccepted });
  }
  return emitRunEvents(run, {
    contentMode: request.contentMode ?? "HASH_ONLY",
    maxOutputBytes: request.maxOutputBytes,
    inputs,
    envelopeUnknownCount: spans.stats.envelopeUnknownCount + (logs?.stats.envelopeUnknownCount ?? 0),
  });
}
