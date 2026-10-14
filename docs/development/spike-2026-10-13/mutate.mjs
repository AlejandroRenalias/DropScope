import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const TMP = join(mkdtempSync(join(tmpdir(), "dropscope-mutate-")), "m.json");
import { readSpans, importTrace, canonical, sha, replay } from "./importer.mjs";
const base = JSON.parse(readFileSync("traces/trace-c.json", "utf8"));
const spansOf = (d) => d.resourceSpans.flatMap((r) => r.scopeSpans.flatMap((s) => s.spans));
const run = (name, mut) => {
  const d = structuredClone(base); const sp = spansOf(d); mut(sp, d);
  writeFileSync(TMP, JSON.stringify(d));
  try {
    const a = importTrace(readSpans(TMP)), b = importTrace(readSpans(TMP));
    const notes = {}; for (const e of a.filter((e) => e.type === "ImportNote")) notes[e.payload.code] = (notes[e.payload.code] ?? 0) + 1;
    const st = replay(a);
    console.log(`${name}: imported ${a.length} events, deterministic=${sha(canonical(a)) === sha(canonical(b))}, open-at-end=${Object.keys(st.open).length}, closed=${st.closed}, notes=${JSON.stringify({ ...notes, UNMAPPED_ATTRIBUTES_RETAINED_RAW: undefined })}`);
  } catch (e) { console.log(`${name}: REJECTED with error: ${e.message.slice(0, 90)}`); }
};
run("baseline", () => {});
run("missing parent", (sp) => { sp[3].parentSpanId = "deadbeefdeadbeef"; });
run("duplicate span id", (sp) => { sp[5].spanId = sp[4].spanId; });
run("clock skew (child ends after parent)", (sp) => { const s = sp.find((x) => x.parentSpanId); s.endTimeUnixNano = String(BigInt(s.endTimeUnixNano) + 5_000_000_000n); });
run("negative duration", (sp) => { sp[2].endTimeUnixNano = String(BigInt(sp[2].startTimeUnixNano) - 1000n); });
run("all timestamps identical", (sp) => { for (const s of sp) { s.startTimeUnixNano = "1000"; s.endTimeUnixNano = "1000"; } });
run("span with no end time", (sp) => { delete sp[1].endTimeUnixNano; });
run("end time zero (OTLP unset)", (sp) => { sp[1].endTimeUnixNano = "0"; });
run("unknown attribute value type", (sp) => { sp[1].attributes.push({ key: "x.weird", value: { somethingNew: 1 } }); });
const txt = readFileSync("traces/trace-c.json", "utf8"); writeFileSync(TMP, txt.slice(0, Math.floor(txt.length * 0.7)));
try { readSpans(TMP); console.log("truncated file: accepted (BAD)"); } catch (e) { console.log("truncated file: REJECTED with error:", e.message.slice(0, 70)); }
