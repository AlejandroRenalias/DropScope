import type { AuthorizationReason, MissionEvent, ProviderUsageStatus, SubscriptionRuntimeDeclaration, SubscriptionRuntimePreflight, TerminalMissionStatus, TerminalGapStatus, WorkClass, WorkerExecutionMode } from "./contracts.js";
import type { TribunalResult } from "./tribunal-policy.js";
import type { EvidenceAuditFinding } from "./evidence-audit.js";
import type { BlindReviewResult, DivergenceRecord } from "./research-domain.js";

export type MissionStatus = "NOT_STARTED" | "RUNNING" | "COMPLETED" | TerminalMissionStatus;
export type TaskStatus = "SCHEDULED" | "RUNNING" | "COMPLETED" | "INTERRUPTED" | "FAILED_TRANSIENT" | "FAILED_PERMANENT";
export type AttemptStatus = "SCHEDULED" | "RUNNING" | "COMPLETED" | "INTERRUPTED" | "FAILED_TRANSIENT" | "FAILED_PERMANENT";

interface TaskRecord {
  objective: string;
  cost: number;
  workClass: WorkClass;
  researchKey: string;
  status: TaskStatus;
  attemptIds: string[];
}

interface AttemptRecord {
  taskId: string;
  workerRole: string;
  status: AttemptStatus;
  reserved: boolean;
  finding?: string;
}

export interface WorkerExecutionProvenance {
  mode: WorkerExecutionMode;
  providerUsageStatus: ProviderUsageStatus;
}

interface AuthorizationRecord {
  objective: string;
  cost: number;
  workClass: WorkClass;
  researchKey: string;
  gapId?: string;
  authorizationReason: AuthorizationReason;
  dependencies: string[];
}
type GapStatus = "OPEN" | "RESOLVED" | "REOPENED" | TerminalGapStatus;
interface GapRecord { researchKey: string; affectedDecisionType: string; status: GapStatus; reason: string; }

export interface MissionState {
  missionId: string | null;
  lastSequenceNumber: number;
  status: MissionStatus;
  budget: { total: number; reserved: number; committed: number; spent: number; available: number };
  tasks: Record<string, TaskRecord>;
  attempts: Record<string, AttemptRecord>;
  workerExecutionProvenance: Record<string, WorkerExecutionProvenance>;
  subscriptionRuntimeDeclaration?: SubscriptionRuntimeDeclaration;
  subscriptionRuntimePreflight?: SubscriptionRuntimePreflight;
  authorizations: Record<string, AuthorizationRecord>;
  gaps: Record<string, GapRecord>;
  policyVersions: { tribunal: string } | null;
  tribunalResults: Record<string, TribunalResult>;
  auditResults: Record<string, { auditId: string; findings: EvidenceAuditFinding[] }>;
  blindReviewResults: Record<string, BlindReviewResult>;
  divergenceRecords: Record<string, DivergenceRecord>;
  rejections: { attemptedEventType: string; reason: string }[];
  staleCompletionAttemptIds: string[];
  recoveryRestartCount: number;
  revision: { revisionId: string; reviewId: string; affectedClaimIds: string[]; blockingDefectCodes: string[]; reaudit?: unknown; rereview?: BlindReviewResult } | null;
}

