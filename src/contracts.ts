import { z } from "zod";
import { tribunalResultSchema } from "./tribunal-policy.js";
import { evidenceAuditResultSchema } from "./evidence-audit.js";
import { blindReviewResultSchema, divergenceRecordSchema } from "./research-domain.js";

const eventBase = z.object({
  schemaVersion: z.literal(1),
  sequenceNumber: z.number().int().positive(),
  missionId: z.string().min(1),
  eventId: z.string().min(1),
  timestamp: z.string().datetime(),
});

export const workClassSchema = z.enum(["MANDATORY", "OPTIONAL"]);
export type WorkClass = z.infer<typeof workClassSchema>;
export const authorizationReasonSchema = z.enum(["MANDATORY_BASELINE", "GAP_RESOLUTION"]);
export type AuthorizationReason = z.infer<typeof authorizationReasonSchema>;
export const gapDecisionTypeSchema = z.enum(["ELIGIBILITY", "RANKING", "CONFIDENCE", "SAFETY_OR_RISK", "BLOCKING_REVIEW", "CONTRADICTION"]);
export const terminalGapStatusSchema = z.enum(["RESOLVED", "EXHAUSTED", "DECLINED"]);
export type TerminalGapStatus = z.infer<typeof terminalGapStatusSchema>;
export const terminalMissionStatusSchema = z.enum(["COMPLETED_INSUFFICIENT_EVIDENCE", "BLOCKED_POLICY", "BLOCKED_BUDGET", "FAILED_UNRECOVERABLE"]);
export type TerminalMissionStatus = z.infer<typeof terminalMissionStatusSchema>;
export const workerExecutionModeSchema = z.literal("RECORDED_DRY_RUN");
export type WorkerExecutionMode = z.infer<typeof workerExecutionModeSchema>;
export const providerUsageStatusSchema = z.literal("NOT_APPLICABLE");
export type ProviderUsageStatus = z.infer<typeof providerUsageStatusSchema>;
export const subscriptionRuntimeDeclarationSchema = z.object({
  executionEnabled: z.literal(false),
  accessStatus: z.literal("NOT_CHECKED"),
  usageStatus: z.literal("NOT_ITEMIZED"),
}).strict();
export type SubscriptionRuntimeDeclaration = z.infer<typeof subscriptionRuntimeDeclarationSchema>;
const missionCreatedPayloadSchema = z.union([
  z.object({
    totalBudget: z.number().int().positive(),
    missionSeed: z.number().int(),
    policyVersions: z.object({ tribunal: z.string().min(1) }).strict(),
  }).strict(),
  // Legacy schema-version 1 histories predate tribunal events. They remain
  // replayable, but cannot accept TribunalCompleted without a frozen version.
  z.object({ totalBudget: z.number().int().positive(), missionSeed: z.number().int() }).strict(),
]);

