// THROWAWAY spike: OTLP/JSON -> run-event log -> pure reducer. Not production code.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const sha = (s) => createHash("sha256").update(s).digest("hex");

// ---- OTLP AnyValue -> plain JS (ints stay exact: string when beyond 2^53)
export function anyValue(v) {
  if (v === undefined || v === null) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("intValue" in v) { const n = BigInt(v.intValue); return n >= -(2n ** 53n) && n <= 2n ** 53n ? Number(n) : String(n); }
  if ("doubleValue" in v) return v.doubleValue;
  if ("boolValue" in v) return v.boolValue;
  if ("arrayValue" in v) return (v.arrayValue.values ?? []).map(anyValue);
  if ("kvlistValue" in v) return Object.fromEntries((v.kvlistValue.values ?? []).map((kv) => [kv.key, anyValue(kv.value)]));
  if ("bytesValue" in v) return { bytes: v.bytesValue };
  return { unknownAnyValue: v };
}
const attrs = (list) => Object.fromEntries((list ?? []).map((a) => [a.key, anyValue(a.value)]).sort(([a], [b]) => (a < b ? -1 : 1)));

// ---- flatten
export function readSpans(path) {
  const doc = JSON.parse(readFileSync(path, "utf8"));
  const out = [];
  for (const rs of doc.resourceSpans ?? []) {
    const resource = attrs(rs.resource?.attributes);
    for (const ss of rs.scopeSpans ?? []) {
      for (const s of ss.spans ?? []) {
        out.push({
          traceId: s.traceId, spanId: s.spanId, parentSpanId: s.parentSpanId ?? null, name: s.name, otlpKind: s.kind,
          startNs: BigInt(s.startTimeUnixNano), endNs: s.endTimeUnixNano && s.endTimeUnixNano !== "0" ? BigInt(s.endTimeUnixNano) : null,
          attributes: attrs(s.attributes), status: { code: s.status?.code ?? "STATUS_CODE_UNSET", message: s.status?.message ?? null },
          events: (s.events ?? []).map((e) => ({ name: e.name, timeNs: e.timeUnixNano, attributes: attrs(e.attributes) })),
          scope: { name: ss.scope?.name ?? null, version: ss.scope?.version ?? null }, resource,
        });
      }
    }
  }
  return out;
}

export function readLogs(path) {
  const doc = JSON.parse(readFileSync(path, "utf8"));
  const out = [];
  for (const rl of doc.resourceLogs ?? []) for (const sl of rl.scopeLogs ?? []) for (const r of sl.logRecords ?? [])
    out.push({ traceId: r.traceId ?? null, spanId: r.spanId ?? null, eventName: r.eventName ?? null, attributes: attrs(r.attributes), body: anyValue(r.body) });
  return out;
}

// ---- classify
export function classify(span) {
  const op = span.attributes["gen_ai.operation.name"];
  if (["chat", "text_completion", "generate_content", "embeddings"].includes(op)) return "LLM_CALL";
  if (op === "execute_tool") return "TOOL_CALL";
  if (op === "invoke_agent" || op === "create_agent") return "AGENT";
  if (op === "agent_handoff") return "HANDOFF";
  return "OTHER";
}

const CONSUMED = new Set(["gen_ai.provider.name", "gen_ai.response.model", "gen_ai.response.id", "server.address", "server.port", "gen_ai.tool.type", "gen_ai.agent.id", "gen_ai.agent.description", "gen_ai.system", "gen_ai.output.type", "error.type", "gen_ai.is_streaming", "gen_ai.openai.api_base", "gen_ai.usage.total_tokens", "gen_ai.handoff.from_agent", "gen_ai.handoff.to_agent", "gen_ai.operation.name", "gen_ai.usage.input_tokens", "gen_ai.usage.output_tokens", "gen_ai.tool.name", "gen_ai.agent.name", "gen_ai.request.model", "gen_ai.input.messages", "gen_ai.output.messages", "gen_ai.tool.call.arguments", "gen_ai.tool.call.result", "gen_ai.response.finish_reasons"]);

