import { useId, useMemo, useState } from "react";
import { group, formatSeconds } from "../budget-report.js";
import { diffRuns, type DiffChange, type DiffItem, type RunTotals } from "../run-diff.js";
import { changeText, diffCaveats, diffCountsLine, diffVerdictLine } from "../run-diff-report.js";
import { MAX_RUN_LOG_BYTES } from "../run-limits.js";
import demoRunFullText from "./assets/demo-run-full.runlog.jsonl?raw";
import demoRunVariantText from "./assets/demo-run-variant.runlog.jsonl?raw";
import { explainLoadError } from "./load-error.js";
import { ROW_LIMIT, foldEntries, limitEntries } from "./run-diff-layout.js";
import { loadRunFromBytes, type RunModel } from "./run-replay-model.js";

const TOOL_LINE_LIMIT = 25;
const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

type Other = { model: RunModel; label: string };
type Step = NonNullable<DiffItem["a"]>;

const STATUS_CHIP: Record<DiffItem["status"], string> = { same: "Same", changed: "Changed", onlyA: "Only in A", onlyB: "Only in B" };

const totalRows = (a: RunTotals, b: RunTotals): Array<{ label: string; a: string; b: string }> => [
  { label: "Steps", a: group(a.steps), b: group(b.steps) },
  { label: "Model calls", a: group(a.modelCalls), b: group(b.modelCalls) },
  { label: "Tool calls", a: group(a.toolCalls), b: group(b.toolCalls) },
  { label: "Failed steps", a: group(a.failedSteps), b: group(b.failedSteps) },
  { label: "Input tokens", a: group(a.inputTokens), b: group(b.inputTokens) },
  { label: "Output tokens", a: group(a.outputTokens), b: group(b.outputTokens) },
  { label: "Time", a: formatSeconds(a.durationNs), b: formatSeconds(b.durationNs) },
];

const figure = (value: string): string => (/^\d+$/.test(value) ? group(BigInt(value)) : value);

/** A short reading of one change, for a table cell. The full sentence (the one the command line prints) is in the cell's tooltip. */
function shortChange(change: DiffChange): string {
  switch (change.code) {
    case "STATUS": return change.b === "failed" ? "Failed in B, succeeded in A" : "Succeeded in B, failed in A";
    case "STATUS_MESSAGE": return "Different status message";
    case "PARENT": return "Under a different step";
    case "INPUT_TOKENS": return `Input tokens ${figure(change.a)} → ${figure(change.b)}`;
    case "OUTPUT_TOKENS": return `Output tokens ${figure(change.a)} → ${figure(change.b)}`;
    case "CONTENT": return "Different recorded content";
  }
}

function whatDiffers(item: DiffItem): { short: string; full: string } {
  if (item.status === "same") return { short: "", full: "Same in both runs." };
  if (item.status === "onlyA") return { short: "No matching step in run B", full: "Only run A has this step." };
  if (item.status === "onlyB") return { short: "No matching step in run A", full: "Only run B has this step." };
  return { short: item.changes.map(shortChange).join(" · "), full: `${item.changes.map(changeText).join("; ")}.` };
}

function StepCell({ step }: { step: Step }) {
  return <span className="rd-step" style={{ paddingLeft: `${Math.min(step.depth, 8) * 14}px` }}>
    <span className="rd-title">{step.title}</span>
    {step.failed && <span className="rd-tag">failed</span>}
  </span>;
}

function Row({ item, index, firstIndex, setPosition }: { item: DiffItem; index: number; firstIndex: number; setPosition: (value: number) => void }) {
  return <div role="row" className={`rd-row rd-${item.status}${index === firstIndex ? " rd-first" : ""}`}>
    <span role="cell" className="rd-cell">
      {item.a ? <StepCell step={item.a} /> : <span className="rd-none">Not in run A</span>}
      {item.a && item.status !== "same" && <button type="button" className="quiet-button rd-go" onClick={() => setPosition((item.a as Step).startSequence)}>Go to event {item.a.startSequence}</button>}
    </span>
    <span role="cell" className="rd-cell">{item.b ? <StepCell step={item.b} /> : <span className="rd-none">Not in run B</span>}</span>
    <span role="cell" className="rd-why" title={whatDiffers(item).full}><span className="rd-chip">{STATUS_CHIP[item.status]}</span>{index === firstIndex && <strong className="rd-firstmark">First difference</strong>}{whatDiffers(item).short && <span className="rd-short">{whatDiffers(item).short}</span>}</span>
  </div>;
}

/**
 * Run diff: compares the run open above (run A) with a second run (run B) and says where they first differ.
 * Everything happens in the browser; both files are read here and sent nowhere. The wording comes from
 * run-diff-report.ts, the same module the command line uses.
 */