export const missionEventSchema = z.discriminatedUnion("type", [
  eventBase.extend({
    type: z.literal("MissionCreated"),
    payload: missionCreatedPayloadSchema,
  }),
  eventBase.extend({ type: z.literal("SubscriptionRuntimeDeclared"), payload: subscriptionRuntimeDeclarationSchema }),
  eventBase.extend({ type: z.literal("TribunalCompleted"), payload: tribunalResultSchema }),
  eventBase.extend({ type: z.literal("AuditCompleted"), payload: evidenceAuditResultSchema }),
  eventBase.extend({ type: z.literal("BlindReviewCompleted"), payload: blindReviewResultSchema }),
  eventBase.extend({ type: z.literal("RankingDivergenceDetected"), payload: z.object({ records: z.array(divergenceRecordSchema.refine((r) => r.type !== "MISSING_EVIDENCE_DIVERGENCE")) }).strict() }),
  eventBase.extend({ type: z.literal("MissingEvidenceDivergenceDetected"), payload: z.object({ records: z.array(divergenceRecordSchema.refine((r) => r.type === "MISSING_EVIDENCE_DIVERGENCE")) }).strict() }),
  eventBase.extend({ type: z.literal("RevisionRequested"), payload: z.object({ revisionId: z.string().min(1), reviewId: z.string().min(1), affectedClaimIds: z.array(z.string().min(1)).min(1), blockingDefectCodes: z.array(z.string().min(1)).min(1) }).strict() }),
  eventBase.extend({ type: z.literal("FocusedReauditCompleted"), payload: z.object({ revisionId: z.string().min(1), auditId: z.string().min(1), changedClaimIds: z.array(z.string().min(1)).min(1), findings: z.array(evidenceAuditResultSchema.shape.findings.element) }).strict() }),
  eventBase.extend({ type: z.literal("FocusedRereviewCompleted"), payload: z.object({ revisionId: z.string().min(1), result: blindReviewResultSchema }).strict() }),
  eventBase.extend({
    type: z.literal("TaskAuthorized"),
    payload: z.object({
      taskId: z.string().min(1),
      objective: z.string().min(1),
      cost: z.number().int().positive(),
      workClass: workClassSchema,
      researchKey: z.string().min(1),
      gapId: z.string().min(1).optional(),
      authorizationReason: authorizationReasonSchema,
      dependencies: z.array(z.string().min(1)),
    }),
  }),
  eventBase.extend({
    type: z.literal("TaskScheduled"),
    payload: z.object({
      taskId: z.string().min(1),
      attemptId: z.string().min(1),
      objective: z.string().min(1),
      cost: z.number().int().positive(),
      workClass: workClassSchema,
      researchKey: z.string().min(1),
      workerRole: z.string().min(1).optional(),
      dependencies: z.array(z.string().min(1)),
    }),
  }),
  eventBase.extend({ type: z.literal("GapOpened"), payload: z.object({ gapId: z.string().min(1), researchKey: z.string().min(1), affectedDecisionType: gapDecisionTypeSchema, reason: z.string().min(1) }) }),
  eventBase.extend({ type: z.literal("GapResolved"), payload: z.object({ gapId: z.string().min(1), reason: z.string().min(1) }) }),
  eventBase.extend({ type: z.literal("GapReopened"), payload: z.object({ gapId: z.string().min(1), reason: z.string().min(1) }) }),
  eventBase.extend({ type: z.literal("GapStatusChanged"), payload: z.object({ gapId: z.string().min(1), status: terminalGapStatusSchema, reason: z.string().min(1) }).strict() }),
  eventBase.extend({
    type: z.literal("BudgetReserved"),
    payload: z.object({ attemptId: z.string().min(1), cost: z.number().int().positive() }),
  }),
  eventBase.extend({
    type: z.literal("TaskStarted"),
    payload: z.object({ attemptId: z.string().min(1), simulatedDelayMs: z.number().int().nonnegative() }),
  }),
  eventBase.extend({
    type: z.literal("WorkerExecutionRecorded"),
    payload: z.object({ attemptId: z.string().min(1), mode: workerExecutionModeSchema, providerUsageStatus: providerUsageStatusSchema }).strict(),
  }),
  eventBase.extend({
    type: z.literal("RecoveryStarted"),
    payload: z.object({ interruptedAttemptIds: z.array(z.string().min(1)).min(1), truncatedFinalLineDiscarded: z.boolean().default(false) }).strict(),
  }),
  eventBase.extend({
    type: z.literal("TaskInterrupted"),
    payload: z.object({ attemptId: z.string().min(1), reason: z.string().min(1) }),
  }),
  eventBase.extend({
    type: z.literal("TaskFailedTransient"),
    payload: z.object({ attemptId: z.string().min(1), reason: z.string().min(1) }),
  }),
  eventBase.extend({
    type: z.literal("TaskFailedPermanent"),
    payload: z.object({ attemptId: z.string().min(1), reason: z.string().min(1) }),
  }),
  eventBase.extend({
    type: z.literal("TransitionRejected"),
    payload: z.object({ attemptedEventType: z.string().min(1), reason: z.string().min(1) }),
  }),
  eventBase.extend({
    type: z.literal("StaleCompletionIgnored"),
    payload: z.object({ attemptId: z.string().min(1), reason: z.string().min(1) }),
  }),
  eventBase.extend({
    type: z.literal("FindingSubmitted"),
    payload: z.object({ attemptId: z.string().min(1), finding: z.string().min(1) }),
  }),
  eventBase.extend({
    type: z.literal("MissionCompleted"),
    payload: z.object({}),
  }),
  eventBase.extend({
    type: z.literal("MissionTerminated"),
    payload: z.object({ status: terminalMissionStatusSchema, reason: z.string().min(1) }).strict(),
  }),
]);

export type MissionEvent = z.infer<typeof missionEventSchema>;
