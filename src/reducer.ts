import type { MissionEvent } from "./contracts.js";

export type MissionStatus = "NOT_STARTED" | "RUNNING" | "COMPLETED";
export type TaskStatus = "SCHEDULED" | "RUNNING" | "COMPLETED" | "INTERRUPTED" | "FAILED_TRANSIENT";
export type AttemptStatus = "SCHEDULED" | "RUNNING" | "COMPLETED" | "INTERRUPTED" | "FAILED_TRANSIENT";

interface TaskRecord {
  objective: string;
  cost: number;
  status: TaskStatus;
  attemptIds: string[];
}

interface AttemptRecord {
  taskId: string;
  status: AttemptStatus;
  finding?: string;
}

export interface MissionState {
  missionId: string | null;
  lastSequenceNumber: number;
  status: MissionStatus;
  budget: { total: number; committed: number; spent: number; available: number };
  tasks: Record<string, TaskRecord>;
  attempts: Record<string, AttemptRecord>;
  rejections: { attemptedEventType: string; reason: string }[];
  staleCompletionAttemptIds: string[];
}

export const initialMissionState = (): MissionState => ({
  missionId: null,
  lastSequenceNumber: 0,
  status: "NOT_STARTED",
  budget: { total: 0, committed: 0, spent: 0, available: 0 },
  tasks: {},
  attempts: {},
  rejections: [],
  staleCompletionAttemptIds: [],
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
      const existingTask = state.tasks[event.payload.taskId];
      if (existingTask && existingTask.status !== "INTERRUPTED") throw new Error("Task cannot receive another attempt.");
      if (state.attempts[event.payload.attemptId]) throw new Error("Attempt is already scheduled.");
      const task: TaskRecord = existingTask
        ? { ...existingTask, status: "SCHEDULED", attemptIds: [...existingTask.attemptIds, event.payload.attemptId] }
        : {
            objective: event.payload.objective,
            cost: event.payload.cost,
            status: "SCHEDULED",
            attemptIds: [event.payload.attemptId],
          };
      return {
        ...state,
        tasks: { ...state.tasks, [event.payload.taskId]: task },
        attempts: { ...state.attempts, [event.payload.attemptId]: { taskId: event.payload.taskId, status: "SCHEDULED" } },
      };
    }
    case "TaskStarted": {
      const attempt = state.attempts[event.payload.attemptId];
      const task = attempt ? state.tasks[attempt.taskId] : undefined;
      if (!attempt || !task || attempt.status !== "SCHEDULED" || task.status !== "SCHEDULED") {
        throw new Error("Only a scheduled attempt can start.");
      }
      if (task.cost > state.budget.available) throw new Error("Insufficient available budget.");
      return {
        ...state,
        budget: {
          ...state.budget,
          committed: state.budget.committed + task.cost,
          available: state.budget.available - task.cost,
        },
        tasks: { ...state.tasks, [attempt.taskId]: { ...task, status: "RUNNING" } },
        attempts: { ...state.attempts, [event.payload.attemptId]: { ...attempt, status: "RUNNING" } },
      };
    }
    case "RecoveryStarted":
      if (state.status !== "RUNNING") throw new Error("Only a running mission can be recovered.");
      return state;
    case "TaskInterrupted": {
      const attempt = state.attempts[event.payload.attemptId];
      const task = attempt ? state.tasks[attempt.taskId] : undefined;
      if (!attempt || !task || attempt.status !== "RUNNING" || task.status !== "RUNNING") {
        throw new Error("Only a running attempt can be interrupted.");
      }
      return {
        ...state,
        budget: { ...state.budget, committed: state.budget.committed - task.cost, spent: state.budget.spent + task.cost },
        tasks: { ...state.tasks, [attempt.taskId]: { ...task, status: "INTERRUPTED" } },
        attempts: { ...state.attempts, [event.payload.attemptId]: { ...attempt, status: "INTERRUPTED" } },
      };
    }
    case "TaskFailedTransient": {
      const attempt = state.attempts[event.payload.attemptId];
      const task = attempt ? state.tasks[attempt.taskId] : undefined;
      if (!attempt || !task || attempt.status !== "RUNNING" || task.status !== "RUNNING") throw new Error("Only a running attempt can fail.");
      return {
        ...state,
        budget: { ...state.budget, committed: state.budget.committed - task.cost, spent: state.budget.spent + task.cost },
        tasks: { ...state.tasks, [attempt.taskId]: { ...task, status: "FAILED_TRANSIENT" } },
        attempts: { ...state.attempts, [event.payload.attemptId]: { ...attempt, status: "FAILED_TRANSIENT" } },
      };
    }
    case "TransitionRejected":
      return { ...state, rejections: [...state.rejections, event.payload] };
    case "StaleCompletionIgnored":
      return { ...state, staleCompletionAttemptIds: [...state.staleCompletionAttemptIds, event.payload.attemptId] };
    case "FindingSubmitted": {
      const attempt = state.attempts[event.payload.attemptId];
      const task = attempt ? state.tasks[attempt.taskId] : undefined;
      if (!attempt || !task || attempt.status !== "RUNNING" || task.status !== "RUNNING") {
        throw new Error("Only a running attempt can submit a finding.");
      }
      return {
        ...state,
        budget: { ...state.budget, committed: state.budget.committed - task.cost, spent: state.budget.spent + task.cost },
        tasks: { ...state.tasks, [attempt.taskId]: { ...task, status: "COMPLETED" } },
        attempts: { ...state.attempts, [event.payload.attemptId]: { ...attempt, status: "COMPLETED", finding: event.payload.finding } },
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
