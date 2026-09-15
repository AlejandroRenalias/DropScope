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
const pilotPause = Symbol("live-worker-pilot-pause");
const sourcePilotPause = Symbol("google-trends-pilot-pause");
const seededDelay = (seed: number, taskId: string, attemptNumber: number, baseDurationMs: number) => {
  const taskHash = [...taskId].reduce((total, character) => total + character.charCodeAt(0), 0);
  return baseDurationMs + 9 - ((seed + taskHash + attemptNumber) % 10);
};
const seededOutcome = (seed: number, taskId: string, attemptNumber: number) => {
  const base = seed * 17 + [...taskId].reduce((total, character) => total + character.charCodeAt(0), 0);
  return ((attemptNumber === 1 && (base + 1) % 5 === 0) || (attemptNumber === 2 && base % 7 === 0)
    ? "FAILED_TRANSIENT"
    : "COMPLETED") as "COMPLETED" | "FAILED_TRANSIENT";
};
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
  eventStore?: JsonlEventStore;
  totalBudget: number;
  tasks: SimulatedTask[];
  maxConcurrency?: number;
  completeMission?: boolean;
  // This assignment is the only worker seam currently admitted by the local
  // scheduler. It always records RECORDED_DRY_RUN provenance before invocation.
  recordedWorkerAssignment?: { workerRole: string; adapter: RecordedWorkerAdapter };
  subscriptionRuntimeDeclaration?: import("./contracts.js").SubscriptionRuntimeDeclaration;
  [pilotPause]?: true;
  [sourcePilotPause]?: true;
}): Promise<ScheduleResult> {
  const maxConcurrency = options.maxConcurrency ?? 3;
  if (maxConcurrency < 1 || maxConcurrency > 3) throw new Error("Concurrency must be between 1 and 3.");
  if (new Set(options.tasks.map((task) => task.taskId)).size !== options.tasks.length) throw new Error("Task IDs must be unique.");
  validateDependencyGraph(options.tasks);
  const pauseForPilot = options[pilotPause] === true;
  const pauseForSourcePilot = options[sourcePilotPause] === true;
  if (pauseForPilot && pauseForSourcePilot) throw new Error("Only one pilot pause may be selected.");
  if (pauseForPilot) {
    const [task] = options.tasks;
    if (options.tasks.length !== 1 || task?.taskId !== liveWorkerPilotTask.id || task.objective !== liveWorkerPilotTask.objective || task.cost !== liveWorkerPilotTask.cost || task.workerRole !== liveWorkerPilotTask.workerRole || options.missionSeed !== 1 || options.totalBudget !== 20 || !options.subscriptionRuntimeDeclaration) {
      throw new Error("Only the fixed live-worker pilot may pause after task start.");
    }
    if (options.recordedWorkerAssignment) throw new Error("A paused schedule cannot invoke a worker assignment.");
  }
  if (pauseForSourcePilot) {
    const [task] = options.tasks;
    if (options.tasks.length !== 1 || task?.taskId !== googleTrendsPilotTask.id || task.objective !== googleTrendsPilotTask.objective || task.cost !== googleTrendsPilotTask.cost || task.workerRole !== googleTrendsPilotTask.workerRole || options.missionSeed !== 1 || options.totalBudget !== 20 || options.subscriptionRuntimeDeclaration) {
      throw new Error("Only the fixed Google Trends pilot may pause after task start.");
    }
    if (options.recordedWorkerAssignment) throw new Error("A paused schedule cannot invoke a worker assignment.");
  }
  if (options.tasks.reduce((total, task) => total + task.cost, 0) > options.totalBudget) {
    throw new Error("Insufficient mission budget for scheduled task attempts.");
  }
  if (options.historyPath && options.eventStore) throw new Error("Provide either historyPath or eventStore, not both.");
  const store = options.eventStore ?? (options.historyPath ? new JsonlEventStore(options.historyPath) : undefined);
  if (options.recordedWorkerAssignment && !store) throw new Error("Recorded worker execution requires a persisted event store.");
  const events: MissionEvent[] = [];
  let state = initialMissionState();
  const workerResultGate = new WorkerResultGate();
  const append = async (type: MissionEvent["type"], payload: MissionEvent["payload"]) => {
    const event = { schemaVersion: 1 as const, sequenceNumber: events.length + 1, missionId: options.missionId, eventId: `${options.missionId}-${events.length + 1}`, timestamp: new Date().toISOString(), type, payload } as MissionEvent;
    events.push(event);
    state = reduce(state, event);
    if (store) await store.append(event);
  };
  await append("MissionCreated", { totalBudget: options.totalBudget, missionSeed: options.missionSeed, policyVersions: { tribunal: "1" } });
  if (options.subscriptionRuntimeDeclaration) await append("SubscriptionRuntimeDeclared", options.subscriptionRuntimeDeclaration);

  const pending = new Map(options.tasks.map((task) => [task.taskId, task]));
  const completed = new Set<string>();
  const intervals: Record<string, ExecutionInterval> = {};
  const running = new Map<string, Promise<{ taskId: string; attemptNumber: number; outcome: "COMPLETED" | "FAILED_TRANSIENT" }>>();
  const taskOutcomes: Record<string, "COMPLETED" | "FAILED_TRANSIENT"> = {};
  const completionOrder: string[] = [];
  let maxConcurrentAttempts = 0;
  let terminated = false;
  let paused = false;

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
      if ((pauseForPilot && task.taskId === liveWorkerPilotTask.id) || (pauseForSourcePilot && task.taskId === googleTrendsPilotTask.id)) {
        paused = true;
        maxConcurrentAttempts = Math.max(maxConcurrentAttempts, 1);
        continue;
      }
      running.set(task.taskId, wait(durationMs).then(() => {
        intervals[task.taskId] = { startedAt, finishedAt: Date.now() };
        return { taskId: task.taskId, attemptNumber, outcome: seededOutcome(options.missionSeed, task.taskId, attemptNumber) };
      }));
      maxConcurrentAttempts = Math.max(maxConcurrentAttempts, running.size);
    }
  };

  while (!terminated && (pending.size > 0 || running.size > 0)) {
    await startEligibleTasks();
    if (paused) return { executionIntervals: intervals, maxConcurrentAttempts, taskOutcomes, completionOrder };
    if (running.size === 0) throw new Error("No eligible task remains; dependencies are missing or cyclic.");
    const finished = await Promise.race(running.values());
    running.delete(finished.taskId);
    const attemptId = `${finished.taskId}:a${finished.attemptNumber}`;
    let outcome = finished.outcome;
    let failureReason = "Simulated transient failure.";
    let finding = `${finished.taskId} completed.`;
    if (outcome === "COMPLETED") {
      const task = options.tasks.find((candidate) => candidate.taskId === finished.taskId)!;
      if (options.recordedWorkerAssignment?.workerRole === (task.workerRole ?? "SIMULATED_WORKER")) {
        try {
          await append("WorkerExecutionRecorded", { attemptId, mode: "RECORDED_DRY_RUN", providerUsageStatus: "NOT_APPLICABLE" });
          const result = await workerResultGate.run(options.recordedWorkerAssignment.adapter, {
            missionId: options.missionId,
            taskId: task.taskId,
            attemptId,
            objective: task.objective,
            workerRole: task.workerRole ?? "SIMULATED_WORKER",
            maxCost: task.cost,
          });
          finding = result.finding;
        } catch (error: unknown) {
          outcome = "FAILED_TRANSIENT";
          failureReason = error instanceof Error ? `Worker result rejected: ${error.message}` : "Worker result rejected.";
        }
      }
    }
    if (outcome === "FAILED_TRANSIENT") {
      await append("TaskFailedTransient", { attemptId, reason: failureReason });
      if (finished.attemptNumber < 2) {
        const task = options.tasks.find((candidate) => candidate.taskId === finished.taskId)!;
        const retryId = `${task.taskId}:a2`;
        if (task.cost > state.budget.available) {
          await append("MissionTerminated", { status: "BLOCKED_BUDGET", reason: "Transient retry cannot be funded." });
          terminated = true;
          continue;
        }
        await append("TaskScheduled", { taskId: task.taskId, attemptId: retryId, objective: task.objective, cost: task.cost, workClass: task.workClass ?? "MANDATORY", researchKey: task.researchKey ?? task.taskId, workerRole: task.workerRole ?? "SIMULATED_WORKER", dependencies: task.dependencies ?? [] });
        await append("BudgetReserved", { attemptId: retryId, cost: task.cost });
        const startedAt = Date.now();
        const durationMs = seededDelay(options.missionSeed, task.taskId, 2, task.durationMs);
        await append("TaskStarted", { attemptId: retryId, simulatedDelayMs: durationMs });
        running.set(task.taskId, wait(durationMs).then(() => { intervals[task.taskId] = { startedAt, finishedAt: Date.now() }; return { taskId: task.taskId, attemptNumber: 2, outcome: seededOutcome(options.missionSeed, task.taskId, 2) }; }));
        maxConcurrentAttempts = Math.max(maxConcurrentAttempts, running.size);
      } else {
        taskOutcomes[finished.taskId] = outcome;
        completionOrder.push(finished.taskId);
        await append("MissionTerminated", { status: "FAILED_UNRECOVERABLE", reason: "Transient retry allowance was exhausted." });
        terminated = true;
      }
    } else {
      taskOutcomes[finished.taskId] = outcome;
      completionOrder.push(finished.taskId);
      await append("FindingSubmitted", { attemptId, finding });
      completed.add(finished.taskId);
    }
  }
  if (!terminated && (options.completeMission ?? true)) await append("MissionCompleted", {});
  return { executionIntervals: intervals, maxConcurrentAttempts, taskOutcomes, completionOrder };
}
import { JsonlEventStore } from "./event-store.js";
import type { MissionEvent, WorkClass } from "./contracts.js";
import { initialMissionState, reduce } from "./reducer.js";
import { RecordedWorkerAdapter, WorkerResultGate } from "./worker-adapter.js";
import { googleTrendsPilotTask, liveWorkerPilotTask } from "./fixture-model.js";

