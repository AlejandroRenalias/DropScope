import { z } from "zod";

const eventBase = z.object({
  schemaVersion: z.literal(1),
  sequenceNumber: z.number().int().positive(),
  missionId: z.string().min(1),
  eventId: z.string().min(1),
  timestamp: z.string().datetime(),
});

export const missionEventSchema = z.discriminatedUnion("type", [
  eventBase.extend({
    type: z.literal("MissionCreated"),
    payload: z.object({ totalBudget: z.number().int().positive() }),
  }),
  eventBase.extend({
    type: z.literal("TaskScheduled"),
    payload: z.object({
      taskId: z.string().min(1),
      attemptId: z.string().min(1),
      objective: z.string().min(1),
      cost: z.number().int().positive(),
    }),
  }),
  eventBase.extend({
    type: z.literal("TaskStarted"),
    payload: z.object({ attemptId: z.string().min(1) }),
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
    type: z.literal("TransitionRejected"),
    payload: z.object({ attemptedEventType: z.string().min(1), reason: z.string().min(1) }),
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
