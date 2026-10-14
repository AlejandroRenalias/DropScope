import { useMemo, useRef, useState } from "react";
import type { RunEvent } from "../run-events.js";
import { PageHead } from "./research-office.js";
import {
  categoryOf, describeRunEvent, describeStateChange, eventStepId, formatDuration, formatNumber, runEventCategories, stepStatusAt,
  NOTE_LIST_LIMIT, visibleSteps, type RunEventCategory, type RunModel, type StepStatus,
} from "./run-replay-model.js";

const MAX_TICKS = 120;
const LIST_RADIUS = 30;

type Bucket = { from: number; to: number; category: RunEventCategory | "run"; failed: boolean };

function buildBuckets(events: readonly RunEvent[]): Bucket[] {
  const count = Math.min(events.length, MAX_TICKS);
  const priority: Array<RunEventCategory | "run"> = ["step", "tokens", "content", "log", "note", "run"];
  const buckets: Bucket[] = [];
  for (let i = 0; i < count; i += 1) {
    const from = Math.floor((i * events.length) / count) + 1;
    const to = Math.floor(((i + 1) * events.length) / count);
    let category: RunEventCategory | "run" = "run";
    let failed = false;
    for (let n = from; n <= to; n += 1) {
      const event = events[n - 1];
      const c = categoryOf(event);
      if (priority.indexOf(c) < priority.indexOf(category)) category = c;
      if (event.type === "StepEnded" && event.payload.statusCode === 2) failed = true;
    }
    buckets.push({ from, to, category, failed });
  }
  return buckets;
}

const STATUS_WORD: Record<StepStatus, string> = { "not-started": "Not started", running: "Running", finished: "Finished", failed: "Failed" };

