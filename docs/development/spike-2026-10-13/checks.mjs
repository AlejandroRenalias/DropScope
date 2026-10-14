import { readLogs, readSpans, importTrace, replay, canonical, sha, initial, reduce } from "./importer.mjs";
import { writeFileSync, readFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
const OUT = mkdtempSync(join(tmpdir(), "dropscope-spike-"));

const files = process.argv.slice(2);
let allPass = true;
const check = (name, ok, detail = "") => { console.log(`  [${ok ? "PASS" : "FAIL"}] ${name}${detail ? " : " + detail : ""}`); if (!ok) allPass = false; };
const shuffle = (a, seed = 7) => { const r = [...a]; let x = seed; for (let i = r.length - 1; i > 0; i--) { x = (x * 1103515245 + 12345) & 0x7fffffff; const j = x % (i + 1); [r[i], r[j]] = [r[j], r[i]]; } return r; };
const stable = (o) => JSON.stringify(o, (k, v) => (typeof v === "bigint" ? String(v) : v));

for (const file of files) {
  console.log(`\n=== ${file}`);
  const spans = readSpans(file);
  const logPath = file.replace(".json", ".logs.json"); const logs = existsSync(logPath) ? readLogs(logPath) : [];
  const events = importTrace(spans, logs);
  writeFileSync(join(OUT, basename(file).replace(".json", ".runlog.jsonl")), canonical(events));
  const types = {}; for (const e of events) types[e.type] = (types[e.type] ?? 0) + 1;
  console.log("  events:", events.length, JSON.stringify(types));

  // 1 determinism: same input twice, and input in a different span order
  const h1 = sha(canonical(events)), h2 = sha(canonical(importTrace(readSpans(file), logs))), h3 = sha(canonical(importTrace(shuffle(readSpans(file)), shuffle(logs, 11))));
  check("import twice is byte-identical", h1 === h2);
  check("import is independent of span order in the file", h1 === h3);

  // 2 lossless round trip
  const rebuilt = new Map();
  for (const e of events) {
    if (e.type === "StepStarted") rebuilt.set(e.payload.stepId, { ...e.payload });
    if (e.type === "StepEnded") Object.assign(rebuilt.get(e.payload.stepId), { endNs: e.payload.endNs, status: e.payload.status, events: e.payload.events });
  }
  let mismatches = 0;
  for (const s of spans) {
    const r = rebuilt.get(s.spanId);
    const ok = r && r.parentStepId === s.parentSpanId && r.name === s.name && r.startNs === String(s.startNs) && r.endNs === (s.endNs === null ? null : String(s.endNs)) && r.otlpKind === s.otlpKind
      && stable(r.attributes) === stable(s.attributes) && stable(r.status) === stable(s.status) && stable(r.events) === stable(s.events);
    if (!ok) mismatches++;
  }
  check("every span/attribute/event/status round-trips from the run log", mismatches === 0 && rebuilt.size === spans.length, `${spans.length} spans, ${mismatches} mismatches`);

  // 3 fidelity: independent totals from the raw file vs reducer final state
  const raw = { spans: spans.length, inTok: 0, outTok: 0, errors: 0 };
  for (const s of spans) { raw.inTok += s.attributes["gen_ai.usage.input_tokens"] ?? 0; raw.outTok += s.attributes["gen_ai.usage.output_tokens"] ?? 0; if (s.status.code === "STATUS_CODE_ERROR") raw.errors++; }
  const fin = replay(events);
  check("final state matches the trace's own totals", fin.closed === raw.spans && fin.inputTokens === raw.inTok && fin.outputTokens === raw.outTok && fin.errors === raw.errors && Object.keys(fin.open).length === 0,
    `spans ${fin.closed}/${raw.spans}, in ${fin.inputTokens}/${raw.inTok}, out ${fin.outputTokens}/${raw.outTok}, errors ${fin.errors}/${raw.errors}`);

  // 3b independent ground truth: the stub server's own tally of what it actually returned
  try {
    const truth = JSON.parse(readFileSync(file + ".truth", "utf8"));
    check("final tokens match the SERVER's own tally (independent of trace attributes)", fin.inputTokens === truth.promptTokens && fin.outputTokens === truth.completionTokens,
      `in ${fin.inputTokens}/${truth.promptTokens}, out ${fin.outputTokens}/${truth.completionTokens}`);
  } catch { console.log("  (no server-side truth file)"); }

  // 4 state at step N: incremental fold equals replay-from-scratch for every prefix, and open steps never go negative
  let st = initial(), prefixOk = true;
  for (let n = 1; n <= events.length; n++) { st = reduce(st, events[n - 1]); if (stable(st) !== stable(replay(events, n))) prefixOk = false; }
  check("state at every step N is reproducible (fold == prefix replay)", prefixOk, `${events.length} prefixes`);

  // 5 ordering honesty
  const sorted = [...spans].sort((a, b) => (a.startNs < b.startNs ? -1 : 1));
  let overlaps = 0; const parentOf = new Map(spans.map((s) => [s.spanId, s.parentSpanId]));
  const isAnc = (a, b) => { for (let p = parentOf.get(b); p; p = parentOf.get(p)) if (p === a) return true; return false; };
  for (let i = 0; i < sorted.length; i++) for (let j = i + 1; j < sorted.length && sorted[j].startNs < sorted[i].endNs; j++) if (!isAnc(sorted[i].spanId, sorted[j].spanId) && !isAnc(sorted[j].spanId, sorted[i].spanId)) overlaps++;
  const ties = new Set(); const seen = new Map(); for (const s of spans) for (const t of [s.startNs, s.endNs]) { if (seen.has(t)) ties.add(t); seen.set(t, 1); }
  console.log(`  ordering: ${overlaps} concurrent (non-ancestor) overlapping span pairs, ${ties.size} identical-timestamp ties resolved by rule`);
  const notes = events.filter((e) => e.type === "ImportNote").map((e) => e.payload.code); const nc = {}; for (const c of notes) nc[c] = (nc[c] ?? 0) + 1;
  console.log("  import notes:", JSON.stringify(nc));

  // 6 content probe -> is claim checking feasible?
  const ev = events.filter((e) => e.type === "EvidenceCaptured");
  const via = {}; for (const e of ev) via[e.payload.via] = (via[e.payload.via] ?? 0) + 1;
  const outputs = [];
  for (const s of spans) if (s.attributes["gen_ai.output.messages"] !== undefined) outputs.push({ t: s.endNs ?? 0n, text: String(s.attributes["gen_ai.output.messages"]) });
  for (const e of ev) if (e.payload.field === "gen_ai.output.messages" && e.payload.via === "LOG_EVENT") outputs.push({ t: (spans.find((s) => s.spanId === e.payload.stepId).endNs ?? 0n), text: JSON.stringify(e.payload.value) });
  const answer = outputs.filter((o) => o.text.includes("[S")).sort((a, b) => (a.t < b.t ? -1 : 1)).at(-1)?.text;
  const results = spans.map((s) => s.attributes["gen_ai.tool.call.result"]).filter(Boolean).join("\n");
  console.log(`  content evidence by channel: ${JSON.stringify(via)}`);
  if (!answer) console.log("  claim check: NOT POSSIBLE, no final answer content in this trace");
  else if (!results) console.log("  claim check: NOT CHECKABLE, answer text is available but no tool outputs were captured to check it against");
  else {
    const cites = [...answer.matchAll(/\[(S\d+)\]/g)].map((m) => m[1]);
    console.log("  claim check (citation present in captured tool output):", cites.map((c) => `${c}:${results.includes(`Source ${c} `) ? "supported" : "UNSUPPORTED"}`).join(", "));
  }

  // 7 budget replay probe
  const policy = { maxInputTokens: 1500 };
  let acc = initial(), breach = null;
  for (const e of events) { acc = reduce(acc, e); if (!breach && acc.inputTokens > policy.maxInputTokens) breach = { seq: e.sequenceNumber, stepId: e.payload.stepId, used: acc.inputTokens }; }
  if (breach) {
    const rest = replay(events).inputTokens - breach.used;
    const nm = spans.find((s) => s.spanId === breach.stepId).name;
    console.log(`  budget replay (maxInputTokens=${policy.maxInputTokens}): WOULD HAVE STOPPED at event ${breach.seq}/${events.length} (step "${nm}", used ${breach.used}); ${rest} further input tokens counterfactually avoided`);
  } else console.log(`  budget replay (maxInputTokens=${policy.maxInputTokens}): never breached`);
}
console.log(`\nOVERALL: ${allPass ? "ALL CHECKS PASSED" : "SOME CHECKS FAILED"}`);
process.exit(allPass ? 0 : 1);
