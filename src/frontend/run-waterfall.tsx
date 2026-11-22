import { useEffect, useMemo, useRef, useState } from "react";
import { ChatCircleText, Circle, Robot, Wrench, XCircle } from "./ds-icons.js";
import type { StepKind } from "../run-events.js";
import { snap, useWidth } from "./run-timeline.js";
import {
  formatDuration,
  formatNumber,
  formatOffset,
  stepSpan,
  stepStatusAt,
  timeTicks,
  visibleSteps,
  type RunModel,
  type StepStatus,
  type StepView,
  type TimeAxis,
} from "./run-replay-model.js";

const STATUS_WORD: Record<StepStatus, string> = {
  "not-started": "Not started",
  running: "Running",
  finished: "Finished",
  failed: "Failed",
};

export function KindIcon({ kind, size = 14 }: { kind: StepKind; size?: number }) {
  if (kind === "AGENT") return <Robot size={size} />;
  if (kind === "LLM_CALL") return <ChatCircleText size={size} />;
  if (kind === "TOOL_CALL") return <Wrench size={size} />;
  return <Circle size={size} />;
}

/** Where the duration label goes so it never sits on its own bar: after it, before it, or (for a bar that spans nearly everything) inside it on a chip. */
function labelSide(left: number, right: number): "after" | "before" | "inside" {
  if (right <= 0.82) return "after";
  if (left >= 0.18) return "before";
  return "inside";
}