export function RunDiffPanel({ model, sourceLabel, setPosition }: { model: RunModel; sourceLabel: string; setPosition: (value: number) => void }) {
  const uid = useId();
  const [other, setOther] = useState<Other | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const result = useMemo(() => (other ? diffRuns(model, other.model) : null), [model, other]);
  const folded = useMemo(() => (result && !result.tooLarge ? foldEntries(result.items) : []), [result]);
  const entries = useMemo(() => limitEntries(folded, open), [folded, open]);
  const toggle = (start: number) => setOpen((current) => { const next = new Set(current); if (next.has(start)) next.delete(start); else next.add(start); return next; });
  const runA = sourceLabel.replace(/\.$/, "");

  const openFile = async (file: File) => {
    setError(null);
    if (file.size > MAX_RUN_LOG_BYTES) {
      setError("This file is larger than the 128 MiB limit for run files.");
      return;
    }
    try {
      setOther({ model: loadRunFromBytes(new Uint8Array(await file.arrayBuffer())), label: `Run file ${file.name}` }); setOpen(new Set());
    } catch (caught) {
      setError(explainLoadError(caught));
    }
  };
  const useDemo = (text: string, label: string) => { setError(null); setOpen(new Set()); setOther({ model: loadRunFromBytes(encode(text)), label }); };

  return <section className="panel-card cc rd" aria-labelledby={`${uid}-title`}>
    <header className="surface-heading"><div><span className="eyebrow">Where do two runs first differ?</span><h2 id={`${uid}-title`}>Compare with another run</h2></div><span className="badge cc-badge">Compares two recordings</span></header>
    <p className="bp-note">Run A is the run open above ({runA}). Pick a second run to see where the two recordings first differ. A difference means the recordings differ, not that either run is right. Both files are read in this browser and sent nowhere.</p>

    <div className="bp-actions rd-actions">
      <button type="button" className="quiet-button" onClick={() => useDemo(demoRunVariantText, "Demo variant (second refund fails)")}>Compare with the demo variant</button>
      <button type="button" className="quiet-button" onClick={() => useDemo(demoRunFullText, "Demo run with content stored")}>Compare with the demo run kept with content</button>
      <label className="cc-file-button">Open a run file as run B<input type="file" accept=".jsonl,.runlog,.txt,application/x-ndjson,text/plain" onChange={(e) => { const file = e.currentTarget.files?.[0]; e.currentTarget.value = ""; if (file) void openFile(file); }} /></label>
      <button type="button" className="quiet-button" onClick={() => { setOther(null); setError(null); }} disabled={!other}>Clear run B</button>
    </div>

    {error && <p className="inline-error" role="alert">{error}</p>}
    {!other && !error && <p className="bp-hint">Choose a second run to compare. Try the demo variant: it is the demo run, except the second refund attempt also fails.</p>}

    {result && other && <>
      <p className="cc-summary" role="status"><strong>{diffVerdictLine(result)}</strong></p>
      <p className="rd-who">Run A: {runA}. Run B: {other.label}.</p>
      {!result.tooLarge && !result.identical && <p className="rd-counts">{diffCountsLine(result)}</p>}
      {!result.tooLarge && <>
        <h3 className="rd-heading">Steps side by side</h3>
        <div className="rd-steps" role="table" aria-label="Steps side by side">
          <div className="rd-row rd-head" role="row"><span role="columnheader">Run A</span><span role="columnheader">Run B</span><span role="columnheader">What differs</span></div>
          {entries.shown.map((entry) => {
            if (entry.kind === "fold") {
              const isOpen = open.has(entry.start);
              return <div key={`fold-${entry.start}`} className="rd-foldgroup">
                <button type="button" className="rd-fold" aria-expanded={isOpen} onClick={() => toggle(entry.start)}>{isOpen ? "Hide" : "Show"} {group(entry.total)} steps that match in both runs</button>
                {isOpen && entry.items.slice(0, entry.drawn).map(({ item, index }) => <Row key={index} item={item} index={index} firstIndex={result.firstIndex} setPosition={setPosition} />)}
              </div>;
            }
            return <Row key={entry.index} item={entry.item} index={entry.index} firstIndex={result.firstIndex} setPosition={setPosition} />;
          })}
        </div>
        {entries.hidden > 0 && <p className="rd-who">… and {group(entries.hidden)} more steps not shown (the list is capped at {group(ROW_LIMIT)} rows). Use the command line diff for the full list.</p>}
        {result.tools.length > 0 && <>
          <h3 className="rd-heading">Tool use that differs</h3>
          <ul className="rd-list">{result.tools.slice(0, TOOL_LINE_LIMIT).map((t) => <li key={t.tool}>{t.tool}: {group(t.a)} call(s) in run A, {group(t.b)} in run B</li>)}</ul>
          {result.tools.length > TOOL_LINE_LIMIT && <p className="rd-who">… and {group(result.tools.length - TOOL_LINE_LIMIT)} more tools.</p>}
        </>}
        <h3 className="rd-heading">Totals</h3>
        <table className="rd-totals">
          <thead><tr><th scope="col">Measure</th><th scope="col">Run A</th><th scope="col">Run B</th></tr></thead>
          <tbody>{totalRows(result.totals.a, result.totals.b).map((row) => <tr key={row.label} className={row.a === row.b ? "" : "rd-differs"}><th scope="row">{row.label}</th><td>{row.a}</td><td>{row.b}</td></tr>)}</tbody>
        </table>
      </>}
      <details className="bp-caveats"><summary>What this does and does not tell you</summary>
        <ul>{diffCaveats(result).map((note) => <li key={note}>{note}</li>)}</ul>
      </details>
    </>}
  </section>;
}
