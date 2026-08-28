import type { MissionEvent } from "./contracts.js";
import { JsonlEventStore } from "./event-store.js";
import { replay, type MissionState } from "./reducer.js";

export interface WalkingSkeletonResult {
  events: MissionEvent[];
  state: MissionState;
}

interface MissionOptions {
  missionId: string;
  totalBudget?: number;
  historyPath: string;
}

async function appendEvent(
  store: JsonlEventStore,
  events: MissionEvent[],
  missionId: string,
  type: MissionEvent["type"],
  payload: MissionEvent["payload"],
): Promise<void> {
  const event = {
    schemaVersion: 1 as const,
    sequenceNumber: events.length + 1,
    missionId,
    eventId: `${missionId}-${events.length + 1}`,
    timestamp: new Date().toISOString(),
    type,
    payload,
  } as MissionEvent;
  events.push(event);
  await store.append(event);
}

export async function beginWalkingSkeletonMission(options: Required<MissionOptions>): Promise<WalkingSkeletonResult> {
  const store = new JsonlEventStore(options.historyPath);
  const existingEvents = await store.readAll();
  if (existingEvents.length > 0) throw new Error("A new mission cannot be appended to existing history.");

  await appendEvent(store, existingEvents, options.missionId, "MissionCreated", { totalBudget: options.totalBudget });
  await appendEvent(store, existingEvents, options.missionId, "TaskScheduled", {
    taskId: "system-check",
    objective: "Verify the DropScope engine can complete one task.",
    cost: 10,
  });
  await appendEvent(store, existingEvents, options.missionId, "TaskStarted", { taskId: "system-check" });
  return { events: await store.readAll(), state: replay(await store.readAll()) };
}

export async function recoverWalkingSkeletonMission(options: Omit<MissionOptions, "totalBudget">): Promise<WalkingSkeletonResult> {
  const store = new JsonlEventStore(options.historyPath);
  const events = await store.readAll();
  const state = replay(events);
  if (state.missionId !== options.missionId) throw new Error("Recovery history belongs to a different mission.");
  const interruptedTaskIds = Object.entries(state.tasks)
    .filter(([, task]) => task.status === "RUNNING")
    .map(([taskId]) => taskId);
  if (interruptedTaskIds.length === 0) throw new Error("There is no running task to recover.");

  await appendEvent(store, events, options.missionId, "RecoveryStarted", { interruptedTaskIds });
  for (const taskId of interruptedTaskIds) {
    await appendEvent(store, events, options.missionId, "TaskInterrupted", { taskId, reason: "Process stopped before completion." });
  }
  await appendEvent(store, events, options.missionId, "TaskScheduled", {
    taskId: "system-check:a2",
    objective: "Verify the DropScope engine can complete one task after recovery.",
    cost: 10,
  });
  await appendEvent(store, events, options.missionId, "TaskStarted", { taskId: "system-check:a2" });
  await Promise.resolve();
  await appendEvent(store, events, options.missionId, "FindingSubmitted", { taskId: "system-check:a2", finding: "Recovered system check completed." });
  await appendEvent(store, events, options.missionId, "MissionCompleted", {});

  const persistedEvents = await store.readAll();
  return { events: persistedEvents, state: replay(persistedEvents) };
}

export async function runWalkingSkeletonMission(options: Required<MissionOptions>): Promise<WalkingSkeletonResult> {
  const started = await beginWalkingSkeletonMission(options);
  const store = new JsonlEventStore(options.historyPath);
  const events = started.events;
  await Promise.resolve(); // The deterministic simulated worker has no external dependencies.
  await appendEvent(store, events, options.missionId, "FindingSubmitted", { taskId: "system-check", finding: "System check completed." });
  await appendEvent(store, events, options.missionId, "MissionCompleted", {});

  const persistedEvents = await store.readAll();
  return { events: persistedEvents, state: replay(persistedEvents) };
}
