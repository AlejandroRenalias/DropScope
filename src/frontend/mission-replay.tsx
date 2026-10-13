import { useMemo, useRef, useState } from "react";
import type { MissionEvent } from "../contracts.js";
import { officeHistories, projectOffice, replayEvents, type OfficeProjection, type OfficeScenario, type ReplayEventCategory } from "./office-projection.js";
import { Constellation, PageHead } from "./research-office.js";
import { describeChange, humanizeType, uniqueAgents } from "./research-model.js";
import { summarizeResearchEvent } from "./research-presentation.js";
import type { LocalMissionDto } from "./runtime-client.js";

const categories: Array<{ id: ReplayEventCategory; label: string }> = [
  { id: "task", label: "Task" },
  { id: "agent", label: "Agent" },
  { id: "budget", label: "Budget" },
  { id: "review", label: "Review" },
  { id: "failure", label: "Failure" },
];

export function MissionReplay({ scenario, setScenario, activeHistory, history, position, setPosition }: { scenario: OfficeScenario; setScenario: (value: OfficeScenario) => void; activeHistory?: LocalMissionDto; history: MissionEvent[]; position: number; setPosition: (value: number) => void }) {
  const [filters, setFilters] = useState<ReplayEventCategory[]>(categories.map((category) => category.id));
  const bounded = Math.max(1, Math.min(position, history.length));
  const records = useMemo(() => replayEvents(history), [history]);
  const visible = records.filter((record) => filters.includes(record.category));
  const current = records[bounded - 1];
  const event = history[bounded - 1];
  const numberEvery = Math.max(1, Math.ceil(records.length / 12));
  const ticksRef = useRef<HTMLDivElement>(null);

  let projection: OfficeProjection | null = null;
  let previous: OfficeProjection | null = null;
  let error: string | null = null;
  try { projection = projectOffice(history.slice(0, bounded)); } catch (caught) { error = caught instanceof Error ? caught.message : "This event prefix cannot be projected."; }
  try { previous = bounded > 1 ? projectOffice(history.slice(0, bounded - 1)) : null; } catch { previous = null; }
  const change = projection ? describeChange(previous, projection) : { lines: [], taskIds: new Set<string>() };
  const working = projection ? uniqueAgents(projection).filter((agent) => agent.state === "WORKING").length : 0;
  const moveTo = (sequence: number) => {
    const next = Math.max(1, Math.min(sequence, history.length));
    setPosition(next);
    requestAnimationFrame(() => ticksRef.current?.querySelector<HTMLButtonElement>(`[data-sequence="${next}"]`)?.focus());
  };
  const onTickKey = (keyEvent: React.KeyboardEvent) => {
    const target = keyEvent.key === "ArrowRight" || keyEvent.key === "ArrowUp" ? bounded + 1 : keyEvent.key === "ArrowLeft" || keyEvent.key === "ArrowDown" ? bounded - 1 : keyEvent.key === "Home" ? 1 : keyEvent.key === "End" ? history.length : null;
    if (target === null) return;
    keyEvent.preventDefault();
    moveTo(target);
  };
  const announcement = event ? `Event ${bounded} of ${history.length}: ${humanizeType(event.type)}. ${change.lines.length ? change.lines.join(". ") : "No visible change to the research state."}` : "";
  const toggle = (category: ReplayEventCategory) => setFilters((currentFilters) => currentFilters.includes(category) ? currentFilters.filter((item) => item !== category) : [...currentFilters, category]);

  return <section className="decision-view replay-view" aria-label="Mission Replay">
    <PageHead eyebrow="Mission Replay" title="Scrub through the mission" description={`${activeHistory ? `Persisted local mission ${activeHistory.missionId}.` : `Selected synthetic ${scenario.toLowerCase()} history.`} Drag through the recorded events and watch the research constellation rebuild itself. Filters change the view only; mission state never changes.`} aside={<strong className="replay-position">Event {bounded} / {history.length}</strong>} />

    <section className="panel-card timeline-card" aria-labelledby="timeline-title">
      <div className="eyebrow" id="timeline-title">Timeline</div>
      <div className="ticks" role="group" aria-label="Recorded events" ref={ticksRef} onKeyDown={onTickKey}>
        {records.map((record) => <button type="button" key={record.sequence} className={`tick ${record.category} ${record.sequence <= bounded ? "past" : "future"} ${record.sequence === bounded ? "cur" : ""} ${filters.includes(record.category) ? "" : "dim"}`} data-sequence={record.sequence} tabIndex={record.sequence === bounded ? 0 : -1} aria-label={`Event ${record.sequence}, ${record.category}`} aria-current={record.sequence === bounded ? "step" : undefined} onClick={() => setPosition(record.sequence)}>{(record.sequence === 1 || record.sequence % numberEvery === 0 || record.sequence === bounded) && <span className="num" aria-hidden="true">{record.sequence}</span>}</button>)}
      </div>
      <label className="sr-only" htmlFor="replay-position">Timeline position</label>
      <input id="replay-position" className="scrubber" type="range" min="1" max={history.length} value={bounded} aria-valuetext={event ? `Event ${bounded} of ${history.length}, ${humanizeType(event.type)}` : undefined} style={{ "--fill": `${history.length > 1 ? ((bounded - 1) / (history.length - 1)) * 100 : 100}%` } as React.CSSProperties} onChange={(changeEvent) => setPosition(Number(changeEvent.currentTarget.value))} />
      <p className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</p>
      <div className="timeline-tools">
        <div className="cats" role="group" aria-label="Event category filters">{categories.map((category) => <button type="button" key={category.id} className={`cat ${filters.includes(category.id) ? "on" : ""}`} aria-pressed={filters.includes(category.id)} onClick={() => toggle(category.id)}><i className={`dot ${category.id}`} aria-hidden="true" />{category.label}</button>)}</div>
        <div className="replay-scenarios"><span>{activeHistory ? "Demo histories (unavailable while a saved mission is loaded)" : "History"}</span>{(Object.keys(officeHistories) as OfficeScenario[]).map((name) => <button type="button" className={scenario === name && !activeHistory ? "selected" : ""} aria-pressed={scenario === name && !activeHistory} disabled={Boolean(activeHistory)} key={name} onClick={() => { setScenario(name); setPosition(officeHistories[name].length); }}>{name}</button>)}</div>
      </div>
    </section>

    <div className="replay-grid">
      <section className="panel-card snapshot-card" aria-label="Mission state at this event">
        {error ? <p className="inline-error">Prefix unavailable: {error}</p> : projection && <Constellation snapshot eyebrow={`State as of event ${bounded}`} title={projection.mission.phase} tasks={projection.tasks} onSelect={() => undefined} working={working} status={projection.mission.status} changed={change.taskIds} />}
      </section>
      <section className="panel-card event-card" aria-labelledby="event-card-title">
        <div className="eyebrow" id="event-card-title">Event {bounded} · {current?.category}</div>
        <h2>{event ? humanizeType(event.type) : "No event"}</h2>
        {event && <p className="event-summary">{summarizeResearchEvent(event)}</p>}
        <div className="eyebrow">What changed</div>
        <ul className="deltas">{change.lines.length ? change.lines.map((line) => <li key={line}>{line}</li>) : <li className="none">No visible change to the research state. The event is recorded for the history.</li>}</ul>
        {event && <details className="raw"><summary>Show raw payload</summary><pre>{JSON.stringify(event.payload, null, 2)}</pre></details>}
      </section>
    </div>

    <section className="panel-card replay-chronology" aria-labelledby="replay-chronology-title">
      <header className="surface-heading"><div><span className="eyebrow">Recorded sequence</span><h2 id="replay-chronology-title">Event chronology</h2></div><small>{visible.length} visible</small></header>
      <div className="event-list replay-events">{visible.map((record) => <article className={`event ${record.sequence <= bounded ? "replayed" : ""} ${record.sequence === bounded ? "current" : ""}`} key={record.sequence}><b>{String(record.sequence).padStart(2, "0")}</b><span><strong>{record.type}</strong><small>{record.category} · {record.detail}</small></span><button type="button" onClick={() => setPosition(record.sequence)}>Inspect</button></article>)}</div>
    </section>
  </section>;
}