// ---- import: deterministic total order over start/end events
export function importTrace(spans, logs = []) {
  const notes = [];
  const byId = new Map();
  for (const s of spans) {
    if (byId.has(s.spanId)) notes.push({ code: "DUPLICATE_SPAN_ID", spanId: s.spanId });
    byId.set(s.spanId, s);
  }
  const depth = (s, seen = new Set()) => {
    if (!s.parentSpanId || !byId.has(s.parentSpanId) || seen.has(s.spanId)) return 0;
    seen.add(s.spanId); return 1 + depth(byId.get(s.parentSpanId), seen);
  };
  const maxT = spans.reduce((m, s) => { const e = s.endNs ?? s.startNs; return e > m ? e : m; }, 0n);
  const effEnd = (s) => (s.endNs === null ? maxT : s.endNs < s.startNs ? s.startNs : s.endNs);
  const items = [];
  for (const s of spans) {
    if (s.parentSpanId && !byId.has(s.parentSpanId)) notes.push({ code: "MISSING_PARENT", spanId: s.spanId, parentSpanId: s.parentSpanId });
    const p = s.parentSpanId ? byId.get(s.parentSpanId) : null;
    if (p && (s.startNs < p.startNs || effEnd(s) > effEnd(p))) notes.push({ code: "CHILD_OUTSIDE_PARENT_INTERVAL", spanId: s.spanId });
    if (s.endNs === null) notes.push({ code: "UNFINISHED_SPAN_CLOSED_AT_TRACE_END", spanId: s.spanId });
    else if (s.endNs < s.startNs) notes.push({ code: "NEGATIVE_DURATION_CLAMPED", spanId: s.spanId });
    const kind = classify(s);
    if (kind === "OTHER" && !s.parentSpanId === false) notes.push({ code: "UNCLASSIFIED_SPAN", spanId: s.spanId, name: s.name });
    const d = depth(s);
    items.push({ t: s.startNs, phase: 1, d, s, type: "StepStarted" });
    items.push({ t: effEnd(s), phase: effEnd(s) === s.startNs ? 2 : 0, d: -d, s, type: "StepEnded" });
  }
  items.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : a.phase - b.phase || a.d - b.d || (a.s.spanId < b.s.spanId ? -1 : a.s.spanId > b.s.spanId ? 1 : 0)));

  const traceId = spans[0].traceId;
  const events = [];
  const push = (type, payload) => events.push({ schemaVersion: 1, sequenceNumber: events.length + 1, runId: traceId, type, payload });
  push("RunStarted", { traceId, derivedOrder: true, importer: "spike-0", convention: "otel-genai (unpinned)" });
  let contentAbsent = 0;
  const CONTENT_KEYS = ["gen_ai.input.messages", "gen_ai.output.messages", "gen_ai.tool.call.arguments", "gen_ai.tool.call.result"];
  const logsBySpan = new Map();
  for (const l of logs) {
    if (!l.spanId || !byId.has(l.spanId)) { notes.push({ code: "ORPHAN_LOG_RECORD", spanId: l.spanId, eventName: l.eventName }); continue; }
    if (!logsBySpan.has(l.spanId)) logsBySpan.set(l.spanId, []);
    logsBySpan.get(l.spanId).push(l);
  }
  for (const it of items) {
    const s = it.s, kind = classify(s);
    if (it.type === "StepStarted") {
      push("StepStarted", { stepId: s.spanId, parentStepId: s.parentSpanId, kind, name: s.name, startNs: String(s.startNs), otlpKind: s.otlpKind, attributes: s.attributes, scope: s.scope, resource: s.resource });
      const unknownKeys = Object.keys(s.attributes).filter((k) => !CONSUMED.has(k));
      if (unknownKeys.length) push("ImportNote", { code: "UNMAPPED_ATTRIBUTES_RETAINED_RAW", stepId: s.spanId, keys: unknownKeys });
    } else {
      push("StepEnded", { stepId: s.spanId, endNs: s.endNs === null ? null : String(s.endNs), endEffectiveNs: String(effEnd(s)), status: s.status, events: s.events });
      const inT = s.attributes["gen_ai.usage.input_tokens"], outT = s.attributes["gen_ai.usage.output_tokens"];
      if (inT !== undefined || outT !== undefined) push("UsageRecorded", { stepId: s.spanId, inputTokens: inT ?? 0, outputTokens: outT ?? 0, costSource: "NONE" });
      const content = CONTENT_KEYS.filter((k) => s.attributes[k] !== undefined);
      for (const k of content) push("EvidenceCaptured", { stepId: s.spanId, field: k, via: "SPAN_ATTRIBUTE", sha256: sha(String(s.attributes[k])) });
      let viaLog = 0;
      for (const l of (logsBySpan.get(s.spanId) ?? []).sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1))) {
        for (const k of CONTENT_KEYS.filter((k) => l.attributes[k] !== undefined)) { push("EvidenceCaptured", { stepId: s.spanId, field: k, via: "LOG_EVENT", logEvent: l.eventName, sha256: sha(JSON.stringify(l.attributes[k])), value: l.attributes[k] }); viaLog++; }
      }
      if (!content.length && !viaLog && (kind === "LLM_CALL" || kind === "TOOL_CALL")) contentAbsent++;
    }
  }
  if (contentAbsent) push("ImportNote", { code: "CONTENT_ABSENT", steps: contentAbsent, detail: "no prompt/response/tool content captured on these LLM/tool steps" });
  for (const n of notes) push("ImportNote", n);
  push("RunEnded", { stepCount: spans.length });
  return events;
}

// ---- pure reducer
export const initial = () => ({ applied: 0, open: {}, closed: 0, byKind: {}, inputTokens: 0, outputTokens: 0, errors: 0, evidence: 0, notes: 0, kindOf: {}, agentOf: {} });
export function reduce(st, ev) {
  const s = structuredClone(st); s.applied = ev.sequenceNumber;
  const p = ev.payload;
  switch (ev.type) {
    case "StepStarted": s.open[p.stepId] = p.name; s.kindOf[p.stepId] = p.kind; s.byKind[p.kind] = (s.byKind[p.kind] ?? 0) + 1; break;
    case "StepEnded": delete s.open[p.stepId]; s.closed++; if (p.status.code === "STATUS_CODE_ERROR") s.errors++; break;
    case "UsageRecorded": s.inputTokens += p.inputTokens; s.outputTokens += p.outputTokens; break;
    case "EvidenceCaptured": s.evidence++; break;
    case "ImportNote": s.notes++; break;
  }
  return s;
}
export const replay = (events, n = events.length) => events.slice(0, n).reduce(reduce, initial());
export const canonical = (events) => events.map((e) => JSON.stringify(e)).join("\n") + "\n";
export { sha };
