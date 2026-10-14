import { useMemo, useRef, useState, type ComponentProps } from "react";
import { explainLoadError } from "./load-error.js";
import { MAX_RUN_LOG_BYTES } from "../run-limits.js";
import demoRunText from "./assets/demo-run.runlog.jsonl?raw";
import demoRunFullText from "./assets/demo-run-full.runlog.jsonl?raw";
import { MissionReplay } from "./mission-replay.js";
import { RunReplay } from "./run-replay.js";
import { loadRunFromBytes, type RunModel } from "./run-replay-model.js";

export { explainLoadError };

type ReplaySource = "mission" | "run";
type LoadedRun = { model: RunModel; label: string };

const demoRun = (): LoadedRun => ({
  model: loadRunFromBytes(new TextEncoder().encode(demoRunText)),
  label: "Demo run",
});

/**
 * The Replay screen: a mission history (the original replay) or an imported agent run. The mission replay is
 * unchanged; the run replay reads run files that the import command writes, entirely inside the browser.
 */
export function ReplayScreen(props: ComponentProps<typeof MissionReplay>) {
  const [source, setSource] = useState<ReplaySource>("mission");
  const [loaded, setLoaded] = useState<LoadedRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState<number | null>(null);
  const run = useMemo(() => loaded ?? (source === "run" ? demoRun() : null), [loaded, source]);
  // Each choice gets a number. A file that finishes reading after a newer choice (another file, the demo, "back") is dropped.
  const choice = useRef(0);

  const open = async (file: File) => {
    const mine = ++choice.current;
    setError(null);
    if (file.size > MAX_RUN_LOG_BYTES) {
      setError("This file is larger than the 128 MiB limit for run files.");
      return;
    }
    try {
      const model = loadRunFromBytes(new Uint8Array(await file.arrayBuffer()));
      if (mine !== choice.current) return;
      setLoaded({ model, label: `Run file ${file.name}.` });
      setPosition(null);
    } catch (caught) {
      if (mine === choice.current) setError(explainLoadError(caught));
    }
  };

  const runPosition = run ? Math.max(1, Math.min(position ?? run.model.events.length, run.model.events.length)) : 1;

  return <>
    <div className="replay-source" role="group" aria-label="Replay source">
      <span>Replay source</span>
      <button type="button" className={source === "mission" ? "selected" : ""} aria-pressed={source === "mission"} onClick={() => setSource("mission")}>Mission history</button>
      <button type="button" className={source === "run" ? "selected" : ""} aria-pressed={source === "run"} onClick={() => setSource("run")}>Imported agent run</button>
    </div>
    {source === "mission" ? <MissionReplay {...props} /> : <>
      <section className="panel-card run-source-card" aria-labelledby="run-source-title">
        <div className="eyebrow" id="run-source-title">Run file</div>
        <p>{loaded ? loaded.label : "Showing the built-in synthetic demo run."} Open a run file that the import command saved to see your own agent run.</p>
        <div className="run-source-actions">
          <label className="file-button">Open a run file<input type="file" accept=".jsonl,.runlog,.txt,application/x-ndjson,text/plain" onChange={(e) => { const file = e.currentTarget.files?.[0]; e.currentTarget.value = ""; if (file) void open(file); }} /></label>
          <button type="button" className="quiet-button" onClick={() => { choice.current += 1; setLoaded({ model: loadRunFromBytes(new TextEncoder().encode(demoRunFullText)), label: "Demo run with content stored." }); setPosition(null); setError(null); }}>Demo run with content stored</button>
          {loaded && <button type="button" className="quiet-button" onClick={() => { choice.current += 1; setLoaded(null); setPosition(null); setError(null); }}>Back to the demo run</button>}
        </div>
        {error && <p className="inline-error" role="alert">{error}</p>}
        <details className="run-source-help"><summary>How to make a run file</summary>
          <p>Import a trace (OTLP/JSON) with <code>npm run forensics -- import &lt;spans.json&gt; --logs &lt;logs.json&gt;</code>. The command saves a run file in <code>%LOCALAPPDATA%\DropScope\runs</code>. By default prompts and answers are not kept, only their sizes and fingerprints. Run files stay on this computer: this page reads the file in your browser and sends it nowhere.</p>
        </details>
      </section>
      {run && <RunReplay model={run.model} position={runPosition} setPosition={setPosition} sourceLabel={`${run.label}${run.label.endsWith(".") ? "" : "."}`} />}
    </>}
  </>;
}
