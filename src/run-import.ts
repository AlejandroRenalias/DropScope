// The import pipeline from bytes to run events (spec section 2). Pure: no files are read or written here.
import { sha256Hex } from "./canonical.js";
import { parseLogsRequest, parseTraceRequest } from "./otlp-structure.js";
import { emitRunEvents, type EmitInput } from "./run-emit.js";
import type { ContentMode, RunEvent } from "./run-events.js";
import { parseStrictJson } from "./strict-json.js";
import { normalizeRun } from "./trace-normalize.js";

export type ImportRequest = {
  spans: Uint8Array;
  logs?: Uint8Array;
  contentMode?: ContentMode;
  selectTrace?: string;
};

export function importTraceBytes(request: ImportRequest): RunEvent[] {
  const spansJson = parseStrictJson(request.spans, "parse-spans");
  const logsJson = request.logs === undefined ? undefined : parseStrictJson(request.logs, "parse-logs");
  const spans = parseTraceRequest(spansJson, "structure-spans");
  const logs = logsJson === undefined ? undefined : parseLogsRequest(logsJson, "structure-logs");

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
    inputs,
    envelopeUnknownCount: spans.stats.envelopeUnknownCount + (logs?.stats.envelopeUnknownCount ?? 0),
  });
}
