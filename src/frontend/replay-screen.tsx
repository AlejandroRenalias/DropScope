import { useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { CaretDown, Check, FolderOpen, GitDiff, Moon, Sun, UploadSimple, X } from "./ds-icons.js";
import { Popover } from "@radix-ui/themes";
import { explainLoadError } from "./load-error.js";
import { MAX_RUN_LOG_BYTES } from "../run-limits.js";
import demoRunText from "./assets/demo-run.runlog.jsonl?raw";
import demoRunFullText from "./assets/demo-run-full.runlog.jsonl?raw";
import { IconButton } from "./ds-ui.js";
import { MissionReplay } from "./mission-replay.js";
import { RunReplay, type DockTab } from "./run-replay.js";
import { loadRunFromBytes, type RunModel } from "./run-replay-model.js";

export { explainLoadError };

type Source = "demo" | "demo-full" | "file";
type LoadedRun = { model: RunModel; label: string; source: Source; name: string };

const demoRun = (): LoadedRun => ({
  model: loadRunFromBytes(new TextEncoder().encode(demoRunText)),
  label: "Demo run",
  source: "demo",
  name: "demo-run.runlog.jsonl",
});

const SOURCE_BADGE: Record<Source, string> = { demo: "Demo", "demo-full": "Demo", file: "Run file" };

/** The mission replay screen of the legacy mission simulator. */
export function ReplayScreen(props: ComponentProps<typeof MissionReplay>) {
  return <MissionReplay {...props} />;
}

/**
 * The agent run replay: opens the built-in demo run, or a run file that the import command wrote. The file is
 * read entirely inside the browser.
 */
export function RunScreen({ theme, onToggleTheme }: { theme: "light" | "dark"; onToggleTheme: () => void }) {
  const [loaded, setLoaded] = useState<LoadedRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  const [position, setPosition] = useState<number | null>(null);
  const [tab, setTab] = useState<DockTab>("events");
  const [dragging, setDragging] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const run = useMemo(() => loaded ?? demoRun(), [loaded]);
  // Each choice gets a number. A file that finishes reading after a newer choice (another file, the demo, "back") is dropped.
  const choice = useRef(0);
  const dragDepth = useRef(0);

  const open = async (file: File) => {
    const mine = ++choice.current;
    setError(null);
    setReading(null);
    if (file.size > MAX_RUN_LOG_BYTES) {
      setError("This file is larger than the 128 MiB limit for run files.");
      return;
    }
    setReading(file.name);
    try {
      const model = loadRunFromBytes(new Uint8Array(await file.arrayBuffer()));
      if (mine !== choice.current) return;
      setLoaded({ model, label: `Run file ${file.name}.`, source: "file", name: file.name });
      setPosition(null);
    } catch (caught) {
      if (mine === choice.current) setError(explainLoadError(caught));
    } finally {
      if (mine === choice.current) setReading(null);
    }
  };

  const choose = (next: LoadedRun | null) => {
    choice.current += 1;
    setLoaded(next);
    setPosition(null);
    setError(null);
    setReading(null);
    setSourceOpen(false);
  };

  const runPosition = Math.max(1, Math.min(position ?? run.model.events.length, run.model.events.length));
  const sentence = reading ? `Opening ${reading}.` : loaded ? loaded.label : "Showing the built-in synthetic demo run.";

  // A run file dropped anywhere on the page opens like one chosen with the button.
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current += 1;
      setDragging(true);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const file = e.dataTransfer?.files[0];
      if (file) void openRef.current(file);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, []);

  return (
    <div className="ds-shell">
      <header className="topbar ds-topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">DropScope</span>
        </div>
        <div className="run-source-card">
          <Popover.Root open={sourceOpen} onOpenChange={setSourceOpen}>
            <Popover.Trigger>
              <button type="button" className={`ds-source ${reading ? "is-reading" : ""}`}>
                <span className="ds-source-name" aria-hidden="true">
                  {reading ? `Opening ${reading}` : run.name}
                </span>
                {!reading && (
                  <span className={`ds-badge ds-source-badge is-${run.source}`} aria-hidden="true">
                    {SOURCE_BADGE[run.source]}
                  </span>
                )}
                {reading && <span className="ds-reading" aria-hidden="true" />}
                <span className="sr-only">{sentence} Choose a run.</span>
                <CaretDown size={12} className="ds-source-caret" />
              </button>
            </Popover.Trigger>
            <Popover.Content className="ds-popover ds-source-popover" align="start" sideOffset={6} maxWidth="380px">
              <p className="ds-pop-title">Choose a run</p>
              <div className="ds-choices">
                <button type="button" className="ds-choice" aria-current={run.source === "demo"} onClick={() => choose(null)}>
                  <span>
                    <strong>Built-in demo run</strong>
                    <small>A support agent refunds an order. Content withheld.</small>
                  </span>
                  {run.source === "demo" && <Check size={14} />}
                </button>
                <button
                  type="button"
                  className="ds-choice"
                  aria-current={run.source === "demo-full"}
                  onClick={() =>
                    choose({
                      model: loadRunFromBytes(new TextEncoder().encode(demoRunFullText)),
                      label: "Demo run with content stored.",
                      source: "demo-full",
                      name: "demo-run-full.runlog.jsonl",
                    })
                  }
                >
                  <span>
                    <strong>Demo run with content stored</strong>
                    <small>The same run with prompts and answers kept, for claim checks.</small>
                  </span>
                  {run.source === "demo-full" && <Check size={14} />}
                </button>
              </div>
              <div className="ds-pop-help">
                <p className="ds-pop-title">Your own run</p>
                <p>
                  Import a trace (OTLP/JSON) with <code>npm run forensics -- import &lt;spans.json&gt; --logs &lt;logs.json&gt;</code>. The
                  command saves a run file in a private DropScope folder and prints its path.
                </p>
                <p>
                  By default prompts and answers are not kept, only their sizes and fingerprints. This page reads the file in your browser
                  and sends it nowhere. You can also drop a run file anywhere on this page.
                </p>
              </div>
            </Popover.Content>
          </Popover.Root>
          <label className="file-button ds-btn ds-btn-primary">
            <FolderOpen size={15} />
            <span className="ds-btn-text">Open a run file</span>
            <input
              type="file"
              aria-label="Open a run file"
              accept=".jsonl,.runlog,.txt,application/x-ndjson,text/plain"
              onChange={(e) => {
                const file = e.currentTarget.files?.[0];
                e.currentTarget.value = "";
                if (file) void open(file);
              }}
            />
          </label>
        </div>
        <div className="ds-topbar-actions">
          <button
            type="button"
            className="ds-btn ds-btn-quiet ds-compare-btn"
            aria-pressed={tab === "compare"}
            onClick={() => {
              setTab("compare");
              requestAnimationFrame(() => document.getElementById("rr-tab-compare")?.focus());
            }}
          >
            <GitDiff size={15} />
            Compare
          </button>
          <IconButton label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} onClick={onToggleTheme}>
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </IconButton>
          <a className="legacy-link" href="#missions">
            <span className="short">Legacy simulator</span>
            <span className="long">Mission simulator (legacy)</span>
          </a>
        </div>
      </header>

      {error && (
        <div className="ds-alert" role="alert">
          <span>{error}</span>
          <IconButton label="Dismiss this message" onClick={() => setError(null)}>
            <X size={14} />
          </IconButton>
        </div>
      )}

      <main className="ds-main-region" id="main">
        <RunReplay
          model={run.model}
          position={runPosition}
          setPosition={setPosition}
          sourceLabel={`${run.label}${run.label.endsWith(".") ? "" : "."}`}
          tab={tab}
          setTab={setTab}
        />
      </main>

      {dragging && (
        <div className="ds-drop" aria-hidden="true">
          <div className="ds-drop-card">
            <UploadSimple size={28} />
            <strong>Drop a run file to open it</strong>
            <span>It is read in this browser and sent nowhere.</span>
          </div>
        </div>
      )}
    </div>
  );
}
