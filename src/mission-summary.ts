import type { MissionEvent } from "./contracts.js";
import type { MissionState } from "./reducer.js";

/** Format the inspectable CLI view of a mission without changing runtime state. */
export function formatMissionSummary(state: MissionState, events: readonly MissionEvent[]): string {
  const unresolvedGaps = Object.entries(state.gaps)
    .filter(([, gap]) => gap.status === "OPEN" || gap.status === "REOPENED")
    .map(([gapId, gap]) => `${gapId} (${gap.status})`);
  const history = events.length === 0
    ? "  (none)"
    : events.map((event) => `  ${event.sequenceNumber}: ${event.type}`).join("\n");

  return [
    `Mission: ${state.status}`,
    `Budget: ${state.budget.total} total, ${state.budget.reserved} reserved, ${state.budget.committed} committed, ${state.budget.spent} spent, ${state.budget.available} available`,
    `Unresolved gaps: ${unresolvedGaps.length === 0 ? "none" : unresolvedGaps.join(", ")}`,
    "Event history:",
    history,
  ].join("\n");
}
