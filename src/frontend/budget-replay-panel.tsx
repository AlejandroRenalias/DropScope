import { useId } from "react";
import type { BudgetPolicyInput, BudgetReplayResult } from "../budget-replay.js";
import { COUNTERFACTUAL_NOTE, LIMIT_LABEL, budgetCaveats, describeBreach, describeRemainder, gaugesAt } from "../budget-report.js";
import type { RunModel } from "./run-replay-model.js";

type FieldKey = keyof BudgetPolicyInput;
const FIELDS: Array<{ key: FieldKey; label: string; hint?: string; mode: "numeric" | "decimal" | "text" }> = [
  { key: "maxTotalTokens", label: "Total tokens", mode: "numeric" },
  { key: "maxInputTokens", label: "Input tokens", mode: "numeric" },
  { key: "maxOutputTokens", label: "Output tokens", mode: "numeric" },
  { key: "maxModelCalls", label: "Model calls", mode: "numeric" },
  { key: "maxToolCalls", label: "Tool calls", mode: "numeric" },
  { key: "maxSteps", label: "Steps", mode: "numeric" },
  { key: "maxSeconds", label: "Time limit (seconds)", mode: "decimal" },
];
const COST_FIELDS: Array<{ key: FieldKey; label: string; mode: "numeric" | "decimal" | "text" }> = [
  { key: "maxCost", label: "Cost limit", mode: "decimal" },
  { key: "inputPrice", label: "Input price per million tokens", mode: "decimal" },
  { key: "outputPrice", label: "Output price per million tokens", mode: "decimal" },
  { key: "currency", label: "Currency", mode: "text" },
];

/** A small example that fits the built-in demo run: it crosses 4,000 tokens during the third model call. */
export const EXAMPLE_BUDGET: BudgetPolicyInput = { maxTotalTokens: "4000" };

export function BudgetReplayPanel({
  model,
  input,
  setInput,
  errors,
  result,
  position,
  setPosition,
}: {
  model: RunModel;
  input: BudgetPolicyInput;
  setInput: (value: BudgetPolicyInput) => void;
  errors: string[];
  result: BudgetReplayResult | null;
  position: number;
  setPosition: (value: number) => void;
}) {
  const uid = useId();
  const titleOf = (stepId: string): string => model.stepsById.get(stepId)?.title ?? "a step";
  const touched = Object.values(input).some((v) => v !== undefined && v.trim() !== "");
  const gauges = result ? gaugesAt(result, position) : [];
  const first = result?.first ?? null;
  const rest = result ? describeRemainder(result, titleOf) : null;
  const update = (key: FieldKey, value: string) => setInput({ ...input, [key]: value });

  const field = (f: { key: FieldKey; label: string; mode: "numeric" | "decimal" | "text" }) => (
    <div className="bp-field" key={f.key}>
      <label htmlFor={`${uid}-${f.key}`}>{f.label}</label>
      <input
        id={`${uid}-${f.key}`}
        type="text"
        inputMode={f.mode}
        autoComplete="off"
        spellCheck={false}
        value={input[f.key] ?? ""}
        onChange={(e) => update(f.key, e.currentTarget.value)}
      />
    </div>
  );

  return (
    <section className="ds-tool bp" id="rr-budget" aria-labelledby={`${uid}-title`}>
      <header className="ds-panel-head">
        <h2 id={`${uid}-title`}>Budget replay</h2>
        <span className="ds-badge is-budget bp-badge">Counterfactual</span>
        <span className="ds-panel-spacer" />
        <div className="bp-actions">
          <button type="button" className="ds-btn ds-btn-quiet" onClick={() => setInput(EXAMPLE_BUDGET)}>
            Try an example (4,000 tokens)
          </button>
          <button type="button" className="ds-btn ds-btn-quiet" onClick={() => setInput({})} disabled={!touched}>
            Clear limits
          </button>
        </div>
      </header>
      <p className="bp-note ds-lede">{COUNTERFACTUAL_NOTE}</p>

      <div className="ds-tool-grid">
        <div className="ds-tool-input">
          <form className="bp-form" onSubmit={(e) => e.preventDefault()} aria-label="Budget limits">
            <div className="bp-grid">{FIELDS.map(field)}</div>
            <details className="bp-cost" open={Boolean(input.maxCost || input.inputPrice || input.outputPrice)}>
              <summary>Add a cost limit (needs your own prices)</summary>
              <div className="bp-grid">{COST_FIELDS.map(field)}</div>
            </details>
          </form>
          {errors.length > 0 && touched && (
            <ul className="bp-errors" role="status" aria-live="polite">
              {errors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          )}
          {input.maxTotalTokens === EXAMPLE_BUDGET.maxTotalTokens && Object.keys(input).length === 1 && (
            <p className="bp-hint">This is the example limit (4,000 total tokens). Change it or clear it to try your own.</p>
          )}
        </div>

        <div className="ds-tool-output">
          {!touched && <p className="bp-hint ds-empty">Type one or more limits to see where a guard would have stopped this run.</p>}
          {result && (
            <>
              <fieldset className="bp-gauges" aria-label="Budget used at this event">
                <legend className="ds-sublabel">Used at event {position}</legend>
                {gauges.map((g) => (
                  <div key={g.limit} className={`bp-gauge ${g.over ? "over" : ""}`}>
                    <div className="bp-gauge-head">
                      <strong>{g.label}</strong>
                      <span>
                        {g.used} of {g.max}
                        {g.over ? " · over the limit" : ""}
                      </span>
                    </div>
                    <div className="bp-bar" role="presentation">
                      <i style={{ width: `${g.percent}%` }} />
                    </div>
                  </div>
                ))}
              </fieldset>

              {first === null ? (
                <p className="bp-result ok" role="status">
                  <strong>No limit would have been exceeded.</strong> The whole recorded run fits inside every limit you set.
                </p>
              ) : (
                <div className="bp-result stop" role="status">
                  <strong className="bp-headline">
                    A guard with these limits would have stopped this run at event {first.breachEvent} of {model.events.length}.
                  </strong>
                  <p>{describeBreach(first, result.policy, model.events, titleOf)}</p>
                  {result.alsoAtSameStop.length > 0 && (
                    <p>Also exceeded at the same point: {result.alsoAtSameStop.map((l) => LIMIT_LABEL[l].toLowerCase()).join(", ")}.</p>
                  )}
                  <button type="button" className="ds-btn ds-btn-quiet" onClick={() => setPosition(first.breachEvent)}>
                    Go to event {first.breachEvent}
                  </button>
                  <div className="bp-after">
                    <span className="ds-sublabel">What would not have happened</span>
                    {rest &&
                      [rest.notStarted, rest.inFlight].map((lines, i) => (
                        <div key={i}>
                          <p>{lines[0]}</p>
                          {lines.length > 1 && (
                            <ul>
                              {lines.slice(1).map((l, n) => (
                                <li key={`${n}-${l}`}>{l}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))}
                    {rest && (
                      <div>
                        <p>Usage recorded after that point:</p>
                        <ul>
                          {rest.tokens.map((l, n) => (
                            <li key={`${n}-${l}`}>{l}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                  {result.breaches.length > 1 && (
                    <ul className="bp-others">
                      {result.breaches.map((b) => (
                        <li key={b.limit}>
                          {LIMIT_LABEL[b.limit]}: exceeded at event {b.breachEvent}
                          {b === first ? " (first)" : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <details className="bp-caveats">
                <summary>What this does and does not tell you</summary>
                <ul>
                  {budgetCaveats(result).map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </details>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
