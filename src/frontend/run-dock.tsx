import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowsInSimple, ArrowsOutSimple, CaretDown, CaretUp } from "./ds-icons.js";
import type { BudgetPolicyInput, BudgetReplayResult } from "../budget-replay.js";
import { BudgetReplayPanel } from "./budget-replay-panel.js";
import { ClaimCheckPanel } from "./claim-check-panel.js";
import { IconButton, PHONE, useMedia } from "./ds-ui.js";
import { RunDiffPanel } from "./run-diff-panel.js";
import { categoryOf, describeRunEvent, NOTE_LIST_LIMIT, type RunEventCategory, type RunModel } from "./run-replay-model.js";

export type DockTab = "events" | "budget" | "claims" | "compare" | "notes";
type DockSize = "normal" | "collapsed" | "max";

const LIST_RADIUS = 30;
/** On a phone the list starts with this many events around the playhead. */
const PHONE_ROWS = 10;

/** The lower panel: the event chronology, the three tools and the importer notes, as tabs. Every panel stays mounted so its input survives a tab change. */
export function RunDock({
  model,
  position,
  setPosition,
  sourceLabel,
  tab,
  setTab,
  filters,
  budgetInput,
  setBudgetInput,
  budgetErrors,
  budget,
}: {
  model: RunModel;
  position: number;
  setPosition: (value: number) => void;
  sourceLabel: string;
  tab: DockTab;
  setTab: (tab: DockTab) => void;
  filters: RunEventCategory[];
  budgetInput: BudgetPolicyInput;
  setBudgetInput: (value: BudgetPolicyInput) => void;
  budgetErrors: string[];
  budget: BudgetReplayResult | null;
}) {
  const [size, setSize] = useState<DockSize>("normal");
  const tabsRef = useRef<HTMLDivElement>(null);
  const total = model.events.length;
  const breach = budget?.first?.breachEvent ?? null;

  const tabs: Array<{ id: DockTab; label: string; count?: number; flag?: string }> = [
    { id: "events", label: "Events", count: total },
    { id: "budget", label: "Budget replay", flag: breach !== null ? "a limit would have been passed" : undefined },
    { id: "claims", label: "Claim check" },
    { id: "compare", label: "Compare runs" },
    { id: "notes", label: "Importer notes", count: model.notes.length },
  ];

  const select = (id: DockTab) => {
    setTab(id);
    if (size === "collapsed") setSize("normal");
  };
  // A tab chosen from elsewhere (the Compare button in the top bar) also opens a collapsed panel, and every tab opens at its top.
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setSize((now) => (now === "collapsed" ? "normal" : now));
    if (bodyRef.current && tab !== "events") bodyRef.current.scrollTop = 0;
  }, [tab]);

  const onTabKey = (e: React.KeyboardEvent) => {
    const index = tabs.findIndex((t) => t.id === tab);
    const next =
      e.key === "ArrowRight"
        ? index + 1
        : e.key === "ArrowLeft"
          ? index - 1
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? tabs.length - 1
              : null;
    if (next === null) return;
    e.preventDefault();
    const target = tabs[(next + tabs.length) % tabs.length];
    select(target.id);
    tabsRef.current?.querySelector<HTMLButtonElement>(`#rr-tab-${target.id}`)?.focus();
  };

  return (
    <section className={`rr-dock-panel is-${size}`} aria-label="Tools">
      <div className="ds-tabs-row">
        <div className="ds-tabs" role="tablist" aria-label="Tools" ref={tabsRef} onKeyDown={onTabKey}>
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`rr-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`rr-panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              className="ds-tab"
              onClick={() => select(t.id)}
            >
              {t.label}
              {t.count !== undefined && <span className="ds-tab-count">{t.count}</span>}
              {t.flag && (
                <span className="ds-tab-flag">
                  <span className="sr-only">, {t.flag}</span>
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="ds-dock-actions">
          <IconButton
            label={size === "max" ? "Restore the tools panel" : "Enlarge the tools panel"}
            onClick={() => setSize(size === "max" ? "normal" : "max")}
          >
            {size === "max" ? <ArrowsInSimple size={14} /> : <ArrowsOutSimple size={14} />}
          </IconButton>
          <IconButton
            label={size === "collapsed" ? "Show the tools panel" : "Hide the tools panel"}
            aria-expanded={size !== "collapsed"}
            onClick={() => setSize(size === "collapsed" ? "normal" : "collapsed")}
          >
            {size === "collapsed" ? <CaretUp size={14} /> : <CaretDown size={14} />}
          </IconButton>
        </div>
      </div>
      <div className="ds-dock-body" ref={bodyRef}>
        <div role="tabpanel" id="rr-panel-events" aria-labelledby="rr-tab-events" hidden={tab !== "events"} className="ds-tabpanel">
          <Chronology model={model} position={position} setPosition={setPosition} filters={filters} active={tab === "events"} />
        </div>
        <div role="tabpanel" id="rr-panel-budget" aria-labelledby="rr-tab-budget" hidden={tab !== "budget"} className="ds-tabpanel">
          <BudgetReplayPanel
            model={model}
            input={budgetInput}
            setInput={setBudgetInput}
            errors={budgetErrors}
            result={budget}
            position={position}
            setPosition={setPosition}
          />
        </div>
        <div role="tabpanel" id="rr-panel-claims" aria-labelledby="rr-tab-claims" hidden={tab !== "claims"} className="ds-tabpanel">
          <ClaimCheckPanel model={model} setPosition={setPosition} />
        </div>
        <div role="tabpanel" id="rr-panel-compare" aria-labelledby="rr-tab-compare" hidden={tab !== "compare"} className="ds-tabpanel">
          <RunDiffPanel model={model} sourceLabel={sourceLabel} setPosition={setPosition} />
        </div>
        <div role="tabpanel" id="rr-panel-notes" aria-labelledby="rr-tab-notes" hidden={tab !== "notes"} className="ds-tabpanel">
          <Notes model={model} position={position} setPosition={setPosition} />
        </div>
      </div>
    </section>
  );
}

function Chronology({
  model,
  position,
  setPosition,
  filters,
  active,
}: {
  model: RunModel;
  position: number;
  setPosition: (value: number) => void;
  filters: RunEventCategory[];
  active: boolean;
}) {
  const total = model.events.length;
  const listRef = useRef<HTMLOListElement>(null);
  const phone = useMedia(PHONE);
  const [showAll, setShowAll] = useState(false);
  const near = useMemo(() => {
    const lo = Math.max(1, position - LIST_RADIUS * 3);
    const hi = Math.min(total, position + LIST_RADIUS * 3);
    const shown: number[] = [];
    for (let n = lo; n <= hi; n += 1) {
      const category = categoryOf(model.events[n - 1]);
      if (category === "run" || filters.includes(category)) shown.push(n);
    }
    // At most LIST_RADIUS rows each side of the current event, taken from the filtered rows.
    const after = shown.filter((n) => n >= position).slice(0, LIST_RADIUS + 1);
    const before = shown.filter((n) => n < position).slice(-LIST_RADIUS);
    return [...before, ...after];
  }, [model, position, filters, total]);
  // A phone shows the events around the playhead first: four before it, the current one, and five after.
  const rows = useMemo(() => {
    if (!phone || showAll) return near;
    const at = Math.max(
      0,
      near.findIndex((n) => n >= position),
    );
    const from = Math.max(0, Math.min(at - 4, near.length - PHONE_ROWS));
    return near.slice(from, from + PHONE_ROWS);
  }, [near, phone, showAll, position]);
  const wholeRun = near.length === total;

  // Bring the current event into view, a third of the way down, with the row above it whole.
  useEffect(() => {
    if (!active) return;
    const list = listRef.current;
    const scroller = list?.closest<HTMLElement>(".ds-dock-body");
    if (!list || !scroller || scroller.scrollHeight <= scroller.clientHeight) return;
    const current = list.querySelector<HTMLElement>(".ds-event.is-current") ?? list.querySelector<HTMLElement>(".ds-event:not(.is-past)");
    if (!current) return;
    const top = (el: HTMLElement) => el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    const target = top(current) - scroller.clientHeight / 3;
    const first = Array.from(list.querySelectorAll<HTMLElement>(".ds-event")).find((el) => top(el) >= target) ?? current;
    scroller.scrollTop = Math.max(0, top(first) - 8);
  }, [position, active]);

  return (
    <section className="ds-chronology" aria-labelledby="rr-chronology-title">
      <header className="ds-panel-head">
        <h2 id="rr-chronology-title">Event chronology</h2>
        <span className="ds-meta">
          {rows.length} shown near event {position}
        </span>
      </header>
      <ol className="ds-events" ref={listRef}>
        {rows.map((n) => {
          const d = describeRunEvent(model.events[n - 1], model);
          return (
            <li className={`ds-event ${n <= position ? "is-past" : ""} ${n === position ? "is-current" : ""}`} key={n}>
              <button type="button" aria-label={`Inspect event ${n}: ${d.title}`} onClick={() => setPosition(n)}>
                <b className="ds-seq">{n}</b>
                <i className={`ds-dot rr-dot-${d.category}`} aria-hidden="true" />
                <span className="ds-ev-text">
                  <strong>{d.title}</strong>
                  <small>{d.summary.length > 160 ? `${d.summary.slice(0, 160)}…` : d.summary}</small>
                </span>
                <span className="ds-ev-go" aria-hidden="true">
                  Inspect
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {phone && near.length > PHONE_ROWS && (
        <button type="button" className="ds-btn ds-btn-quiet ds-ev-more" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>
          {showAll ? "Show fewer events" : wholeRun ? `Show all ${total} events` : `Show ${near.length} events near this one`}
        </button>
      )}
    </section>
  );
}

function Notes({ model, position, setPosition }: { model: RunModel; position: number; setPosition: (value: number) => void }) {
  return (
    <section className="rr-notes" id="rr-notes" aria-labelledby="rr-notes-title">
      <header className="ds-panel-head">
        <h2 id="rr-notes-title">Importer notes</h2>
        <span className="ds-meta">What the importer changed or could not read while it made this run file.</span>
      </header>
      {model.notes.length === 0 ? (
        <p className="ds-empty">The importer left no notes on this run.</p>
      ) : (
        <>
          {model.notes.length > NOTE_LIST_LIMIT && (
            <p className="rr-hidden-note">
              Showing the first {NOTE_LIST_LIMIT} of {model.notes.length} notes.
            </p>
          )}
          <ul className="rr-note-list">
            {model.notes.slice(0, NOTE_LIST_LIMIT).map((note) => (
              <li key={note.sequence} className={note.sequence <= position ? "seen" : ""}>
                <div>
                  <strong>{note.title}</strong>
                  <span>{note.text}</span>
                </div>
                <button type="button" className="ds-btn ds-btn-quiet" onClick={() => setPosition(note.sequence)}>
                  Go to event {note.sequence}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
