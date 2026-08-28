import type { MissionEvent, WorkClass } from "./contracts.js";

export type MissionStatus = "NOT_STARTED" | "RUNNING" | "COMPLETED";
export type TaskStatus = "SCHEDULED" | "RUNNING" | "COMPLETED" | "INTERRUPTED" | "FAILED_TRANSIENT";
export type AttemptStatus = "SCHEDULED" | "RUNNING" | "COMPLETED" | "INTERRUPTED" | "FAILED_TRANSIENT";

interface TaskRecord {
  objective: string;
  cost: number;
  workClass: WorkClass;
  status: TaskStatus;
  attemptIds: string[];
}

interface AttemptRecord {
  taskId: string;
  status: AttemptStatus;
  reserved: boolean;
  finding?: string;
}

export interface MissionState {
  missionId: string | null;
  lastSequenceNumber: number;
  status: MissionStatus;
  budget: { total: number; reserved: number; committed: number; spent: number; available: number };
  tasks: Record<string, TaskRecord>;
  attempts: Record<string, AttemptRecord>;
  rejections: { attemptedEventType: string; reason: string }[];
  staleCompletionAttemptIds: string[];
}

export const initialMissionState = (): MissionState => ({
  missionId: null,
  lastSequenceNumber: 0,
  status: "NOT_STARTED",
  budget: { total: 0, reserved: 0, committed: 0, spent: 0, available: 0 },
  tasks: {},
  attempts: {},
  rejections: [],
  staleCompletionAttemptIds: [],
});

export function remainingMandatoryUnreservedCost(state: MissionState): number {
  return Object.values(state.attempts).reduce((total, attempt) => {
    const task = state.tasks[attempt.taskId];
    return total + (task?.workClass === "MANDATORY" && attempt.status === "SCHEDULED" && !attempt.reserved ? task.cost : 0);
  }, 0);
}

export function protectedMandatoryBudget(state: MissionState): number {
  const mandatoryReserved = Object.values(state.attempts).reduce((total, attempt) => {
    const task = state.tasks[attempt.taskId];
    return total + (task?.workClass === "MANDATORY" && attempt.status === "SCHEDULED" && attempt.reserved ? task.cost : 0);
  }, 0);
  return mandatoryReserved + remainingMandatoryUnreservedCost(state);
}

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
        budget: { total: event.payload.totalBudget, reserved: 0, committed: 0, spent: 0, available: event.payload.totalBudget },
      };
    case "TaskScheduled": {
      if (state.status !== "RUNNING") throw new Error("Cannot schedule work for a non-running mission.");
      const existingTask = state.tasks[event.payload.taskId];
      if (existingTask && existingTask.status !== "INTERRUPTED") throw new Error("Task cannot receive another attempt.");
      if (existingTask && existingTask.workClass !== event.payload.workClass) throw new Error("A retry cannot change a task's work class.");
      if (state.attempts[event.payload.attemptId]) throw new Error("Attempt is already scheduled.");
      const task: TaskRecord = existingTask
        ? { ...existingTask, status: "SCHEDULED", attemptIds: [...existingTask.attemptIds, event.payload.attemptId] }
        : {
            objective: event.payload.objective,
            cost: event.payload.cost,
            workClass: event.payload.workClass,
            status: "SCHEDULED",
            attemptIds: [event.payload.attemptId],
          };
      return {
        ...state,
        tasks: { ...state.tasks, [event.payload.taskId]: task },
        attempts: { ...state.attempts, [event.payload.attemptId]: { taskId: event.payload.taskId, status: "SCHEDULED", reserved: false } },
      };
    }
    case "TaskStarted": {
      const attempt = state.attempts[event.payload.attemptId];
      const task = attempt ? state.tasks[attempt.taskId] : undefined;
      if (!attempt || !task || attempt.status !== "SCHEDULED" || task.status !== "SCHEDULED") {
        throw new Error("Only a scheduled attempt can start.");
      }
      if (!attempt.reserved || task.cost > state.budget.reserved) throw new Error("Attempt has no sufficient reserved budget.");
      return {
        ...state,
        budget: {
          ...state.budget,
          reserved: state.budget.reserved - task.cost,
          committed: state.budget.committed + task.cost,
        },
        tasks: { ...state.tasks, [attempt.taskId]: { ...task, status: "RUNNING" } },
        attempts: { ...state.attempts, [event.payload.attemptId]: { ...attempt, status: "RUNNING", reserved: false } },
      };
    }
    case "BudgetReserved": {
      const attempt = state.attempts[event.payload.attemptId];
      const task = attempt ? state.tasks[attempt.taskId] : undefined;
      if (!attempt || !task || attempt.status !== "SCHEDULED" || attempt.reserved || event.payload.cost !== task.cost) {
        throw new Error("Only a scheduled attempt can reserve its exact cost.");
      }
      if (task.cost > state.budget.available) throw new Error("Insufficient available budget.");
      if (
        task.workClass === "OPTIONAL"
        && state.budget.spent + state.budget.committed + state.budget.reserved + task.cost + remainingMandatoryUnreservedCost(state) > state.budget.total
      ) {
        throw new Error("Optional work would consume mandatory budget protection.");
      }
      return {
        ...state,
        budget: { ...state.budget, reserved: state.budget.reserved + task.cost, available: state.budget.available - task.cost },
        attempts: { ...state.attempts, [event.payload.attemptId]: { ...attempt, reserved: true } },
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
  const nextState = { ...applyEvent(state, event), lastSequenceNumber: event.sequenceNumber };
  const { total, reserved, committed, spent, available } = nextState.budget;
  if (available !== total - reserved - committed - spent) throw new Error("Budget ledger invariant violated.");
  return nextState;
}

export function replay(events: MissionEvent[]): MissionState {
  return events.reduce(reduce, initialMissionState());
}
