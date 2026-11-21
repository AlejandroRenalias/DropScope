// Pure logic behind the run replay screen: turns a validated run-event history into steps, a step tree and
// plain-language descriptions. No React and no Node modules, so it runs in the browser and in tests.
//
// It only reads a history that the reducer has already validated (createReplay). It never invents data: a
// value the importer withheld is shown as withheld, with its size and a short fingerprint.
import { createReplay } from "../run-reducer.js";
import { parseRunLog } from "../run-log-format.js";
export const runEventCategories = [
    { id: "step", label: "Steps" },
    { id: "tokens", label: "Tokens" },
    { id: "content", label: "Content" },
    { id: "log", label: "Logs" },
    { id: "note", label: "Notes" },
];
const KIND_LABEL = { LLM_CALL: "Model call", TOOL_CALL: "Tool call", AGENT: "Agent", OTHER: "Step" };
export const kindLabel = (kind) => KIND_LABEL[kind];
const CONTENT_LABEL = {
    "gen_ai.input.messages": "Model input",
    "gen_ai.output.messages": "Model output",
    "gen_ai.system_instructions": "System instructions",
    "gen_ai.tool.call.arguments": "Tool arguments",
    "gen_ai.tool.call.result": "Tool result",
    "gen_ai.other": "Other content",
};
export function formatBytes(n) {
    if (n < 1024)
        return `${n} byte${n === 1 ? "" : "s"}`;
    if (n < 1024 * 1024)
        return `${(n / 1024).toFixed(1)} KiB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
}
export function formatDuration(startNs, endNs) {
    const ms = Number((BigInt(endNs) - BigInt(startNs)) / 1000000n);
    if (ms < 1000)
        return `${ms} ms`;
    return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}
export function formatNumber(decimal) {
    return decimal.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
function tagged(value) {
    if (value.t === "s")
        return value.v;
    if (value.t === "i" || value.t === "d" || value.t === "o")
        return String(value.v);
    return JSON.stringify(value.v);
}
/** How a Field reads in the UI: the value itself when verbatim, or "withheld" with its size and fingerprint. */
export function describeField(field, limit = 400) {
    if ("w" in field)
        return { withheld: true, text: `withheld (${formatBytes(field.w.n)}, fingerprint ${field.w.h.slice(0, 8)})` };
    const text = tagged(field.v);
    return { withheld: false, text: text.length > limit ? `${text.slice(0, limit)}… (${formatBytes(text.length)} in all)` : text };
}
function verbatimAttribute(attributes, key) {
    for (const a of attributes) {
        if ("v" in a.key && a.key.v.t === "s" && a.key.v.v === key && "v" in a.value && a.value.v.t === "s")
            return a.value.v.v;
    }
    return null;
}
/** A name from a trace, made safe to show on one line: no control characters, at most 80 characters. */
function tidy(text) {
    const flat = text.replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim();
    return flat.length > 80 ? `${flat.slice(0, 80)}…` : flat;
}
/** A readable name for a step from structural data only: tool name, agent name, or operation and model. */
function stepTitle(kind, label, attributes) {
    const tool = verbatimAttribute(attributes, "gen_ai.tool.name");
    const agent = verbatimAttribute(attributes, "gen_ai.agent.name");
    if (kind === "TOOL_CALL" && tool)
        return `${KIND_LABEL[kind]}: ${tidy(tool)}`;
    if (kind === "AGENT" && agent)
        return `${KIND_LABEL[kind]}: ${tidy(agent)}`;
    const rest = tidy(label.startsWith(kind) ? label.slice(kind.length).trim() : label);
    return rest ? `${KIND_LABEL[kind]}: ${rest}` : KIND_LABEL[kind];
}
const NOTE_TEXT = {
    OTHER_TRACE_EXCLUDED: (d) => `Left out ${d.spans} span(s) and ${d.logs} log(s) that belong to other traces.`,
    DUPLICATE_SPAN_COLLAPSED: (d) => `Merged ${d.count} identical duplicate span(s).`,
    DUPLICATE_LOG_COLLAPSED: (d) => `Merged ${d.count} identical duplicate log record(s).`,
    MISSING_PARENT: () => "This step names a parent that is not in the trace, so it is shown as a top-level step.",
    PARENT_CYCLE_BROKEN: () => "Parent links formed a loop; one link was cut to keep a tree.",
    CHILD_OUTSIDE_PARENT_INTERVAL: () => "This step runs outside its parent's time window (clocks may differ between machines).",
    NEGATIVE_DURATION_CLAMPED: () => "This step's end time was before its start; its end was set to its start.",
    UNFINISHED_SPAN_CLOSED: () => "This step has no end time. It is shown as ending when the run's last recorded activity ended; that is a guess, not an observation.",
    ORPHAN_LOG_RECORD: (d) => `Log record ${d.logOrdinal} could not be matched to any step.`,
    UNKNOWN_FIELD: (d) => `${d.count} field(s) the importer does not know were kept as they were.`,
    UNRECOGNIZED_OPERATION: () => "This step names an operation the importer does not recognise, so it is shown as a plain step.",
    CONTENT_ABSENT: () => "No prompt, answer or tool data was recorded for this step.",
    USAGE_NOT_SUMMED: (d) => `${d.count} token count(s) on a ${d.scope === "log" ? "log record" : "non-model step"} were not added to the totals.`,
    UNUSABLE_USAGE: (d) => `${d.count} token count(s) were unusable (negative, fractional, wrong type or contradicting) and were not counted.`,
    ENUM_NAME_ACCEPTED: (d) => `${d.count} value(s) in the ${d.role} file were written as names and accepted.`,
    SCHEMA_URL_ABSENT: () => "The trace does not say which convention version it follows.",
    SCHEMA_URL_MISMATCH: () => "The trace follows a different convention version than the importer expects.",
    WITHHELD_ATTRIBUTE: (d) => `${d.count} attribute(s) were withheld (${formatBytes(Number(d.bytes))} in all); only fingerprints were kept.`,
    SECRET_PATTERN_COUNT: (d, mode) => `Secret-like text was found in content (${Object.entries(d).map(([k, v]) => `${k}: ${v}`).join(", ")}). ${mode === "HASH_ONLY" ? "The text itself was not kept."
        : mode === "FULL" ? "This run stores content, so the text itself was kept in the run file."
            : "Whether the text itself was kept depends on the run's content mode."}`,
};
/** The plain-language sentence for an importer note. */
export function describeNote(code, detail, mode) {
    return NOTE_TEXT[code]?.(detail, mode) ?? humanize(code);
}
function humanize(code) {
    const words = code.toLowerCase().split("_").join(" ");
    return words.charAt(0).toUpperCase() + words.slice(1);
}
/** Events whose position in the timeline belongs to one step. */
export function eventStepId(event) {
    switch (event.type) {
        case "StepStarted":
        case "StepEnded":
        case "UsageRecorded": return event.payload.stepId;
        case "ContentRecorded": return event.payload.stepId;
        case "LogRecorded": return event.payload.stepId;
        case "ImportNote": return event.payload.stepId;
        default: return null;
    }
}
export function stepStatusAt(step, position) {
    if (position < step.startSequence)
        return "not-started";
    if (position < step.endSequence)
        return "running";
    return step.failed ? "failed" : "finished";
}
export function buildRunModel(history) {
    const replay = createReplay(history);
    const events = replay.events;
    const header = events[0];
    if (header.type !== "RunStarted")
        throw new Error("History does not start with RunStarted.");
    const byId = new Map();
    const started = new Map();
    for (const event of events) {
        if (event.type === "StepStarted") {
            const p = event.payload;
            started.set(p.stepId, p);
            byId.set(p.stepId, {
                stepId: p.stepId, parentStepId: p.parentStepId, depth: 0, kind: p.kind, title: stepTitle(p.kind, p.label, p.attributes),
                startSequence: event.sequenceNumber, endSequence: events.length, failed: false, startNs: p.startNs, endEffectiveNs: p.startNs,
                inputTokens: null, outputTokens: null, usageSequence: null,
            });
        }
        else if (event.type === "StepEnded") {
            const step = byId.get(event.payload.stepId);
            step.endSequence = event.sequenceNumber;
            step.failed = event.payload.statusCode === 2;
            step.endEffectiveNs = event.payload.endEffectiveNs;
        }
        else if (event.type === "UsageRecorded") {
            const step = byId.get(event.payload.stepId);
            step.inputTokens = event.payload.inputTokens;
            step.outputTokens = event.payload.outputTokens;
            step.usageSequence = event.sequenceNumber;
        }
    }
    // Tree order and depth, iteratively. A parent cycle (only possible in a hand-edited file) cannot loop: steps not
    // reachable from a top-level step are appended afterwards as top-level steps.
    const children = new Map();
    for (const step of byId.values()) {
        const parent = step.parentStepId !== null && byId.has(step.parentStepId) ? step.parentStepId : null;
        const list = children.get(parent) ?? [];
        list.push(step);
        children.set(parent, list);
    }
    for (const list of children.values())
        list.sort((a, b) => a.startSequence - b.startSequence);
    const ordered = [];
    const seen = new Set();
    const walk = (roots, rootDepth) => {
        const stack = [...roots].reverse().map((step) => ({ step, depth: rootDepth }));
        while (stack.length > 0) {
            const { step, depth } = stack.pop();
            if (seen.has(step.stepId))
                continue;
            seen.add(step.stepId);
            step.depth = Math.min(depth, 12);
            ordered.push(step);
            const kids = children.get(step.stepId) ?? [];
            for (let i = kids.length - 1; i >= 0; i -= 1)
                stack.push({ step: kids[i], depth: depth + 1 });
        }
    };
    walk(children.get(null) ?? [], 0);
    const leftovers = [...byId.values()].filter((s) => !seen.has(s.stepId)).sort((a, b) => a.startSequence - b.startSequence);
    walk(leftovers, 0);
    const notes = [];
    for (const event of events) {
        if (event.type !== "ImportNote")
            continue;
        const detail = event.payload.detail;
        const text = describeNote(event.payload.code, detail, header.payload.contentMode);
        notes.push({ sequence: event.sequenceNumber, code: event.payload.code, title: humanize(event.payload.code), text, stepId: event.payload.stepId });
    }
    let first = 0n;
    let last = 0n;
    const all = [...byId.values()];
    if (all.length > 0) {
        first = all.reduce((m, s) => (BigInt(s.startNs) < m ? BigInt(s.startNs) : m), BigInt(all[0].startNs));
        last = all.reduce((m, s) => (BigInt(s.endEffectiveNs) > m ? BigInt(s.endEffectiveNs) : m), BigInt(all[0].endEffectiveNs));
    }
    return {
        replay, events, runId: header.runId, contentMode: header.payload.contentMode,
        importer: `${header.payload.importer.id} ${header.payload.importer.version}`,
        steps: ordered, stepsById: byId, notes,
        durationLabel: all.length ? formatDuration(first.toString(), last.toString()) : "no steps",
    };
}
/** Above this many steps the tree shows only the steps near the current event. */
export const FULL_TREE_LIMIT = 300;
const NEAR_WINDOW = 80;
const RECENT_FINISHED = 40;
/** Notes listed on the screen; the rest are counted. Runs can carry thousands of notes. */
export const NOTE_LIST_LIMIT = 100;
/**
 * The steps to list at a position. Small runs show every step. A very large run shows the steps that are
 * running, failed, or active within a window around the position, plus their ancestors, in tree order.
 */
export function visibleSteps(model, position) {
    if (model.steps.length <= FULL_TREE_LIMIT)
        return { steps: model.steps, hidden: 0 };
    const keep = new Set();
    for (const step of model.steps) {
        const status = stepStatusAt(step, position);
        const near = step.endSequence >= position - NEAR_WINDOW && step.startSequence <= position + NEAR_WINDOW;
        if (status === "running" || status === "failed" || near)
            keep.add(step.stepId);
    }
    // Always show the most recently finished steps too, so a position after the last step (where every
    // other step is long finished) still shows something to look at.
    const recent = model.steps
        .filter((s) => s.endSequence <= position)
        .sort((a, b) => b.endSequence - a.endSequence)
        .slice(0, RECENT_FINISHED);
    for (const step of recent)
        keep.add(step.stepId);
    for (const id of [...keep]) {
        let parent = model.stepsById.get(id)?.parentStepId ?? null;
        for (let guard = 0; parent !== null && guard < 300 && !keep.has(parent); guard += 1) {
            keep.add(parent);
            parent = model.stepsById.get(parent)?.parentStepId ?? null;
        }
    }
    const steps = model.steps.filter((s) => keep.has(s.stepId));
    return { steps, hidden: model.steps.length - steps.length };
}
/** What this event changed about the recorded state, in plain words. Empty when nothing visible changed. */
export function describeStateChange(previous, next) {
    if (previous === null)
        return [];
    const lines = [];
    if (previous.openStepIds.length !== next.openStepIds.length)
        lines.push(`Steps running: ${previous.openStepIds.length} → ${next.openStepIds.length}`);
    if (previous.closedStepIds.length !== next.closedStepIds.length)
        lines.push(`Steps finished: ${previous.closedStepIds.length} → ${next.closedStepIds.length}`);
    if (previous.errorStepIds.length !== next.errorStepIds.length)
        lines.push(`Failed steps: ${previous.errorStepIds.length} → ${next.errorStepIds.length}`);
    if (previous.inputTokens !== next.inputTokens)
        lines.push(`Input tokens: ${formatNumber(previous.inputTokens)} → ${formatNumber(next.inputTokens)}`);
    if (previous.outputTokens !== next.outputTokens)
        lines.push(`Output tokens: ${formatNumber(previous.outputTokens)} → ${formatNumber(next.outputTokens)}`);
    const content = (state) => Object.values(state.content).reduce((a, b) => a + b, 0);
    if (content(previous) !== content(next))
        lines.push(`Content items recorded: ${content(previous)} → ${content(next)}`);
    if (previous.logCount !== next.logCount)
        lines.push(`Log records: ${previous.logCount} → ${next.logCount}`);
    const notes = (state) => Object.values(state.notes).reduce((a, b) => a + b, 0);
    if (notes(previous) !== notes(next))
        lines.push(`Importer notes: ${notes(previous)} → ${notes(next)}`);
    return lines;
}
export function loadRunFromBytes(bytes) {
    return buildRunModel(parseRunLog(bytes));
}
export function describeRunEvent(event, model) {
    const stepName = (id) => (id === null ? "no step" : model.stepsById.get(id)?.title ?? "an unknown step");
    switch (event.type) {
        case "RunStarted":
            return {
                category: "run", stepId: null, title: "Run imported",
                summary: `Trace ${event.payload.traceId.slice(0, 8)}…, steps shown in a derived order. Content is ${event.payload.contentMode === "HASH_ONLY" ? "withheld (fingerprints only)" : "stored as written"}.`,
            };
        case "StepStarted": {
            const step = model.stepsById.get(event.payload.stepId);
            const parent = event.payload.parentStepId === null ? "a top-level step" : `inside ${stepName(event.payload.parentStepId)}`;
            return { category: "step", stepId: event.payload.stepId, title: `${kindLabel(event.payload.kind)} started`, summary: `${step?.title ?? "Step"} began, ${parent}.` };
        }
        case "StepEnded": {
            const step = model.stepsById.get(event.payload.stepId);
            const failed = event.payload.statusCode === 2;
            const took = step ? ` after ${formatDuration(step.startNs, step.endEffectiveNs)}` : "";
            const unfinished = event.payload.endNs === null || event.payload.endNs === "0";
            return {
                category: "step", stepId: event.payload.stepId, title: failed ? "Step failed" : "Step finished",
                summary: `${stepName(event.payload.stepId)} ${failed ? "ended with an error" : "finished"}${took}${unfinished ? " (no end time was recorded; this end is estimated)" : ""}. Status message: ${describeField(event.payload.statusMessage, 200).text || "none"}.`,
            };
        }
        case "UsageRecorded": {
            const i = event.payload.inputTokens;
            const o = event.payload.outputTokens;
            return {
                category: "tokens", stepId: event.payload.stepId, title: "Tokens recorded",
                summary: `${stepName(event.payload.stepId)} used ${i === null ? "an unreported number of" : formatNumber(i)} input and ${o === null ? "an unreported number of" : formatNumber(o)} output tokens.`,
            };
        }
        case "ContentRecorded": {
            const value = describeField(event.payload.value, 600);
            const label = CONTENT_LABEL[event.payload.field] ?? "Content";
            const where = event.payload.stepId !== null ? stepName(event.payload.stepId) : `log record ${event.payload.logOrdinal}`;
            return { category: "content", stepId: event.payload.stepId, title: `${label} recorded`, summary: `${label} for ${where}: ${value.text}.` };
        }
        case "LogRecorded": {
            const p = event.payload;
            return {
                category: "log", stepId: p.stepId, title: "Log record",
                summary: `Log record ${p.logOrdinal}, severity ${p.severityNumber === 0 ? "not set" : p.severityNumber}, ${p.stepId === null ? "not attached to any step" : `attached to ${stepName(p.stepId)}`}.`,
            };
        }
        case "ImportNote": {
            const note = model.notes.find((n) => n.sequence === event.sequenceNumber);
            return { category: "note", stepId: event.payload.stepId, title: `Importer note: ${note?.title ?? humanize(event.payload.code)}`, summary: note?.text ?? "" };
        }
        case "RunEnded":
            return { category: "run", stepId: null, title: "Run ends", summary: `${event.payload.eventCount} events recorded in all.` };
    }
}
/** Cheap category of an event (the timeline colours and the filters use it for every event of a run). */
export function categoryOf(event) {
    switch (event.type) {
        case "StepStarted":
        case "StepEnded": return "step";
        case "UsageRecorded": return "tokens";
        case "ContentRecorded": return "content";
        case "LogRecorded": return "log";
        case "ImportNote": return "note";
        default: return "run";
    }
}