/** The only public way to prepare the fixed, non-executing live-worker pilot. */
export function prepareLiveWorkerPilotSchedule(options: { missionId: string; historyPath?: string; eventStore?: JsonlEventStore }): Promise<ScheduleResult> {
  return runSimulatedSchedule({
    missionId: options.missionId,
    missionSeed: 1,
    totalBudget: 20,
    historyPath: options.historyPath,
    eventStore: options.eventStore,
    maxConcurrency: 1,
    completeMission: false,
    subscriptionRuntimeDeclaration: { executionEnabled: false, accessStatus: "NOT_CHECKED", usageStatus: "NOT_ITEMIZED" },
    tasks: [{ taskId: liveWorkerPilotTask.id, objective: liveWorkerPilotTask.objective, cost: liveWorkerPilotTask.cost, durationMs: liveWorkerPilotTask.durationMs, workClass: liveWorkerPilotTask.workClass, researchKey: liveWorkerPilotTask.researchKey, dependencies: [...liveWorkerPilotTask.dependencies], workerRole: liveWorkerPilotTask.workerRole }],
    [pilotPause]: true,
  });
}

/** The public-source pilot stops after durable task start, awaiting one user click. */
export function prepareGoogleTrendsPilotSchedule(options: { missionId: string; historyPath?: string; eventStore?: JsonlEventStore }): Promise<ScheduleResult> {
  return runSimulatedSchedule({
    missionId: options.missionId,
    missionSeed: 1,
    totalBudget: 20,
    historyPath: options.historyPath,
    eventStore: options.eventStore,
    maxConcurrency: 1,
    completeMission: false,
    tasks: [{ taskId: googleTrendsPilotTask.id, objective: googleTrendsPilotTask.objective, cost: googleTrendsPilotTask.cost, durationMs: googleTrendsPilotTask.durationMs, workClass: googleTrendsPilotTask.workClass, researchKey: googleTrendsPilotTask.researchKey, dependencies: [...googleTrendsPilotTask.dependencies], workerRole: googleTrendsPilotTask.workerRole }],
    [sourcePilotPause]: true,
  });
}
