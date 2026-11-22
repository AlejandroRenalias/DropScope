import { useEffect, useMemo, useState } from "react";
import { Info } from "./ds-icons.js";
import { Popover } from "@radix-ui/themes";
import { parseBudgetPolicy, replayBudget, type BudgetPolicyInput } from "../budget-replay.js";
import { EXAMPLE_BUDGET } from "./budget-replay-panel.js";
import { RunDock, type DockTab } from "./run-dock.js";
import { RunInspector } from "./run-inspector.js";
import { RunTimeline } from "./run-timeline.js";
import { RunWaterfall } from "./run-waterfall.js";
import {
  buildTimeAxis,
  describeRunEvent,
  describeStateChange,
  eventStepId,
  formatNumber,
  runEventCategories,
  type RunEventCategory,
  type RunModel,
} from "./run-replay-model.js";

export type { DockTab };

/** Below this width the inspector is a drawer; the CSS uses the same breakpoints. */
const DRAWER_FROM = 760;
const DRAWER_UNTIL = 1279;

function useDrawerLayout(): boolean {
  const query = `(min-width: ${DRAWER_FROM}px) and (max-width: ${DRAWER_UNTIL}px)`;
  const [match, setMatch] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const list = window.matchMedia?.(query);
    if (!list) return;
    const sync = () => setMatch(list.matches);
    sync();
    list.addEventListener("change", sync);
    return () => list.removeEventListener("change", sync);
  }, [query]);
  return match;
}

export function RunReplay({
  model,
  position,
  setPosition,
  sourceLabel,
  tab,
  setTab,
}: {
  model: RunModel;
  position: number;
  setPosition: (value: number) => void;
  sourceLabel: string;
  tab: DockTab;
  setTab: (tab: DockTab) => void;
}) {
  const total = model.events.length;
  const bounded = Math.max(1, Math.min(position, total));
  const [filters, setFilters] = useState<RunEventCategory[]>(runEventCategories.map((c) => c.id));
  const [budgetInput, setBudgetInput] = useState<BudgetPolicyInput>(EXAMPLE_BUDGET);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawer = useDrawerLayout();

  const axis = useMemo(() => buildTimeAxis(model), [model]);
  const parsedBudget = useMemo(() => parseBudgetPolicy(budgetInput), [budgetInput]);
  const budget = useMemo(() => (parsedBudget.policy ? replayBudget(model.events, parsedBudget.policy) : null), [parsedBudget, model]);
  const breachEvent = budget?.first?.breachEvent ?? null;
  const state = useMemo(() => model.replay.stateAt(bounded), [model, bounded]);
  const previous = useMemo(() => (bounded > 1 ? model.replay.stateAt(bounded - 1) : null), [model, bounded]);
  const event = model.events[bounded - 1];
  const description = describeRunEvent(event, model);
  const changes = describeStateChange(previous, state);
  const currentStepId = eventStepId(event);
  const notesSoFar = model.notes.filter((note) => note.sequence <= bounded).length;
  const contentCount = Object.values(state.content).reduce((a, b) => a + b, 0);
  const stored = model.contentMode === "FULL";
  const finished = state.closedStepIds.length - state.errorStepIds.length;

  // Selecting a step on a narrow screen opens the inspector drawer, so the selection is never invisible.
  const selectStep = (sequence: number) => {
    setPosition(sequence);
    if (drawer) setDrawerOpen(true);
  };

  return (
    <section className="run-replay ds-workspace" aria-label="Agent run replay" data-drawer={drawer && drawerOpen ? "open" : "closed"}>
      <header className="ds-runbar">
        <div className="ds-runmeta">
          <h1 className="ds-run-title">
            Run <code title={model.runId}>{model.runId.slice(0, 8)}</code>
          </h1>
          <span className="ds-meta">{model.durationLabel}</span>
          <span className="ds-meta">
            {model.steps.length} step{model.steps.length === 1 ? "" : "s"}
          </span>
          <span className="ds-badge is-neutral">Recorded replay</span>
          <span className={`ds-badge ${stored ? "is-mapped" : "is-neutral"}`}>{stored ? "Content stored" : "Content withheld"}</span>
          <Popover.Root>
            <Popover.Trigger>
              <button type="button" className="ds-icon-btn ds-about" aria-label="About this replay">
                <Info size={15} />
              </button>
            </Popover.Trigger>
            <Popover.Content className="ds-popover" align="start" sideOffset={6} maxWidth="360px">
              <p className="ds-pop-title">About this replay</p>
              <p>
                This shows what the trace says happened; nothing is re-run. Steps are ordered by their recorded times (a derived order).
                Filters change the view only; the recording never changes.
              </p>
              <p>
                Content is {stored ? "stored as written in this file" : "withheld: only sizes and fingerprints were kept"}. Imported by{" "}
                {model.importer}.
              </p>
            </Popover.Content>
          </Popover.Root>
        </div>
        <section className="rr-stats" aria-label="Recorded state at this event">
          <div className="ds-stat">
            <span className="ds-stat-label">Tokens</span>
            <span className="ds-stat-value">
              <b>{formatNumber(state.inputTokens)}</b> input <b>{formatNumber(state.outputTokens)}</b> output
            </span>
          </div>
          <div className="ds-stat">
            <span className="ds-stat-label">Steps</span>
            <span className="ds-stat-value">
              <b>{state.openStepIds.length}</b> running <b>{finished}</b> finished{" "}
              <b className={state.errorStepIds.length ? "is-bad" : ""}>{state.errorStepIds.length}</b> failed{" "}
              <span className="ds-of">of {model.steps.length}</span>
            </span>
          </div>
          <div className="ds-stat">
            <span className="ds-stat-label">Content</span>
            <span className="ds-stat-value">
              <b>{contentCount}</b> {stored ? "stored" : "withheld"} <b>{state.logCount}</b> log{state.logCount === 1 ? "" : "s"}
            </span>
          </div>
          <div className="ds-stat">
            <span className="ds-stat-label">Notes</span>
            <span className="ds-stat-value">
              <b>{notesSoFar}</b> so far <span className="ds-of">of {model.notes.length}</span>
            </span>
          </div>
        </section>
      </header>

      <RunTimeline
        model={model}
        position={bounded}
        setPosition={setPosition}
        title={description.title}
        changes={changes}
        filters={filters}
        setFilters={setFilters}
        breachEvent={breachEvent}
        showInspectorToggle={drawer}
        inspectorOpen={drawerOpen}
        setInspectorOpen={setDrawerOpen}
      />

      <div className="ds-panes">
        <div className="ds-center">
          <RunWaterfall model={model} axis={axis} position={bounded} currentStepId={currentStepId} onSelect={selectStep} />
          <RunDock
            model={model}
            position={bounded}
            setPosition={setPosition}
            sourceLabel={sourceLabel}
            tab={tab}
            setTab={setTab}
            filters={filters}
            budgetInput={budgetInput}
            setBudgetInput={setBudgetInput}
            budgetErrors={parsedBudget.errors}
            budget={budget}
          />
        </div>
        <RunInspector
          model={model}
          axis={axis}
          position={bounded}
          setPosition={setPosition}
          description={description}
          changes={changes}
          stepId={currentStepId}
          drawer={drawer}
          onClose={() => setDrawerOpen(false)}
        />
      </div>
    </section>
  );
}
