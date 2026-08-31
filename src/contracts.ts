import { z } from "zod";
import { tribunalResultSchema } from "./tribunal-policy.js";

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

export const missionEventSchema = z.discriminatedUnion("type", [
  eventBase.extend({
    type: z.literal("MissionCreated"),
    payload: z.object({
      totalBudget: z.number().int().positive(),
      missionSeed: z.number().int(),
      policyVersions: z.object({ tribunal: z.string().min(1) }).strict(),
    }).strict(),
  }),
  eventBase.extend({ type: z.literal("TribunalCompleted"), payload: tribunalResultSchema }),
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
      dependencies: z.array(z.string().min(1)),
    }),
  }),
  eventBase.extend({ type: z.literal("GapOpened"), payload: z.object({ gapId: z.string().min(1), researchKey: z.string().min(1), affectedDecisionType: gapDecisionTypeSchema, reason: z.string().min(1) }) }),
  eventBase.extend({ type: z.literal("GapResolved"), payload: z.object({ gapId: z.string().min(1), reason: z.string().min(1) }) }),
  eventBase.extend({ type: z.literal("GapReopened"), payload: z.object({ gapId: z.string().min(1), reason: z.string().min(1) }) }),
  eventBase.extend({
    type: z.literal("BudgetReserved"),
    payload: z.object({ attemptId: z.string().min(1), cost: z.number().int().positive() }),
  }),
  eventBase.extend({
    type: z.literal("TaskStarted"),
    payload: z.object({ attemptId: z.string().min(1), simulatedDelayMs: z.number().int().nonnegative() }),
  }),
  eventBase.extend({
    type: z.literal("RecoveryStarted"),
    payload: z.object({ interruptedAttemptIds: z.array(z.string().min(1)).min(1) }),
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
]);

export type MissionEvent = z.infer<typeof missionEventSchema>;
