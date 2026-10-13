import type { MissionEvent } from "../contracts.js";
import type { AgentState, OfficeProjection } from "./office-projection.js";
import { displayResearchCopy, summarizeResearchEvent } from "./research-presentation.js";

export type Task = OfficeProjection["tasks"][number];

export const stateText: Record<AgentState, string> = { COMPLETED: "Completed", WORKING: "Working", WAITING: "Waiting", BLOCKED: "Blocked" };

export function nodeTitle(task: Task): string {
  if (task.role) return task.role.replace(/ Researcher$/, "");
  const copy = displayResearchCopy(task.label);
  return copy.length > 26 ? `${copy.slice(0, 25)}…` : copy;
}

/** Layer tasks by dependency depth so prerequisites sit left of the work that needs them. */
export function layoutTasks(tasks: Task[]): Array<{ task: Task; level: number; x: number; y: number }> {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const levels = new Map<string, number>();
  const levelOf = (task: Task, trail: Set<string>): number => {
    const known = levels.get(task.id);
    if (known !== undefined) return known;
    if (trail.has(task.id)) return 0;
    trail.add(task.id);
    const parents = task.dependencyIds.map((id) => byId.get(id)).filter((parent): parent is Task => Boolean(parent));
    const level = parents.length ? Math.max(...parents.map((parent) => levelOf(parent, trail))) + 1 : 0;
    trail.delete(task.id);
    levels.set(task.id, level);
    return level;
  };
  tasks.forEach((task) => levelOf(task, new Set()));
  const columns = Math.max(0, ...tasks.map((task) => levels.get(task.id) ?? 0)) + 1;
  const perLevel = new Map<number, Task[]>();
  tasks.forEach((task) => { const level = levels.get(task.id) ?? 0; perLevel.set(level, [...(perLevel.get(level) ?? []), task]); });
  return tasks.map((task) => {
    const level = levels.get(task.id) ?? 0;
    const siblings = perLevel.get(level)!;
    const index = siblings.indexOf(task);
    const step = columns === 1 ? 0 : Math.min(30, 74 / (columns - 1));
    const x = 50 + (level - (columns - 1) / 2) * step;
    const y = siblings.length === 1 ? 46 : 22 + (50 * index) / (siblings.length - 1);
    return { task, level, x, y };
  });
}

export function defaultSelection(tasks: Task[]): string | undefined {
  return (tasks.find((task) => task.state === "BLOCKED") ?? tasks.find((task) => task.state === "WORKING") ?? [...tasks].reverse().find((task) => task.state === "COMPLETED") ?? tasks[0])?.id;
}

export function uniqueAgents(projection: OfficeProjection): OfficeProjection["agents"] {
  return [...new Map(projection.agents.map((agent) => [agent.id, agent])).values()];
}

/** Describes what one recorded event changed by comparing the projections before and after it. */
export function describeChange(previous: OfficeProjection | null, next: OfficeProjection): { lines: string[]; taskIds: Set<string> } {
  const lines: string[] = [];
  const taskIds = new Set<string>();
  const before = new Map((previous?.tasks ?? []).map((task) => [task.id, task]));
  for (const task of next.tasks) {
    const old = before.get(task.id);
    if (!old) { lines.push(`${nodeTitle(task)} authorized`); taskIds.add(task.id); }
    else if (old.state !== task.state) { lines.push(`${nodeTitle(task)}: ${stateText[old.state]} → ${stateText[task.state]}`); taskIds.add(task.id); }
    else if (!old.role && task.role) { lines.push(`${nodeTitle(task)} scheduled`); taskIds.add(task.id); }
  }
  if (previous) {
    for (const key of ["reserved", "committed", "spent"] as const) if (previous.ledger[key] !== next.ledger[key]) lines.push(`Budget ${key}: ${previous.ledger[key]} → ${next.ledger[key]}`);
    const was = uniqueAgents(previous).filter((agent) => agent.state === "WORKING").length;
    const now = uniqueAgents(next).filter((agent) => agent.state === "WORKING").length;
    if (was !== now) lines.push(`Researchers working: ${was} → ${now}`);
    if (previous.mission.status !== next.mission.status) lines.push(`Mission status: ${previous.mission.status.toLowerCase()} → ${next.mission.status.toLowerCase()}`);
  }
  return { lines, taskIds };
}

export function humanizeType(type: string): string {
  const text = type.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export interface ChainStep { sequence: number; type: string; summary: string; final: boolean }

/** The recorded events that belong to one worker attempt, in order, starting from its task authorization. */
export function attemptChain(history: MissionEvent[], attemptId: string): ChainStep[] {
  const scheduled = history.find((event) => event.type === "TaskScheduled" && (event.payload as { attemptId?: string }).attemptId === attemptId);
  const taskId = scheduled ? (scheduled.payload as { taskId?: string }).taskId : undefined;
  return history
    .filter((event) => {
      const payload = event.payload as Record<string, unknown>;
      return payload.attemptId === attemptId || (event.type === "TaskAuthorized" && taskId !== undefined && payload.taskId === taskId);
    })
    .map((event) => ({ sequence: event.sequenceNumber, type: event.type, summary: summarizeResearchEvent(event), final: event.type === "FindingSubmitted" || event.type === "SubscriptionWorkerExecutionOutcomeRecorded" }));
}

export interface RevisionStep { label: string; state: "done" | "current" | "pending" }

/** Where a blind-review revision stands, derived from which revision events have been recorded. */
export function revisionPath(history: MissionEvent[]): { requested: boolean; steps: RevisionStep[] } {
  const seen = (type: MissionEvent["type"]) => history.some((event) => event.type === type);
  const requested = seen("RevisionRequested");
  const flags = [true, requested, seen("FocusedReauditCompleted"), seen("FocusedRereviewCompleted")];
  const labels = ["Blind review", "Revision requested", "Focused re-audit", "Focused re-review"];
  const firstOpen = flags.indexOf(false);
  return { requested, steps: labels.map((label, index) => ({ label, state: flags[index] ? "done" : index === firstOpen ? "current" : "pending" })) };
}

/** Beam tilt in degrees for the tribunal scale: positive lowers the ruin side, negative the venture side. */
export function scaleAngle(ventureClaims: number, ruinClaims: number): number {
  return Math.max(-18, Math.min(18, (ruinClaims - ventureClaims) * 6));
}