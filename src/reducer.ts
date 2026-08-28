import type { MissionEvent } from "./contracts.js";

export type MissionStatus = "NOT_STARTED" | "RUNNING" | "COMPLETED";
export type TaskStatus = "SCHEDULED" | "RUNNING" | "COMPLETED" | "INTERRUPTED";

export interface MissionState {
  missionId: string | null;
  lastSequenceNumber: number;
  status: MissionStatus;
  budget: { total: number; committed: number; spent: number; available: number };
  tasks: Record<string, { objective: string; cost: number; status: TaskStatus; finding?: string }>;
}

export const initialMissionState = (): MissionState => ({
  missionId: null,
  lastSequenceNumber: 0,
  status: "NOT_STARTED",
  budget: { total: 0, committed: 0, spent: 0, available: 0 },
  tasks: {},
});

function applyEvent(state: MissionState, event: MissionEvent): MissionState {
  if (state.missionId !== null && event.missionId !== state.missionId) {
    throw new Error("Event belongs to a different mission.");
  }

  switch (event.type) {
    case "MissionCreated":
      if (state.missionId !== null) throw new Error("Mission already exists.");
      return {
        ...state,
        missionId: event.missionId,
        status: "RUNNING",
        budget: { total: event.payload.totalBudget, committed: 0, spent: 0, available: event.payload.totalBudget },
      };
    case "TaskScheduled": {
      if (state.status !== "RUNNING") throw new Error("Cannot schedule work for a non-running mission.");
      if (state.tasks[event.payload.taskId]) throw new Error("Task is already scheduled.");
      return {
        ...state,
        tasks: {
          ...state.tasks,
          [event.payload.taskId]: { ...event.payload, status: "SCHEDULED" },
        },
      };
    }
    case "TaskStarted": {
      const task = state.tasks[event.payload.taskId];
      if (!task || task.status !== "SCHEDULED") throw new Error("Only a scheduled task can start.");
      if (task.cost > state.budget.available) throw new Error("Insufficient available budget.");
      return {
        ...state,
        budget: {
          ...state.budget,
          committed: state.budget.committed + task.cost,
          available: state.budget.available - task.cost,
        },
        tasks: { ...state.tasks, [event.payload.taskId]: { ...task, status: "RUNNING" } },
      };
    }
    case "RecoveryStarted":
      if (state.status !== "RUNNING") throw new Error("Only a running mission can be recovered.");
      return state;
    case "TaskInterrupted": {
      const task = state.tasks[event.payload.taskId];
      if (!task || task.status !== "RUNNING") throw new Error("Only a running task can be interrupted.");
      return {
        ...state,
        budget: { ...state.budget, committed: state.budget.committed - task.cost, spent: state.budget.spent + task.cost },
        tasks: { ...state.tasks, [event.payload.taskId]: { ...task, status: "INTERRUPTED" } },
      };
    }
    case "FindingSubmitted": {
      const task = state.tasks[event.payload.taskId];
      if (!task || task.status !== "RUNNING") throw new Error("Only a running task can submit a finding.");
      return {
        ...state,
        budget: { ...state.budget, committed: state.budget.committed - task.cost, spent: state.budget.spent + task.cost },
        tasks: { ...state.tasks, [event.payload.taskId]: { ...task, status: "COMPLETED", finding: event.payload.finding } },
      };
    }
    case "MissionCompleted":
      if (Object.values(state.tasks).some((task) => task.status === "SCHEDULED" || task.status === "RUNNING")) {
        throw new Error("Cannot complete a mission with unfinished tasks.");
      }
      return { ...state, status: "COMPLETED" };
  }
}

export function reduce(state: MissionState, event: MissionEvent): MissionState {
  const expectedSequenceNumber = state.lastSequenceNumber + 1;
  if (event.sequenceNumber !== expectedSequenceNumber) {
    throw new Error(`Expected sequence number ${expectedSequenceNumber}, received ${event.sequenceNumber}.`);
  }
  return { ...applyEvent(state, event), lastSequenceNumber: event.sequenceNumber };
}

export function replay(events: MissionEvent[]): MissionState {
  return events.reduce(reduce, initialMissionState());
}
