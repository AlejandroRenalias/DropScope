import { useEffect, useMemo, useRef } from "react";
import { Fingerprint, X } from "./ds-icons.js";
import { IconButton } from "./ds-ui.js";
import { KindIcon } from "./run-waterfall.js";
import {
  contentByStep,
  describeContent,
  formatDuration,
  formatNumber,
  formatOffset,
  kindLabel,
  kindSourceOf,
  runEventCategories,
  stepSpan,
  stepStatusAt,
  usageSourceOf,
  type EventDescription,
  type RunModel,
  type StepStatus,
  type TimeAxis,
} from "./run-replay-model.js";

const STATUS_WORD: Record<StepStatus, string> = {
  "not-started": "Not started yet",
  running: "Running",
  finished: "Finished",
  failed: "Failed",
};

/** The inspector: the event under the playhead, the step it belongs to, that step's recorded content and notes, and the raw event. */
export function RunInspector({
  model,
  axis,
  position,
  setPosition,
  description,
  changes,
  stepId,
  drawer,
  onClose,
}: {
  model: RunModel;
  axis: TimeAxis;
  position: number;
  setPosition: (value: number) => void;
  description: EventDescription;
  changes: string[];
  stepId: string | null;
  drawer: boolean;
  onClose: () => void;
}) {
  const event = model.events[position - 1];
  const step = stepId === null ? null : (model.stepsById.get(stepId) ?? null);
  const content = useMemo(() => contentByStep(model.events), [model]);
  const closeRef = useRef<HTMLButtonElement>(null);
  const category = description.category === "run" ? "Run" : runEventCategories.find((c) => c.id === description.category)?.label;

  // Escape closes the drawer.
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer, onClose]);

  const status = step ? stepStatusAt(step, position) : null;
  const span = step ? stepSpan(step, axis) : null;
  const parent = step?.parentStepId ? model.stepsById.get(step.parentStepId) : null;
  const kindSource = step ? kindSourceOf(model.events[step.startSequence - 1]) : null;
  const usageSource = step?.usageSequence ? usageSourceOf(model.events[step.usageSequence - 1]) : [];
  const recorded = step ? (content.get(step.stepId) ?? []).filter((n) => n <= position) : [];
  const later = step ? (content.get(step.stepId) ?? []).length - recorded.length : 0;
  const notes = step ? model.notes.filter((n) => n.stepId === step.stepId) : [];
  const usage = step && step.usageSequence !== null && step.usageSequence <= position;

  return (
    <aside className="rr-inspector event-card" id="rr-inspector" aria-labelledby="rr-event-title">
      <header className="ds-ins-head">
        <div className="ds-ins-kicker">
          <span className="ds-seq">#{position}</span>
          <span className={`ds-badge is-cat is-${description.category}`}>{category}</span>
          <span className="ds-meta">at {formatOffset(axis.timeAt[position], axis.spanNs / 6)}</span>
          {drawer && (
            <IconButton ref={closeRef} label="Close the inspector" className="ds-ins-close" onClick={onClose}>
              <X size={14} />
            </IconButton>
          )}
        </div>
        <h2 id="rr-event-title">{description.title}</h2>
        <p className="event-summary">{description.summary}</p>
      </header>

      <section className="ds-ins-section" aria-labelledby="rr-changes-title">
        <h3 id="rr-changes-title">What changed</h3>
        <ul className="deltas">
          {changes.length ? (
            changes.map((line) => {
              const [label, value] = line.split(": ");
              return (
                <li key={line}>
                  <span>
                    {label}
                    <span className="sr-only">: </span>
                  </span>
                  <code>{value}</code>
                </li>
              );
            })
          ) : (
            <li className="none">No visible change to the recorded state. The event is kept in the history.</li>
          )}
        </ul>
      </section>

      {!step && (
        <section className="ds-ins-section" aria-labelledby="rr-run-title">
          <h3 id="rr-run-title">Run</h3>
          <dl className="ds-attrs">
            <dt>Run id</dt>
            <dd>
              <code className="ds-id">{model.runId}</code>
            </dd>
            <dt>Duration</dt>
            <dd>
              <code>{model.durationLabel}</code>
            </dd>
            <dt>Steps</dt>
            <dd>
              <code>{model.steps.length}</code>
              {model.steps.some((s) => s.failed) && (
                <span className="ds-status is-failed">{model.steps.filter((s) => s.failed).length} failed</span>
              )}
            </dd>
            <dt>Events</dt>
            <dd>
              <code>{model.events.length}</code>
            </dd>
            <dt>Content</dt>
            <dd>{model.contentMode === "FULL" ? "Stored as written" : "Withheld, sizes and fingerprints only"}</dd>
            <dt>Importer</dt>
            <dd>
              <code>{model.importer}</code>
            </dd>
          </dl>
        </section>
      )}

      {step && status && span && (
        <section className="ds-ins-section" aria-labelledby="rr-step-title">
          <h3 id="rr-step-title">Step</h3>
          <div className={`ds-ins-step is-${status}`}>
            <span className={`ds-kind is-${step.kind.toLowerCase()}`}>
              <KindIcon kind={step.kind} size={15} />
            </span>
            <strong>{step.title}</strong>
          </div>
          <dl className="ds-attrs">
            <dt>Kind</dt>
            <dd>
              {kindLabel(step.kind)}
              {kindSource && !kindSource.standard && (
                <span className="ds-badge is-mapped" title={`Read from ${kindSource.source}, a name other tools use`}>
                  Mapped
                </span>
              )}
            </dd>
            {kindSource && !kindSource.standard && (
              <>
                <dt>Type source</dt>
                <dd>
                  <code>{kindSource.source}</code>
                </dd>
              </>
            )}
            <dt>At this event</dt>
            <dd>
              <span className={`ds-status is-${status}`}>{STATUS_WORD[status]}</span>
            </dd>
            <dt>Outcome</dt>
            <dd>
              {step.failed ? (
                <span className="ds-status is-failed">Failed</span>
              ) : step.endSequence < model.events.length ? (
                "Finished"
              ) : (
                "No end recorded"
              )}
            </dd>
            <dt>Events</dt>
            <dd>
              <code>
                {step.startSequence} to {step.endSequence}
              </code>
            </dd>
            <dt>Time</dt>
            <dd>
              <code>
                {formatOffset(span.start, axis.spanNs / 6)} to {formatOffset(span.end, axis.spanNs / 6)}
              </code>
            </dd>
            <dt>Duration</dt>
            <dd>
              <code>{formatDuration(step.startNs, step.endEffectiveNs)}</code>
            </dd>
            {step.usageSequence !== null && (
              <>
                <dt>Tokens</dt>
                <dd>
                  {usage ? (
                    <code>
                      {step.inputTokens === null ? "?" : formatNumber(step.inputTokens)} in,{" "}
                      {step.outputTokens === null ? "?" : formatNumber(step.outputTokens)} out
                    </code>
                  ) : (
                    <span className="ds-dim">Recorded at event {step.usageSequence}</span>
                  )}
                  {usageSource.length > 0 && (
                    <span className="ds-badge is-mapped" title={`Read from ${usageSource.join(" and ")}, names other tools use`}>
                      Mapped
                    </span>
                  )}
                </dd>
              </>
            )}
            {parent && (
              <>
                <dt>Parent</dt>
                <dd>{parent.title}</dd>
              </>
            )}
            <dt>Step id</dt>
            <dd>
              <code className="ds-id">{step.stepId}</code>
            </dd>
          </dl>
          <div className="ds-ins-actions">
            <button
              type="button"
              className="ds-btn ds-btn-quiet"
              onClick={() => setPosition(step.startSequence)}
              disabled={position === step.startSequence}
            >
              Go to its start
            </button>
            <button
              type="button"
              className="ds-btn ds-btn-quiet"
              onClick={() => setPosition(step.endSequence)}
              disabled={position === step.endSequence}
            >
              Go to its end
            </button>
          </div>
        </section>
      )}

      {step && (recorded.length > 0 || later > 0) && (
        <section className="ds-ins-section" aria-labelledby="rr-content-title">
          <h3 id="rr-content-title">Content</h3>
          <ul className="ds-content">
            {recorded.map((n) => {
              const e = model.events[n - 1];
              if (e.type !== "ContentRecorded") return null;
              const shown = describeContent(e);
              return (
                <li key={n} className={n === position ? "is-current" : ""}>
                  <div className="ds-content-head">
                    <span>{shown.label}</span>
                    <button
                      type="button"
                      className="ds-link"
                      onClick={() => setPosition(n)}
                      aria-label={`Go to event ${n}: ${shown.label}`}
                    >
                      #{n}
                    </button>
                  </div>
                  {shown.withheld ? (
                    <div className="ds-withheld">
                      <span className="ds-badge is-neutral">Withheld</span>
                      <code>{shown.withheld.size}</code>
                      <span className="ds-fp" title="Fingerprint: the first 8 characters of the content's SHA-256 hash">
                        <Fingerprint size={13} />
                        <code>{shown.withheld.fingerprint}</code>
                      </span>
                    </div>
                  ) : (
                    <pre className="ds-preview">{shown.text}</pre>
                  )}
                </li>
              );
            })}
          </ul>
          {later > 0 && (
            <p className="ds-dim">
              {later} more item{later === 1 ? "" : "s"} recorded later in this step.
            </p>
          )}
        </section>
      )}

      {notes.length > 0 && (
        <section className="ds-ins-section" aria-labelledby="rr-step-notes-title">
          <h3 id="rr-step-notes-title">Importer notes on this step</h3>
          <ul className="ds-ins-notes">
            {notes.map((note) => (
              <li key={note.sequence}>
                <strong>{note.title}</strong>
                <span>{note.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="ds-ins-section">
        <details className="ds-raw">
          <summary>Show raw event</summary>
          <pre>{JSON.stringify(event.payload, null, 2)}</pre>
        </details>
      </section>
    </aside>
  );
}