export function RunWaterfall({
  model,
  axis,
  position,
  currentStepId,
  onSelect,
}: {
  model: RunModel;
  axis: TimeAxis;
  position: number;
  currentStepId: string | null;
  onSelect: (sequence: number) => void;
}) {
  const tree = useMemo(() => visibleSteps(model, position), [model, position]);
  const [trackRef, trackWidth] = useWidth<HTMLDivElement>();
  const listRef = useRef<HTMLOListElement>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const { step: tickStep, ticks } = useMemo(() => timeTicks(axis.spanNs, 6), [axis]);
  const span = axis.spanNs > 0 ? axis.spanNs : 1;
  const cursor = axis.timeAt[position] / span;
  const cursorX = snap(cursor, trackWidth);
  const rovingId = tree.steps.some((s) => s.stepId === focusId) ? focusId : (currentStepId ?? tree.steps[0]?.stepId ?? null);

  // Keep the step of the current event in view while scrubbing or playing.
  useEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>(".rr-step.current");
    const scroller = list?.closest<HTMLElement>(".ds-wf-body");
    if (!row || !scroller || scroller.scrollHeight <= scroller.clientHeight) return;
    const top = row.offsetTop;
    if (top < scroller.scrollTop + 28 || top > scroller.scrollTop + scroller.clientHeight - 56) {
      scroller.scrollTop = Math.max(0, top - scroller.clientHeight / 3);
    }
  }, [currentStepId]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const index = tree.steps.findIndex((s) => s.stepId === rovingId);
    const last = tree.steps.length - 1;
    const next = e.key === "ArrowDown" ? index + 1 : e.key === "ArrowUp" ? index - 1 : e.key === "Home" ? 0 : e.key === "End" ? last : null;
    if (next === null) return;
    e.preventDefault();
    const step = tree.steps[Math.max(0, Math.min(last, next))];
    if (!step) return;
    setFocusId(step.stepId);
    listRef.current?.querySelector<HTMLButtonElement>(`[data-step="${CSS.escape(step.stepId)}"]`)?.focus();
  };

  const bar = (step: StepView, status: StepStatus) => {
    const { start, end } = stepSpan(step, axis);
    const left = start / span;
    const right = end / span;
    const progress = status === "running" && end > start ? Math.max(0, Math.min(1, (axis.timeAt[position] - start) / (end - start))) : 0;
    const side = labelSide(left, right);
    const duration = formatDuration(step.startNs, step.endEffectiveNs);
    return (
      <span className="ds-wf-track" aria-hidden="true">
        <span className={`ds-wf-bar is-${status}`} style={{ left: `${left * 100}%`, width: `${(right - left) * 100}%` }}>
          {status === "running" && <span className="ds-wf-fill" style={{ width: `${progress * 100}%` }} />}
        </span>
        <span
          className={`ds-wf-dur is-${side}`}
          style={
            side === "after"
              ? { left: `calc(${right * 100}% + 6px)` }
              : side === "before"
                ? { right: `calc(${(1 - left) * 100}% + 6px)` }
                : { right: `calc(${(1 - right) * 100}% + 4px)` }
          }
        >
          {duration}
        </span>
      </span>
    );
  };

  return (
    <section className="rr-waterfall" id="rr-steps" aria-labelledby="rr-steps-title">
      <header className="ds-pane-head">
        <h2 id="rr-steps-title">Trace</h2>
        <span className="ds-meta">
          {model.steps.length} step{model.steps.length === 1 ? "" : "s"} over {model.durationLabel}
        </span>
        {tree.hidden > 0 && (
          <p className="rr-hidden-note">
            Showing {tree.steps.length} steps: those running, failed, active near this event, or finished most recently. {tree.hidden} other
            steps are hidden.
          </p>
        )}
      </header>
      <div className="ds-wf">
        <div className="ds-wf-body">
          <div className="ds-wf-axis" aria-hidden="true">
            <span className="ds-wf-name-head">Step</span>
            <div className="ds-wf-scale" ref={trackRef}>
              {ticks.map((t, i) => (
                <span
                  key={t}
                  className={`ds-wf-tick ${i === 0 ? "is-first" : ""} ${i === ticks.length - 1 && t / span > 0.9 ? "is-last" : ""}`}
                  style={{ left: `${(t / span) * 100}%` }}
                >
                  {formatOffset(t, tickStep)}
                </span>
              ))}
              {trackWidth > 0 && (
                <span className="ds-wf-notch" style={{ transform: `translateX(${cursorX}px)` }}>
                  <span className="ds-notch" />
                </span>
              )}
            </div>
          </div>
          <div className="ds-wf-rows">
            <div className="ds-wf-grid" aria-hidden="true">
              {ticks.map((t) => (
                <i key={t} style={{ left: `${(t / span) * 100}%` }} />
              ))}
              {trackWidth > 0 && <span className="ds-wf-cursor" style={{ transform: `translateX(${cursorX}px)` }} />}
            </div>
            {tree.steps.length === 0 ? (
              <p className="ds-empty">This run has no steps. Its events are in the Events tab.</p>
            ) : (
              <ol className="rr-tree" ref={listRef} onKeyDown={onKeyDown}>
                {tree.steps.map((step) => {
                  const status = stepStatusAt(step, position);
                  const usage = step.usageSequence !== null && step.usageSequence <= position;
                  const tokens = usage
                    ? `, ${step.inputTokens === null ? "?" : formatNumber(step.inputTokens)} input and ${step.outputTokens === null ? "?" : formatNumber(step.outputTokens)} output tokens`
                    : "";
                  return (
                    <li
                      key={step.stepId}
                      data-kind={step.kind}
                      className={`rr-step ${status} ${step.stepId === currentStepId ? "current" : ""}`}
                    >
                      <button
                        type="button"
                        data-step={step.stepId}
                        tabIndex={step.stepId === rovingId ? 0 : -1}
                        onFocus={() => setFocusId(step.stepId)}
                        onClick={() => onSelect(step.startSequence)}
                        aria-label={`Go to the start of ${step.title}. ${STATUS_WORD[status]}.`}
                        title={`${step.title}: ${formatDuration(step.startNs, step.endEffectiveNs)}${tokens}`}
                      >
                        <span className="ds-wf-name" style={{ "--depth": step.depth } as React.CSSProperties}>
                          <span className={`ds-kind is-${step.kind.toLowerCase()}`}>
                            <KindIcon kind={step.kind} />
                          </span>
                          <span className="rr-title">{step.title}</span>
                          <span className={`rr-status ${status}`}>
                            {status === "failed" && <XCircle size={13} />}
                            <span className="rr-status-word">{STATUS_WORD[status]}</span>
                          </span>
                        </span>
                        {bar(step, status)}
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