export function RunReplay({ model, position, setPosition, sourceLabel }: { model: RunModel; position: number; setPosition: (value: number) => void; sourceLabel: string }) {
  const total = model.events.length;
  const bounded = Math.max(1, Math.min(position, total));
  const [filters, setFilters] = useState<RunEventCategory[]>(runEventCategories.map((c) => c.id));
  const ticksRef = useRef<HTMLDivElement>(null);

  const buckets = useMemo(() => buildBuckets(model.events), [model]);
  const state = useMemo(() => model.replay.stateAt(bounded), [model, bounded]);
  const previous = useMemo(() => (bounded > 1 ? model.replay.stateAt(bounded - 1) : null), [model, bounded]);
  const event = model.events[bounded - 1];
  const description = describeRunEvent(event, model);
  const changes = describeStateChange(previous, state);
  const currentStepId = eventStepId(event);
  const tree = useMemo(() => visibleSteps(model, bounded), [model, bounded]);
  const notesSoFar = model.notes.filter((note) => note.sequence <= bounded).length;
  const contentCount = Object.values(state.content).reduce((a, b) => a + b, 0);
  const numberEvery = Math.max(1, Math.ceil(buckets.length / 12));
  const currentBucket = buckets.findIndex((b) => bounded >= b.from && bounded <= b.to);

  const chronology = useMemo(() => {
    const lo = Math.max(1, bounded - LIST_RADIUS * 3);
    const hi = Math.min(total, bounded + LIST_RADIUS * 3);
    const rows: number[] = [];
    for (let n = lo; n <= hi; n += 1) {
      const category = categoryOf(model.events[n - 1]);
      if (category === "run" || filters.includes(category)) rows.push(n);
    }
    // At most LIST_RADIUS rows each side of the current event, taken from the filtered rows.
    const after = rows.filter((n) => n >= bounded).slice(0, LIST_RADIUS + 1);
    const before = rows.filter((n) => n < bounded).slice(-LIST_RADIUS);
    return [...before, ...after];
  }, [model, bounded, filters, total]);

  const moveTo = (target: number) => {
    const next = Math.max(1, Math.min(target, total));
    setPosition(next);
    requestAnimationFrame(() => {
      const index = buckets.findIndex((b) => next >= b.from && next <= b.to);
      ticksRef.current?.querySelector<HTMLButtonElement>(`[data-bucket="${index}"]`)?.focus();
    });
  };
  const onTickKey = (keyEvent: React.KeyboardEvent) => {
    const key = keyEvent.key;
    const target = key === "ArrowRight" || key === "ArrowUp" ? bounded + 1 : key === "ArrowLeft" || key === "ArrowDown" ? bounded - 1 : key === "Home" ? 1 : key === "End" ? total : null;
    if (target === null) return;
    keyEvent.preventDefault();
    moveTo(target);
  };
  const toggle = (category: RunEventCategory) => setFilters((now) => now.includes(category) ? now.filter((c) => c !== category) : [...now, category]);
  const announcement = `Event ${bounded} of ${total}: ${description.title}. ${changes.length ? changes.join(". ") : "No visible change to the recorded state."}`;
  const stored = model.contentMode === "FULL";

  return <section className="decision-view replay-view run-replay" aria-label="Agent run replay">
    <PageHead eyebrow="Agent run replay" title="Scrub through an agent run" description={`${sourceLabel} Drag through the recorded events and watch each step start, finish or fail. Filters change the view only; the recording never changes.`} aside={<strong className="replay-position">Event {bounded} / {total}</strong>} />

    <p className="rr-banner" role="note">
      <strong>Imported run · recorded replay</strong>
      <span>Steps are ordered by their recorded times (a derived order). Content is {stored ? "stored as written in this file" : "withheld: only sizes and fingerprints were kept"}. This shows what the trace says happened; nothing is re-run.</span>
    </p>

    <section className="panel-card timeline-card" aria-labelledby="rr-timeline-title">
      <div className="eyebrow" id="rr-timeline-title">Timeline</div>
      <div className="ticks rr-ticks" role="group" aria-label="Recorded events" ref={ticksRef} onKeyDown={onTickKey}>
        {buckets.map((bucket, index) => {
          const isCurrent = index === currentBucket;
          const label = bucket.from === bucket.to ? `Event ${bucket.from}` : `Events ${bucket.from} to ${bucket.to}`;
          const dim = bucket.category !== "run" && !filters.includes(bucket.category);
          return <button type="button" key={bucket.from} data-bucket={index} className={`tick rr-${bucket.failed ? "failed" : bucket.category} ${bucket.to <= bounded ? "past" : "future"} ${isCurrent ? "cur" : ""} ${dim ? "dim" : ""}`} tabIndex={isCurrent ? 0 : -1} aria-label={`${label}, ${bucket.failed ? "a step failed" : bucket.category}`} aria-current={isCurrent ? "step" : undefined} onClick={() => setPosition(bucket.to)}>{(index === 0 || index % numberEvery === 0 || isCurrent) && <span className="num" aria-hidden="true">{bucket.from}</span>}</button>;
        })}
      </div>
      <label className="sr-only" htmlFor="rr-position">Timeline position</label>
      <input id="rr-position" className="scrubber" type="range" min="1" max={total} value={bounded} aria-valuetext={`Event ${bounded} of ${total}, ${description.title}`} style={{ "--fill": `${total > 1 ? ((bounded - 1) / (total - 1)) * 100 : 100}%` } as React.CSSProperties} onChange={(e) => setPosition(Number(e.currentTarget.value))} />
      <p className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</p>
      <div className="timeline-tools">
        <div className="cats" role="group" aria-label="Event category filters">{runEventCategories.map((c) => <button type="button" key={c.id} className={`cat ${filters.includes(c.id) ? "on" : ""}`} aria-pressed={filters.includes(c.id)} onClick={() => toggle(c.id)}><i className={`dot rr-dot-${c.id}`} aria-hidden="true" />{c.label}</button>)}</div>
      </div>
    </section>

    <section className="rr-stats" aria-label="Recorded state at this event">
      <div className="panel-card rr-stat"><span className="eyebrow">Tokens so far</span><strong>{formatNumber(state.inputTokens)} <small>input</small></strong><strong>{formatNumber(state.outputTokens)} <small>output</small></strong></div>
      <div className="panel-card rr-stat"><span className="eyebrow">Steps</span><strong>{state.openStepIds.length} <small>running</small></strong><strong>{state.closedStepIds.length - state.errorStepIds.length} <small>finished</small></strong><strong className={state.errorStepIds.length ? "rr-bad" : ""}>{state.errorStepIds.length} <small>failed</small></strong><small className="rr-of">of {model.steps.length} in this run</small></div>
      <div className="panel-card rr-stat"><span className="eyebrow">Content recorded</span><strong>{contentCount} <small>{stored ? "items stored" : "items withheld"}</small></strong><small className="rr-of">{state.logCount} log record{state.logCount === 1 ? "" : "s"}</small></div>
      <div className="panel-card rr-stat"><span className="eyebrow">Importer notes</span><strong>{notesSoFar} <small>so far</small></strong><small className="rr-of">{model.notes.length} in all</small></div>
    </section>

    <div className="replay-grid rr-grid">
      <section className="panel-card rr-steps" aria-labelledby="rr-steps-title">
        <header className="surface-heading"><div><span className="eyebrow">Steps at this event</span><h2 id="rr-steps-title">Step tree</h2></div><small>{model.steps.length} steps · {model.durationLabel}</small></header>
        {tree.hidden > 0 && <p className="rr-hidden-note">Showing {tree.steps.length} steps: those running, failed, active near this event, or finished most recently. {tree.hidden} other steps are hidden.</p>}
        <ol className="rr-tree">
          {tree.steps.map((step) => {
            const status = stepStatusAt(step, bounded);
            const usage = step.usageSequence !== null && step.usageSequence <= bounded;
            return <li key={step.stepId} className={`rr-step ${status} ${step.stepId === currentStepId ? "current" : ""}`} style={{ paddingLeft: `${step.depth * 20}px` }}>
              <button type="button" onClick={() => setPosition(step.startSequence)} aria-label={`Go to the start of ${step.title}. ${STATUS_WORD[status]}.`}>
                <span className={`rr-status ${status}`}>{STATUS_WORD[status]}</span>
                <span className="rr-title">{step.title}</span>
                <span className="rr-meta">
                  {status === "finished" || status === "failed" ? formatDuration(step.startNs, step.endEffectiveNs) : status === "running" ? "in progress" : ""}
                  {usage && ` · ${step.inputTokens === null ? "?" : formatNumber(step.inputTokens)} in / ${step.outputTokens === null ? "?" : formatNumber(step.outputTokens)} out`}
                </span>
              </button>
            </li>;
          })}
        </ol>
      </section>

      <section className="panel-card event-card" aria-labelledby="rr-event-title">
        <div className="eyebrow" id="rr-event-title">Event {bounded} · {description.category === "run" ? "Run" : runEventCategories.find((c) => c.id === description.category)?.label}</div>
        <h2>{description.title}</h2>
        <p className="event-summary">{description.summary}</p>
        <div className="eyebrow">What changed</div>
        <ul className="deltas">{changes.length ? changes.map((line) => <li key={line}>{line}</li>) : <li className="none">No visible change to the recorded state. The event is kept in the history.</li>}</ul>
        <details className="raw"><summary>Show raw event</summary><pre>{JSON.stringify(event.payload, null, 2)}</pre></details>
      </section>
    </div>

    {model.notes.length > 0 && <section className="panel-card rr-notes" aria-labelledby="rr-notes-title">
      <header className="surface-heading"><div><span className="eyebrow">What the importer did</span><h2 id="rr-notes-title">Importer notes</h2></div><small>{model.notes.length} note{model.notes.length === 1 ? "" : "s"}</small></header>
      {model.notes.length > NOTE_LIST_LIMIT && <p className="rr-hidden-note">Showing the first {NOTE_LIST_LIMIT} of {model.notes.length} notes.</p>}
      <ul className="rr-note-list">{model.notes.slice(0, NOTE_LIST_LIMIT).map((note) => <li key={note.sequence} className={note.sequence <= bounded ? "seen" : ""}><div><strong>{note.title}</strong><span>{note.text}</span></div><button type="button" onClick={() => setPosition(note.sequence)}>Go to event {note.sequence}</button></li>)}</ul>
    </section>}

    <section className="panel-card replay-chronology" aria-labelledby="rr-chronology-title">
      <header className="surface-heading"><div><span className="eyebrow">Recorded sequence</span><h2 id="rr-chronology-title">Event chronology</h2></div><small>{chronology.length} shown near event {bounded}</small></header>
      <div className="event-list replay-events">{chronology.map((n) => {
        const d = describeRunEvent(model.events[n - 1], model);
        return <article className={`event ${n <= bounded ? "replayed" : ""} ${n === bounded ? "current" : ""}`} key={n}><b>{String(n).padStart(2, "0")}</b><span><strong>{d.title}</strong><small>{d.summary.length > 140 ? `${d.summary.slice(0, 140)}…` : d.summary}</small></span><button type="button" onClick={() => setPosition(n)}>Inspect</button></article>;
      })}</div>
    </section>
  </section>;
}
