export interface SimulatedTask {
  taskId: string;
  objective: string;
  cost: number;
  workClass?: WorkClass;
  researchKey?: string;
  workerRole?: string;
  durationMs: number;
  dependencies?: string[];
}

export interface ExecutionInterval {
  startedAt: number;
  finishedAt: number;
}

export interface ScheduleResult {
  executionIntervals: Record<string, ExecutionInterval>;
  maxConcurrentAttempts: number;
  taskOutcomes: Record<string, "COMPLETED" | "FAILED_TRANSIENT">;
  completionOrder: string[];
}

const wait = (durationMs: number) => new Promise<void>((resolve) => setTimeout(resolve, durationMs));
const seededDelay = (seed: number, taskId: string, attemptNumber: number, baseDurationMs: number) => {
  const taskHash = [...taskId].reduce((total, character) => total + character.charCodeAt(0), 0);
  return baseDurationMs + 9 - ((seed + taskHash + attemptNumber) % 10);
};
const seededOutcome = (seed: number, taskId: string, attemptNumber: number) =>
  ((seed * 17 + [...taskId].reduce((total, character) => total + character.charCodeAt(0), 0) + attemptNumber) % 5 === 0
    ? "FAILED_TRANSIENT"
    : "COMPLETED") as "COMPLETED" | "FAILED_TRANSIENT";
export const deriveAttemptDecision = (seed: number, taskId: string, attemptNumber: number, baseDurationMs: number) => ({
  simulatedDelayMs: seededDelay(seed, taskId, attemptNumber, baseDurationMs),
  outcome: seededOutcome(seed, taskId, attemptNumber),
});

function validateDependencyGraph(tasks: SimulatedTask[]): void {
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (taskId: string) => {
    if (visiting.has(taskId)) throw new Error("Task dependency graph contains a cycle.");
    if (visited.has(taskId)) return;
    const task = byId.get(taskId);
    if (!task) throw new Error(`Task dependency is missing: ${taskId}.`);
    visiting.add(taskId);
    for (const dependency of task.dependencies ?? []) visit(dependency);
    visiting.delete(taskId);
    visited.add(taskId);
  };
  for (const task of tasks) visit(task.taskId);
}

export async function runSimulatedSchedule(options: {
  missionId: string;
  missionSeed: number;
  historyPath?: string;
  totalBudget: number;
  tasks: SimulatedTask[];
  maxConcurrency?: number;
  completeMission?: boolean;
}): Promise<ScheduleResult> {
  const maxConcurrency = options.maxConcurrency ?? 3;
  if (maxConcurrency < 1 || maxConcurrency > 3) throw new Error("Concurrency must be between 1 and 3.");
  if (new Set(options.tasks.map((task) => task.taskId)).size !== options.tasks.length) throw new Error("Task IDs must be unique.");
  validateDependencyGraph(options.tasks);
  if (options.tasks.reduce((total, task) => total + task.cost, 0) > options.totalBudget) {
    throw new Error("Insufficient mission budget for scheduled task attempts.");
  }
  const store = options.historyPath ? new JsonlEventStore(options.historyPath) : undefined;
  const events: MissionEvent[] = [];
  let state = initialMissionState();
  const append = async (type: MissionEvent["type"], payload: MissionEvent["payload"]) => {
    const event = { schemaVersion: 1 as const, sequenceNumber: events.length + 1, missionId: options.missionId, eventId: `${options.missionId}-${events.length + 1}`, timestamp: new Date().toISOString(), type, payload } as MissionEvent;
    events.push(event);
    state = reduce(state, event);
    if (store) await store.append(event);
  };
  await append("MissionCreated", { totalBudget: options.totalBudget, missionSeed: options.missionSeed, policyVersions: { tribunal: "1" } });

  const pending = new Map(options.tasks.map((task) => [task.taskId, task]));
  const completed = new Set<string>();
  const intervals: Record<string, ExecutionInterval> = {};
  const running = new Map<string, Promise<{ taskId: string; outcome: "COMPLETED" | "FAILED_TRANSIENT" }>>();
  const taskOutcomes: Record<string, "COMPLETED" | "FAILED_TRANSIENT"> = {};
  const completionOrder: string[] = [];
  let maxConcurrentAttempts = 0;

  const canStart = (task: SimulatedTask) => (task.dependencies ?? []).every((dependency) => completed.has(dependency));
  const startEligibleTasks = async () => {
    const eligible: SimulatedTask[] = [];
    for (const task of pending.values()) {
      if (running.size + eligible.length >= maxConcurrency) break;
      if (!canStart(task)) continue;
      pending.delete(task.taskId);
      eligible.push(task);
    }
    for (const task of eligible) {
      await append("TaskAuthorized", {
        taskId: task.taskId,
        objective: task.objective,
        cost: task.cost,
        workClass: task.workClass ?? "MANDATORY",
        researchKey: task.researchKey ?? task.taskId,
        authorizationReason: task.workClass === "OPTIONAL" ? "GAP_RESOLUTION" : "MANDATORY_BASELINE",
        dependencies: task.dependencies ?? [],
      });
    }
    for (const task of eligible) {
      const attemptId = `${task.taskId}:a1`;
      await append("TaskScheduled", { taskId: task.taskId, attemptId, objective: task.objective, cost: task.cost, workClass: task.workClass ?? "MANDATORY", researchKey: task.researchKey ?? task.taskId, workerRole: task.workerRole ?? "SIMULATED_WORKER", dependencies: task.dependencies ?? [] });
    }
    for (const task of eligible) {
      const attemptId = `${task.taskId}:a1`;
      await append("BudgetReserved", { attemptId, cost: task.cost });
      const startedAt = Date.now();
      const attemptNumber = 1;
      const durationMs = seededDelay(options.missionSeed, task.taskId, attemptNumber, task.durationMs);
      await append("TaskStarted", { attemptId, simulatedDelayMs: durationMs });
      running.set(task.taskId, wait(durationMs).then(() => {
        intervals[task.taskId] = { startedAt, finishedAt: Date.now() };
        return { taskId: task.taskId, outcome: seededOutcome(options.missionSeed, task.taskId, attemptNumber) };
      }));
      maxConcurrentAttempts = Math.max(maxConcurrentAttempts, running.size);
    }
  };

  while (pending.size > 0 || running.size > 0) {
    await startEligibleTasks();
    if (running.size === 0) throw new Error("No eligible task remains; dependencies are missing or cyclic.");
    const finished = await Promise.race(running.values());
    running.delete(finished.taskId);
    taskOutcomes[finished.taskId] = finished.outcome;
    completionOrder.push(finished.taskId);
    const attemptId = `${finished.taskId}:a1`;
    if (finished.outcome === "FAILED_TRANSIENT") await append("TaskFailedTransient", { attemptId, reason: "Simulated transient failure." });
    else await append("FindingSubmitted", { attemptId, finding: `${finished.taskId} completed.` });
    if (finished.outcome === "COMPLETED") completed.add(finished.taskId);
  }
  if (options.completeMission ?? true) await append("MissionCompleted", {});
  return { executionIntervals: intervals, maxConcurrentAttempts, taskOutcomes, completionOrder };
}
import { JsonlEventStore } from "./event-store.js";
import type { MissionEvent, WorkClass } from "./contracts.js";
import { initialMissionState, reduce } from "./reducer.js";
