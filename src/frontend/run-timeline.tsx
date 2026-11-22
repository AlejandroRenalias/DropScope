import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CaretLeft, CaretRight, Pause, Play, SidebarSimple, SkipBack, SkipForward } from "./ds-icons.js";
import type { RunEvent } from "../run-events.js";
import { IconButton } from "./ds-ui.js";
import { categoryOf, runEventCategories, type RunEventCategory, type RunModel } from "./run-replay-model.js";

const MAX_TICKS = 120;
/** Half the width of the scrubber's thumb: the strip is inset by it so that ticks and thumb share one axis. */
const THUMB_HALF = 7;
/** A whole run plays in about this long, whatever its length. */
const PLAY_MS = 8000;
const FRAME_MS = 40;

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

/** The width of an element, kept up to date. */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** A position on a line of `width` pixels, snapped to the device's pixel grid so a thin line stays sharp. */
export const snap = (fraction: number, width: number): number => {
  const ratio = window.devicePixelRatio || 1;
  return Math.round(Math.max(0, Math.min(1, fraction)) * width * ratio) / ratio;
};

export function RunTimeline({
  model,
  position,
  setPosition,
  title,
  changes,
  filters,
  setFilters,
  breachEvent,
  showInspectorToggle,
  inspectorOpen,
  setInspectorOpen,
}: {
  model: RunModel;
  position: number;
  setPosition: (value: number) => void;
  title: string;
  changes: string[];
  filters: RunEventCategory[];
  setFilters: React.Dispatch<React.SetStateAction<RunEventCategory[]>>;
  breachEvent: number | null;
  showInspectorToggle: boolean;
  inspectorOpen: boolean;
  setInspectorOpen: (open: boolean) => void;
}) {
  const total = model.events.length;
  const buckets = useMemo(() => buildBuckets(model.events), [model]);
  const ticksRef = useRef<HTMLFieldSetElement>(null);
  const [trackRef, trackWidth] = useWidth<HTMLDivElement>();
  const [playing, setPlaying] = useState(false);
  const positionRef = useRef(position);
  positionRef.current = position;
  const numberEvery = Math.max(1, Math.ceil(buckets.length / 12));
  const currentBucket = buckets.findIndex((b) => position >= b.from && position <= b.to);
  const fraction = total > 1 ? (position - 1) / (total - 1) : 1;
  const usable = Math.max(0, trackWidth - 2 * THUMB_HALF);
  const playheadX = THUMB_HALF + snap(fraction, usable);

  // Playback: a whole run in about eight seconds, in steps of one event or more.
  useEffect(() => {
    if (!playing) return;
    const frame = Math.max(FRAME_MS, PLAY_MS / total);
    const stride = Math.max(1, Math.round((total * frame) / PLAY_MS));
    const timer = window.setInterval(() => {
      const next = Math.min(total, positionRef.current + stride);
      setPosition(next);
      if (next >= total) setPlaying(false);
    }, frame);
    return () => window.clearInterval(timer);
  }, [playing, total, setPosition]);
  // A new run stops the playback.
  useEffect(() => setPlaying(false), [model]);

  const togglePlay = () => {
    if (!playing && positionRef.current >= total) setPosition(1);
    setPlaying((now) => !now);
  };

  const moveTo = (target: number, focusTick = true) => {
    const next = Math.max(1, Math.min(target, total));
    setPosition(next);
    if (!focusTick) return;
    requestAnimationFrame(() => {
      const index = buckets.findIndex((b) => next >= b.from && next <= b.to);
      ticksRef.current?.querySelector<HTMLButtonElement>(`[data-bucket="${index}"]`)?.focus();
    });
  };
  const keyTarget = (key: string): number | null =>
    key === "ArrowRight" || key === "ArrowUp"
      ? positionRef.current + 1
      : key === "ArrowLeft" || key === "ArrowDown"
        ? positionRef.current - 1
        : key === "Home"
          ? 1
          : key === "End"
            ? total
            : null;
  const onTickKey = (keyEvent: React.KeyboardEvent) => {
    const target = keyTarget(keyEvent.key);
    if (target === null) return;
    keyEvent.preventDefault();
    moveTo(target);
  };

  // Shortcuts when nothing in particular has the focus: arrows step, Home and End jump, Space plays.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const free = !target || target === document.body || target.id === "rr-timeline";
      if (!free || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === " ") {
        e.preventDefault();
        togglePlay();
        return;
      }
      const next = keyTarget(e.key === "ArrowUp" || e.key === "ArrowDown" ? "" : e.key);
      if (next === null) return;
      e.preventDefault();
      moveTo(next, false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const toggle = (category: RunEventCategory) =>
    setFilters((now) => (now.includes(category) ? now.filter((c) => c !== category) : [...now, category]));
  const announcement = `Event ${position} of ${total}: ${title}. ${changes.length ? changes.join(". ") : "No visible change to the recorded state."}`;

  return (
    <section className="rr-timeline" id="rr-timeline" tabIndex={-1} aria-labelledby="rr-timeline-title">
      <h2 className="sr-only" id="rr-timeline-title">
        Timeline
      </h2>
      <div className="ds-tl-bar">
        <div className="ds-transport">
          <IconButton label="First event" shortcut="Home" onClick={() => moveTo(1, false)} disabled={position <= 1}>
            <SkipBack size={14} />
          </IconButton>
          <IconButton label="Previous event" shortcut="←" onClick={() => moveTo(position - 1, false)} disabled={position <= 1}>
            <CaretLeft size={14} />
          </IconButton>
          <IconButton
            label={playing ? "Pause" : "Play the run"}
            shortcut="Space"
            className="ds-play"
            aria-pressed={playing}
            onClick={togglePlay}
          >
            {playing ? <Pause size={14} /> : <Play size={14} />}
          </IconButton>
          <IconButton label="Next event" shortcut="→" onClick={() => moveTo(position + 1, false)} disabled={position >= total}>
            <CaretRight size={14} />
          </IconButton>
          <IconButton label="Last event" shortcut="End" onClick={() => moveTo(total, false)} disabled={position >= total}>
            <SkipForward size={14} />
          </IconButton>
        </div>
        <strong className="replay-position">
          Event {position} / {total}
        </strong>
        <span className="ds-tl-title">{title}</span>
        <span className="ds-tl-spacer" />
        {breachEvent !== null && (
          <p className="rr-breach-legend">
            <i aria-hidden="true" /> Budget limit passed at event {breachEvent}
          </p>
        )}
        <fieldset className="ds-cats" aria-label="Event category filters">
          {runEventCategories.map((c) => (
            <button
              type="button"
              key={c.id}
              className={`ds-cat ${filters.includes(c.id) ? "on" : ""}`}
              aria-pressed={filters.includes(c.id)}
              onClick={() => toggle(c.id)}
            >
              <i className={`ds-dot rr-dot-${c.id}`} aria-hidden="true" />
              {c.label}
            </button>
          ))}
        </fieldset>
        {showInspectorToggle && (
          <button
            type="button"
            className="ds-btn ds-btn-quiet ds-inspector-toggle"
            aria-expanded={inspectorOpen}
            aria-controls="rr-inspector"
            onClick={() => setInspectorOpen(!inspectorOpen)}
          >
            <SidebarSimple size={15} style={{ transform: "scaleX(-1)" }} />
            Inspector
          </button>
        )}
      </div>

      <div className="ds-strip" ref={trackRef}>
        <div className="ds-strip-ticks" style={{ paddingInline: THUMB_HALF }}>
          <fieldset
            className="rr-ticks"
            aria-label="Recorded events"
            ref={ticksRef}
            onKeyDown={onTickKey}
            style={{ marginInline: buckets.length > 1 ? `calc(-50% / ${buckets.length - 1})` : 0 }}
          >
            {buckets.map((bucket, index) => {
              const isCurrent = index === currentBucket;
              const label = bucket.from === bucket.to ? `Event ${bucket.from}` : `Events ${bucket.from} to ${bucket.to}`;
              const dim = bucket.category !== "run" && !filters.includes(bucket.category);
              const breachHere = breachEvent !== null && breachEvent >= bucket.from && breachEvent <= bucket.to;
              return (
                <button
                  type="button"
                  key={bucket.from}
                  data-bucket={index}
                  className={`tick rr-${bucket.failed ? "failed" : bucket.category} ${bucket.to <= position ? "past" : "future"} ${isCurrent ? "cur" : ""} ${dim ? "dim" : ""} ${breachHere ? "rr-breach" : ""}`}
                  tabIndex={isCurrent ? 0 : -1}
                  aria-label={`${label}, ${bucket.failed ? "a step failed" : bucket.category}${breachHere ? ", where your budget limit would have been passed" : ""}`}
                  aria-current={isCurrent ? "step" : undefined}
                  onClick={() => setPosition(bucket.to)}
                >
                  <i aria-hidden="true" />
                  {(index === 0 ||
                    index === buckets.length - 1 ||
                    (index % numberEvery === 0 && buckets.length - 1 - index >= Math.ceil(numberEvery / 2))) && (
                    <span className="num" aria-hidden="true">
                      {bucket.from}
                    </span>
                  )}
                </button>
              );
            })}
          </fieldset>
        </div>
        <label className="sr-only" htmlFor="rr-position">
          Timeline position
        </label>
        <input
          id="rr-position"
          className="ds-scrubber"
          type="range"
          min="1"
          max={total}
          value={position}
          aria-valuetext={`Event ${position} of ${total}, ${title}`}
          style={{ "--fill": `${playheadX}px` } as React.CSSProperties}
          onChange={(e) => setPosition(Number(e.currentTarget.value))}
        />
        {trackWidth > 0 && (
          <div className="ds-playhead" style={{ transform: `translateX(${playheadX}px)` }} aria-hidden="true">
            <span className="ds-notch" />
          </div>
        )}
      </div>
      <p className="sr-only" aria-live={playing ? "off" : "polite"} aria-atomic="true">
        {announcement}
      </p>
    </section>
  );
}
