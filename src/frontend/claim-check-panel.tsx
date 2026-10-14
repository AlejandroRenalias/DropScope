import { useId, useMemo, useRef, useState } from "react";
import { CLAIM_LIMITS, checkClaims, decodeClaimBytes, parseClaimText } from "../claim-check.js";
import { CLAIM_NOTE, VERDICT_LABEL, claimCaveats, claimSummary, describeClaimResult } from "../claim-report.js";
import type { RunModel } from "./run-replay-model.js";

/** An example that fits the built-in demo run (with its content stored): two claims it supports and one it does not. */
export const EXAMPLE_CLAIMS = JSON.stringify({
  claims: [
    { id: "order-total", text: "The order total was 59.00", tool: "lookup_order", mustContain: ["59.0"] },
    { id: "refund-accepted", text: "The refund was accepted", tool: "issue_refund", mustContain: ["accepted"] },
    { id: "order-delivered", text: "The order had been delivered", tool: "lookup_order", mustContain: ["\"delivered\":true"] },
  ],
}, null, 2);

const SYNTAX_HELP = `{
  "claims": [
    {
      "id": "order-total",          // a short name, letters and digits only
      "text": "The order total was 59.00",   // what was claimed
      "tool": "lookup_order",        // the tool whose recorded result is the evidence
      "mustContain": ["59.0"]        // texts that must all appear in it
    }
  ]
}`;

export function ClaimCheckPanel({ model, setPosition }: { model: RunModel; setPosition: (value: number) => void }) {
  const uid = useId();
  const [text, setText] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const touched = text.trim() !== "";
  const parsed = useMemo(() => (touched ? parseClaimText(text) : null), [text, touched]);
  const check = useMemo(() => (parsed && parsed.errors.length === 0 ? checkClaims(model.events, parsed.claims) : null), [parsed, model]);
  const titleOf = (stepId: string): string => model.stepsById.get(stepId)?.title ?? "a step";
  const stored = model.contentMode === "FULL";

  // Each choice gets a number; a claims file that finishes reading after the box was edited, cleared or refilled is dropped.
  const choice = useRef(0);
  const openFile = async (file: File) => {
    const mine = ++choice.current;
    setFileError(null);
    if (file.size > CLAIM_LIMITS.maxBytes) {
      setFileError("This claims file is larger than 1 MiB.");
      return;
    }
    try {
      // Show the file's own text in the box so it can be edited. Invalid UTF-8 is refused, not repaired.
      const decoded = decodeClaimBytes(new Uint8Array(await file.arrayBuffer()));
      if (mine === choice.current) setText(decoded);
    } catch {
      if (mine === choice.current) setFileError("This claims file is not valid UTF-8 text.");
    }
  };

  return <section className="panel-card cc" aria-labelledby={`${uid}-title`}>
    <header className="surface-heading"><div><span className="eyebrow">Is it backed by the recording?</span><h2 id={`${uid}-title`}>Claim check</h2></div><span className="badge cc-badge">Checks the recording</span></header>
    <p className="bp-note">{CLAIM_NOTE}</p>
    {!stored && <p className="cc-withheld" role="note"><strong>This run keeps no content.</strong> Only sizes and fingerprints were saved, so every claim about content will say "Cannot check". Import the trace again with <code>--full</code> to check claims, or use the demo run with content stored.</p>}

    <div className="cc-form">
      <label htmlFor={`${uid}-claims`}>Claims (JSON)</label>
      <textarea id={`${uid}-claims`} rows={9} spellCheck={false} autoComplete="off" value={text} onChange={(e) => { choice.current += 1; setText(e.currentTarget.value); setFileError(null); }} placeholder={SYNTAX_HELP.replace(/ +\/\/.*$/gm, "")} />
      <div className="bp-actions">
        <button type="button" className="quiet-button" onClick={() => { choice.current += 1; setText(EXAMPLE_CLAIMS); setFileError(null); }}>Try an example (3 claims)</button>
        <label className="cc-file-button">Open a claims file<input type="file" accept=".json,application/json,text/plain" onChange={(e) => { const file = e.currentTarget.files?.[0]; e.currentTarget.value = ""; if (file) void openFile(file); }} /></label>
        <button type="button" className="quiet-button" onClick={() => { choice.current += 1; setText(""); setFileError(null); }} disabled={!touched}>Clear claims</button>
      </div>
      <details className="bp-caveats"><summary>How to write a claim</summary>
        <p>Each claim says what was claimed, which step holds the evidence, and the exact texts that must appear in it. The evidence is the recorded result of a tool (<code>"tool"</code>), or any step by its id (<code>"stepId"</code>, with <code>"field"</code>).</p>
        <pre className="cc-syntax">{SYNTAX_HELP}</pre>
        <p>Other options: <code>"field"</code> (result, arguments, input or output; the default is result), <code>"caseSensitive": false</code>, and <code>"atEvent": 12</code> to accept only content recorded at or before event 12. Up to {CLAIM_LIMITS.maxClaims} claims, with up to {CLAIM_LIMITS.maxStrings} texts each. Comments are not allowed in the real file.</p>
      </details>
    </div>

    {fileError && <p className="inline-error" role="alert">{fileError}</p>}
    {parsed && parsed.errors.length > 0 && <ul className="bp-errors" role="status" aria-live="polite">{parsed.errors.map((message, i) => <li key={`${i}-${message}`}>{message}</li>)}</ul>}
    {!touched && <p className="bp-hint">Write or open some claims to see which ones the recorded content supports.</p>}

    {check && <>
      <p className="cc-summary" role="status"><strong>{claimSummary(check)}</strong></p>
      <ol className="cc-results">
        {check.results.map((r) => {
          const jump = r.evidenceEvent ?? (r.stepId === null ? null : model.stepsById.get(r.stepId)?.startSequence ?? null);
          return <li key={r.claim.id} className={`cc-result ${r.verdict.toLowerCase().replace("_", "-")}`}>
            <div className="cc-head"><span className="cc-verdict">{VERDICT_LABEL[r.verdict]}</span><strong>{r.claim.id}</strong></div>
            <p className="cc-claim">{r.claim.text}</p>
            <p className="cc-why">{describeClaimResult(r, titleOf, check.knownTools, check.knownToolsTotal)}</p>
            {jump !== null && <button type="button" className="quiet-button" onClick={() => setPosition(jump)}>Go to event {jump}</button>}
          </li>;
        })}
      </ol>
      <details className="bp-caveats"><summary>What this does and does not tell you</summary>
        <ul>{claimCaveats(check).map((note) => <li key={note}>{note}</li>)}</ul>
      </details>
    </>}
  </section>;
}
