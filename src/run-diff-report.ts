// Plain-language reading of a run diff. Pure: used by the command line (and ready for a screen), so every
// interface says the same thing. Titles come from the runs; the caller escapes the lines before printing.
import { formatSeconds, group } from "./budget-report.js";
import type { DiffChange, DiffItem, DiffResult, RunTotals } from "./run-diff.js";

export const DIFF_NOTE =
  "Steps are matched by what they are (kind, operation, model name, and tool or agent name, using the full recorded values) in tree order, not by id, because ids differ between runs. A difference means the two recordings differ, not that either run is right.";

export const NOT_COMPARED_NOTE =
  "Not compared: how long each step took, step events, log record times and severities, log records that carry no content, attributes that are neither a name used for matching nor recorded content, and content of log records that belong to no step.";

const stepName = (item: DiffItem): string => (item.a ?? item.b)?.title ?? "a step";

export function changeText(change: DiffChange): string {
  switch (change.code) {
    case "STATUS": return `it ${change.a === "failed" ? "failed" : "succeeded"} in run A but ${change.b === "failed" ? "failed" : "succeeded"} in run B`;
    case "PARENT": return "it sits under a different step than in run A";
    case "STATUS_MESSAGE": return "its status or failure message differs";
    case "INPUT_TOKENS": return `input tokens: ${change.a} in run A, ${change.b} in run B`;
    case "OUTPUT_TOKENS": return `output tokens: ${change.a} in run A, ${change.b} in run B`;
    case "CONTENT": return `recorded content differs (${change.fields.join(", ")})`;
  }
}

/**
 * One sentence per difference, in step order. A run of steps only in A followed by a run only in B is read as
 * replacements, pairing them in order; any left over are reported as only in one run.
 */
export function describeDifferences(result: DiffResult, limit: number): { lines: string[]; hidden: number } {
  const lines: string[] = [];
  let hidden = 0;
  const add = (text: string): void => { if (lines.length < limit) lines.push(text); else hidden += 1; };
  const items = result.items;
  let k = 0;
  while (k < items.length) {
    const item = items[k];
    if (item.status === "same") { k += 1; continue; }
    if (item.status === "onlyA") {
      let endA = k;
      while (endA < items.length && items[endA].status === "onlyA") endA += 1;
      let endB = endA;
      while (endB < items.length && items[endB].status === "onlyB") endB += 1;
      const paired = Math.min(endA - k, endB - endA);
      for (let n = 0; n < paired; n += 1) add(`Run A has "${stepName(items[k + n])}" where run B has "${stepName(items[endA + n])}".`);
      for (let n = paired; n < endA - k; n += 1) add(`Only run A has "${stepName(items[k + n])}".`);
      for (let n = paired; n < endB - endA; n += 1) add(`Only run B has "${stepName(items[endA + n])}".`);
      k = endB;
      continue;
    }
    if (item.status === "onlyB") add(`Only run B has "${stepName(item)}".`);
    else add(`"${stepName(item)}" is in both runs, but ${item.changes.map(changeText).join("; ")}.`);
    k += 1;
  }
  return { lines, hidden };
}

function totalsRow(label: string, a: string, b: string): string {
  return `  ${label}: ${a} in run A, ${b} in run B${a === b ? " (same)" : ""}`;
}

export function totalsLines(a: RunTotals, b: RunTotals): string[] {
  return [
    totalsRow("Steps", group(a.steps), group(b.steps)),
    totalsRow("Model calls", group(a.modelCalls), group(b.modelCalls)),
    totalsRow("Tool calls", group(a.toolCalls), group(b.toolCalls)),
    totalsRow("Failed steps", group(a.failedSteps), group(b.failedSteps)),
    totalsRow("Input tokens", group(a.inputTokens), group(b.inputTokens)),
    totalsRow("Output tokens", group(a.outputTokens), group(b.outputTokens)),
    totalsRow("Time", formatSeconds(a.durationNs), formatSeconds(b.durationNs)),
  ];
}

export function diffCaveats(result: DiffResult): string[] {
  const notes = [DIFF_NOTE, NOT_COMPARED_NOTE, "Time is shown in the totals only: two honest runs never take exactly as long, so it is not treated as a difference."];
  if (!result.fullyAligned) notes.push("The runs were too different to line up in full, so everything between their shared start and shared end is listed as removed and added.");
  if (result.unverifiedNesting > 0) notes.push(`${group(result.unverifiedNesting)} step(s) sit under parents that fell in the part that could not be lined up in either run, so whether their nesting changed was not checked.`);
  if (result.contentComparable) notes.push("Recorded content is compared by fingerprint, so a run kept with its content and one kept without it can still be compared.");
  else notes.push("Neither run recorded any step content, so only structure, outcome and token counts were compared.");
  const missing = result.totals.a.stepsMissingTokens + result.totals.b.stepsMissingTokens;
  if (missing > 0) notes.push(`${group(missing)} model call(s) were missing an input or an output token count; a missing figure is counted as zero in the totals.`);
  return notes;
}

/** The verdict sentence of a diff. Shared by the command line and the screen so both say the same thing. */
export function diffVerdictLine(result: DiffResult): string {
  if (result.tooLarge) return "Result: one of the runs has too many steps to compare here, so nothing was compared.";
  if (result.identical) return "Result: the runs match step for step in step names, nesting, outcome, status messages, token counts and recorded content (see the notes for what is not compared).";
  return `Result: the runs first differ at step ${group(result.firstIndex + 1)} of the aligned list.`;
}

export function diffCountsLine(result: DiffResult): string {
  return `Steps in both and unchanged: ${group(result.counts.same)}; changed: ${group(result.counts.changed)}; only in A: ${group(result.counts.onlyA)}; only in B: ${group(result.counts.onlyB)}.`;
}

function diffSummaryLines(result: DiffResult): string[] {
  if (result.tooLarge || result.identical) return [diffVerdictLine(result)];
  const first = result.first as DiffItem;
  const where = [first.a ? `run A event ${first.a.startSequence}` : null, first.b ? `run B event ${first.b.startSequence}` : null].filter(Boolean).join(", ");
  return [diffVerdictLine(result), `  Look at: ${where} (use the state command with --at to see each run there).`, `  ${diffCountsLine(result)}`];
}

export function diffReportLines(result: DiffResult, ids: { a: string; b: string }, limit = 25): string[] {
  const lines: string[] = [`Run A: ${ids.a}`, `Run B: ${ids.b}`, "", ...diffSummaryLines(result)];
  if (result.tooLarge) return lines;
  if (!result.identical) {
    const diffs = describeDifferences(result, limit);
    lines.push("Differences:");
    for (const line of diffs.lines) lines.push(`  ${line}`);
    if (diffs.hidden > 0) lines.push(`  ... and ${group(diffs.hidden)} more.`);
  }
  if (result.tools.length > 0) {
    lines.push("Tool use that differs:");
    for (const t of result.tools.slice(0, limit)) lines.push(`  ${t.tool}: ${group(t.a)} call(s) in run A, ${group(t.b)} in run B`);
    if (result.tools.length > limit) lines.push(`  ... and ${group(result.tools.length - limit)} more tools.`);
  }
  lines.push("Totals:");
  lines.push(...totalsLines(result.totals.a, result.totals.b));
  lines.push("Notes:");
  for (const note of diffCaveats(result)) lines.push(`  - ${note}`);
  return lines;
}