export const initialMissionState = (): MissionState => ({
  missionId: null,
  lastSequenceNumber: 0,
  status: "NOT_STARTED",
  budget: { total: 0, reserved: 0, committed: 0, spent: 0, available: 0 },
  tasks: {},
  attempts: {},
  workerExecutionProvenance: {},
  authorizations: {},
  gaps: {},
  policyVersions: null,
  tribunalResults: {},
  auditResults: {}, blindReviewResults: {}, divergenceRecords: {},
  rejections: [],
  staleCompletionAttemptIds: [],
  recoveryRestartCount: 0,
  revision: null,
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
        policyVersions: "policyVersions" in event.payload ? event.payload.policyVersions : null,
        budget: { total: event.payload.totalBudget, reserved: 0, committed: 0, spent: 0, available: event.payload.totalBudget },
      };
    case "TribunalCompleted":
      if (state.status !== "RUNNING" || state.policyVersions === null) throw new Error("A running mission is required to record tribunal output.");
      if (event.payload.decidedByPolicyVersion !== state.policyVersions.tribunal) throw new Error("Tribunal result policy version does not match the mission.");
      if (Object.hasOwn(state.tribunalResults, event.payload.tribunalId)) throw new Error("Tribunal result is already recorded.");
      return { ...state, tribunalResults: { ...state.tribunalResults, [event.payload.tribunalId]: event.payload } };
    case "SubscriptionRuntimeDeclared":
      if (state.status !== "RUNNING") throw new Error("A running mission is required to declare subscription runtime status.");
      if (state.subscriptionRuntimeDeclaration) throw new Error("Subscription runtime declaration is already recorded.");
      return { ...state, subscriptionRuntimeDeclaration: event.payload };
    case "SubscriptionRuntimePreflightCompleted":
      if (!state.subscriptionRuntimeDeclaration) throw new Error("Subscription runtime must be declared before a preflight.");
      if (state.subscriptionRuntimePreflight) throw new Error("Subscription runtime preflight is already recorded.");
      return { ...state, subscriptionRuntimePreflight: event.payload };
    case "AuditCompleted":
      if (state.status !== "RUNNING" || Object.hasOwn(state.auditResults, event.payload.auditId)) throw new Error("Audit result cannot be recorded.");
      return { ...state, auditResults: { ...state.auditResults, [event.payload.auditId]: event.payload } };
    case "BlindReviewCompleted":
      if (state.status !== "RUNNING" || Object.hasOwn(state.blindReviewResults, event.payload.reviewId) || state.revision?.rereview?.reviewId === event.payload.reviewId) throw new Error("Blind review result cannot be recorded.");
      return { ...state, blindReviewResults: { ...state.blindReviewResults, [event.payload.reviewId]: event.payload } };
    case "RankingDivergenceDetected":
    case "MissingEvidenceDivergenceDetected": {
      const ids = event.payload.records.map((record) => record.divergenceId);
      if (state.status !== "RUNNING" || new Set(ids).size !== ids.length || ids.some((id) => Object.hasOwn(state.divergenceRecords, id))) throw new Error("Divergence result cannot be recorded.");
      return { ...state, divergenceRecords: { ...state.divergenceRecords, ...Object.fromEntries(event.payload.records.map((record) => [record.divergenceId, record])) } };
    }
    case "RevisionRequested":
      if (state.status !== "RUNNING" || !Object.hasOwn(state.blindReviewResults, event.payload.reviewId)) throw new Error("Revision requires one recorded review.");
      if (state.revision !== null) throw new Error("Only one revision cycle may be recorded.");
      return { ...state, revision: { ...event.payload } };
    case "FocusedReauditCompleted":
      if (state.status !== "RUNNING" || !state.revision || state.revision.revisionId !== event.payload.revisionId || state.revision.reaudit || new Set(event.payload.changedClaimIds).size !== event.payload.changedClaimIds.length || event.payload.changedClaimIds.some((id) => !state.revision!.affectedClaimIds.includes(id))) throw new Error("Focused re-audit requires the active revision.");
      return { ...state, revision: { ...state.revision, reaudit: event.payload } };
    case "FocusedRereviewCompleted":
      if (state.status !== "RUNNING" || !state.revision || state.revision.revisionId !== event.payload.revisionId || !state.revision.reaudit || state.revision.rereview || Object.hasOwn(state.blindReviewResults, event.payload.result.reviewId)) throw new Error("Focused re-review requires the completed focused re-audit.");
      return { ...state, revision: { ...state.revision, rereview: event.payload.result } };
    case "TaskAuthorized": {
      const proposal = event.payload;
      if (state.status !== "RUNNING") throw new Error("Cannot authorize work for a non-running mission.");
      if (state.authorizations[proposal.taskId]) throw new Error("Task is already authorized.");
      if (proposal.workClass === "MANDATORY" && proposal.authorizationReason !== "MANDATORY_BASELINE") {
        throw new Error("Mandatory work requires a baseline authorization.");
      }
      if (proposal.workClass === "OPTIONAL" && proposal.authorizationReason !== "GAP_RESOLUTION") {
        throw new Error("Optional work requires a gap-resolution authorization.");
      }
      if (proposal.authorizationReason === "GAP_RESOLUTION") {
        const gap = proposal.gapId ? state.gaps[proposal.gapId] : undefined;
        if (!gap || !["OPEN", "REOPENED"].includes(gap.status) || gap.researchKey !== proposal.researchKey) {
          throw new Error("Gap-resolution work requires a matching actionable gap.");
        }
      }
      if (proposal.dependencies.some((dependency) => state.tasks[dependency]?.status !== "COMPLETED")) {
        throw new Error("All task dependencies must be completed before authorization.");
      }
      if (
        Object.values(state.authorizations).some((authorization) => authorization.researchKey === proposal.researchKey)
        || Object.values(state.tasks).some((task) => task.researchKey === proposal.researchKey && ["SCHEDULED", "RUNNING", "COMPLETED"].includes(task.status))
      ) {
        throw new Error("An active or completed task already covers this research key.");
      }
      if (
        proposal.workClass === "OPTIONAL"
        && state.budget.spent + state.budget.committed + state.budget.reserved + proposal.cost + remainingMandatoryUnreservedCost(state) > state.budget.total
      ) {
        throw new Error("Optional work would consume mandatory budget protection.");
      }
      return { ...state, authorizations: { ...state.authorizations, [proposal.taskId]: proposal } };
    }
    case "GapOpened":
      if (state.status !== "RUNNING") throw new Error("Cannot open a gap for a non-running mission.");
      if (state.gaps[event.payload.gapId]) throw new Error("Gap already exists.");
      return { ...state, gaps: { ...state.gaps, [event.payload.gapId]: { researchKey: event.payload.researchKey, affectedDecisionType: event.payload.affectedDecisionType, status: "OPEN", reason: event.payload.reason } } };
    case "GapResolved": {
      if (state.status !== "RUNNING") throw new Error("Cannot resolve a gap for a non-running mission.");
      const gap = state.gaps[event.payload.gapId];
      if (!gap || !["OPEN", "REOPENED"].includes(gap.status)) throw new Error("Only an actionable gap can be resolved.");
      return { ...state, gaps: { ...state.gaps, [event.payload.gapId]: { ...gap, status: "RESOLVED", reason: event.payload.reason } } };
    }
    case "GapReopened": {
      if (state.status !== "RUNNING") throw new Error("Cannot reopen a gap for a non-running mission.");
      const gap = state.gaps[event.payload.gapId];
      if (!gap || gap.status !== "RESOLVED") throw new Error("Only a resolved gap can be reopened.");
      return { ...state, gaps: { ...state.gaps, [event.payload.gapId]: { ...gap, status: "REOPENED", reason: event.payload.reason } } };
    }
    case "GapStatusChanged": {
      if (state.status !== "RUNNING") throw new Error("Cannot change a gap for a non-running mission.");
      const gap = state.gaps[event.payload.gapId];
      if (!gap || !["OPEN", "REOPENED"].includes(gap.status)) throw new Error("Only an actionable gap can change status.");
      return { ...state, gaps: { ...state.gaps, [event.payload.gapId]: { ...gap, status: event.payload.status, reason: event.payload.reason } } };
    }
    case "TaskScheduled": {
      if (state.status !== "RUNNING") throw new Error("Cannot schedule work for a non-running mission.");
      const authorization = state.authorizations[event.payload.taskId];
      if (!authorization) throw new Error("Task requires Commander authorization before scheduling.");
      if (
        authorization.objective !== event.payload.objective
        || authorization.cost !== event.payload.cost
        || authorization.workClass !== event.payload.workClass
        || authorization.researchKey !== event.payload.researchKey
        || authorization.dependencies.join("\u0000") !== event.payload.dependencies.join("\u0000")
      ) throw new Error("Scheduled task does not match its Commander authorization.");
      if (event.payload.dependencies.some((dependency) => state.tasks[dependency]?.status !== "COMPLETED")) {
        throw new Error("All task dependencies must be completed before scheduling.");
      }
      const existingTask = state.tasks[event.payload.taskId];
      if (existingTask && !["INTERRUPTED", "FAILED_TRANSIENT", "FAILED_PERMANENT"].includes(existingTask.status)) throw new Error("Task cannot receive another attempt.");
      if (existingTask?.status === "FAILED_TRANSIENT" && existingTask.attemptIds.filter((attemptId) => state.attempts[attemptId]?.status === "FAILED_TRANSIENT").length >= 2) throw new Error("Transient retry allowance is exhausted.");
      if (existingTask && existingTask.workClass !== event.payload.workClass) throw new Error("A retry cannot change a task's work class.");
      if (Object.hasOwn(state.attempts, event.payload.attemptId)) throw new Error("Attempt is already scheduled.");
      const workerRole = event.payload.workerRole ?? "legacy-unknown";
      if (existingTask?.status === "FAILED_PERMANENT" && existingTask.attemptIds.some((attemptId) => state.attempts[attemptId]?.workerRole === workerRole)) {
        throw new Error("A permanent failure cannot be retried with the same worker.");
      }
      const task: TaskRecord = existingTask
        ? { ...existingTask, status: "SCHEDULED", attemptIds: [...existingTask.attemptIds, event.payload.attemptId] }
        : {
            objective: event.payload.objective,
            cost: event.payload.cost,
            workClass: event.payload.workClass,
            researchKey: event.payload.researchKey,
            status: "SCHEDULED",
            attemptIds: [event.payload.attemptId],
          };
      return {
        ...state,
        tasks: { ...state.tasks, [event.payload.taskId]: task },
        attempts: { ...state.attempts, [event.payload.attemptId]: { taskId: event.payload.taskId, workerRole, status: "SCHEDULED", reserved: false } },
      };
    }
    case "TaskStarted": {
      const attempt = state.attempts[event.payload.attemptId];
      const task = attempt ? state.tasks[attempt.taskId] : undefined;
      if (state.status !== "RUNNING" || !attempt || !task || attempt.status !== "SCHEDULED" || task.status !== "SCHEDULED") {
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
    case "WorkerExecutionRecorded": {
      const attempt = state.attempts[event.payload.attemptId];
      const task = attempt ? state.tasks[attempt.taskId] : undefined;
      if (state.status !== "RUNNING" || !attempt || !task || attempt.status !== "RUNNING" || task.status !== "RUNNING") {
        throw new Error("Only a running attempt can record worker execution provenance.");
      }
      if (Object.hasOwn(state.workerExecutionProvenance, event.payload.attemptId)) {
        throw new Error("Worker execution provenance was already recorded for this attempt.");
      }
      return {
        ...state,
        workerExecutionProvenance: {
          ...state.workerExecutionProvenance,
          [event.payload.attemptId]: { mode: event.payload.mode, providerUsageStatus: event.payload.providerUsageStatus },
        },
      };
    }
    case "BudgetReserved": {
      const attempt = state.attempts[event.payload.attemptId];
      const task = attempt ? state.tasks[attempt.taskId] : undefined;
      if (state.status !== "RUNNING" || !attempt || !task || attempt.status !== "SCHEDULED" || attempt.reserved || event.payload.cost !== task.cost) {
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
      if (state.recoveryRestartCount >= 1) throw new Error("Mission recovery restart cap reached.");
      const runningAttemptIds = Object.entries(state.attempts).filter(([, attempt]) => attempt.status === "RUNNING").map(([attemptId]) => attemptId);
      if (new Set(event.payload.interruptedAttemptIds).size !== event.payload.interruptedAttemptIds.length
        || event.payload.interruptedAttemptIds.length !== runningAttemptIds.length
        || event.payload.interruptedAttemptIds.some((attemptId) => !runningAttemptIds.includes(attemptId))) throw new Error("Recovery must name each current running attempt exactly once.");
      return { ...state, recoveryRestartCount: state.recoveryRestartCount + 1 };
    case "TaskInterrupted": {
      const attempt = state.attempts[event.payload.attemptId];
      const task = attempt ? state.tasks[attempt.taskId] : undefined;
      if (state.status !== "RUNNING" || !attempt || !task || attempt.status !== "RUNNING" || task.status !== "RUNNING") {
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
      if (state.status !== "RUNNING" || !attempt || !task || attempt.status !== "RUNNING" || task.status !== "RUNNING") throw new Error("Only a running attempt can fail.");
      return {
        ...state,
        budget: { ...state.budget, committed: state.budget.committed - task.cost, spent: state.budget.spent + task.cost },
        tasks: { ...state.tasks, [attempt.taskId]: { ...task, status: "FAILED_TRANSIENT" } },
        attempts: { ...state.attempts, [event.payload.attemptId]: { ...attempt, status: "FAILED_TRANSIENT" } },
      };
    }
    case "TaskFailedPermanent": {
      const attempt = state.attempts[event.payload.attemptId];
      const task = attempt ? state.tasks[attempt.taskId] : undefined;
      if (state.status !== "RUNNING" || !attempt || !task || attempt.status !== "RUNNING" || task.status !== "RUNNING") throw new Error("Only a running attempt can fail.");
      return {
        ...state,
        budget: { ...state.budget, committed: state.budget.committed - task.cost, spent: state.budget.spent + task.cost },
        tasks: { ...state.tasks, [attempt.taskId]: { ...task, status: "FAILED_PERMANENT" } },
        attempts: { ...state.attempts, [event.payload.attemptId]: { ...attempt, status: "FAILED_PERMANENT" } },
      };
    }
    case "TransitionRejected":
      return { ...state, rejections: [...state.rejections, event.payload] };
    case "StaleCompletionIgnored":
      return { ...state, staleCompletionAttemptIds: [...state.staleCompletionAttemptIds, event.payload.attemptId] };
    case "FindingSubmitted": {
      const attempt = state.attempts[event.payload.attemptId];
      const task = attempt ? state.tasks[attempt.taskId] : undefined;
      if (state.status !== "RUNNING" || !attempt || !task || attempt.status !== "RUNNING" || task.status !== "RUNNING") {
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
      if (state.status !== "RUNNING") throw new Error("Only a running mission can finish.");
      if (state.revision && (!state.revision.reaudit || !state.revision.rereview || state.revision.rereview.verdict !== "ACCEPT")) throw new Error("Cannot complete a mission with an unfinished or unaccepted revision.");
      if (Object.values(state.tasks).some((task) => task.status === "SCHEDULED" || task.status === "RUNNING" || task.status === "FAILED_PERMANENT")) {
        throw new Error("Cannot complete a mission with unfinished tasks.");
      }
      return { ...state, status: "COMPLETED" };
    case "MissionTerminated":
      if (state.status !== "RUNNING") throw new Error("Only a running mission can terminate.");
      if (event.payload.status === "COMPLETED_INSUFFICIENT_EVIDENCE") {
        const mandatoryAuthorizations = Object.entries(state.authorizations).filter(([, authorization]) => authorization.workClass === "MANDATORY");
        if (mandatoryAuthorizations.length === 0 || mandatoryAuthorizations.some(([taskId]) => state.tasks[taskId]?.status !== "COMPLETED") || Object.values(state.tasks).some((task) => task.status !== "COMPLETED")) {
          throw new Error("Insufficient-evidence termination requires completed baseline research.");
        }
        if (state.revision && (!state.revision.reaudit || !state.revision.rereview || state.revision.rereview.verdict !== "ACCEPT")) throw new Error("Cannot terminate a mission with an unfinished or unaccepted revision.");
        if (Object.values(state.gaps).some((gap) => gap.status === "OPEN" || gap.status === "REOPENED")) {
          throw new Error("Insufficient-evidence termination requires all actionable gaps to be resolved.");
        }
      }
      return { ...state, status: event.payload.status };
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
