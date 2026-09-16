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
export const subscriptionRuntimePreflightStatusSchema = z.enum(["CHATGPT_AUTHENTICATED", "AUTHENTICATION_REQUIRED", "UNSUPPORTED_AUTH_MODE", "UNAVAILABLE"]);
export type SubscriptionRuntimePreflightStatus = z.infer<typeof subscriptionRuntimePreflightStatusSchema>;
export const subscriptionRuntimePreflightDiagnosticCodeSchema = z.enum([
  "NOT_APPLICABLE",
  "APP_SERVER_START_FAILED",
  "INITIALIZATION_FAILED",
  "INITIALIZATION_TIMED_OUT",
  "APP_SERVER_EXITED_DURING_INITIALIZATION",
  "INITIALIZATION_REJECTED",
  "INITIALIZATION_RESPONSE_INVALID",
  "ACCOUNT_READ_FAILED",
  "ACCOUNT_READ_TIMED_OUT",
  "ACCOUNT_RESPONSE_INVALID",
]);
export type SubscriptionRuntimePreflightDiagnosticCode = z.infer<typeof subscriptionRuntimePreflightDiagnosticCodeSchema>;
const subscriptionRuntimePreflightBaseSchema = z.object({
  accessStatus: subscriptionRuntimePreflightStatusSchema,
  usageStatus: z.literal("NOT_ITEMIZED"),
}).strict();
export const subscriptionRuntimePreflightSchema = z.union([
  // Existing persisted histories remain replayable. New runtime events always
  // include a closed diagnostic code and never persist the underlying error.
  subscriptionRuntimePreflightBaseSchema,
  subscriptionRuntimePreflightBaseSchema.extend({
    accessStatus: z.enum(["CHATGPT_AUTHENTICATED", "AUTHENTICATION_REQUIRED", "UNSUPPORTED_AUTH_MODE"]),
    diagnosticCode: z.literal("NOT_APPLICABLE"),
  }).strict(),
  subscriptionRuntimePreflightBaseSchema.extend({
    accessStatus: z.literal("UNAVAILABLE"),
    diagnosticCode: subscriptionRuntimePreflightDiagnosticCodeSchema.exclude(["NOT_APPLICABLE"]),
  }).strict(),
]);
export type SubscriptionRuntimePreflight = z.infer<typeof subscriptionRuntimePreflightSchema>;
export const subscriptionWorkerExecutionOutcomeSchema = z.object({
  attemptId: z.string().min(1),
  outcome: z.enum(["COMPLETED", "TIMEOUT", "UNAVAILABLE", "APPROVAL_DECLINED", "INTERRUPTED", "INVALID_RESULT", "TURN_FAILED"]),
  providerUsageStatus: z.literal("UNKNOWN"),
  elapsedMs: z.number().int().nonnegative().max(90_000),
}).strict();
export type SubscriptionWorkerExecutionOutcome = z.infer<typeof subscriptionWorkerExecutionOutcomeSchema>;
export const googleTrendsEvidenceSchema = z.object({
  attemptId: z.string().min(1),
  sourceUrl: z.literal("https://trends.google.com/trending/rss?geo=US"),
  geo: z.literal("US"),
  attribution: z.literal("Google Trends"),
  retrievedAt: z.string().datetime(),
  items: z.array(z.object({ query: z.string().min(1).max(160), traffic: z.string().min(1).max(80) }).strict()).min(1).max(10),
}).strict();
export type GoogleTrendsEvidence = z.infer<typeof googleTrendsEvidenceSchema>;
export const googleTrendsComparisonTerms = ["desk cable organizer", "under-desk cable tray", "cable management box"] as const;
const googleTrendsComparisonTermSchema = z.enum(googleTrendsComparisonTerms);
export function isGoogleTrendsComparisonPeriod(period: string, granularity: "WEEK" | "MONTH"): boolean {
  if (granularity === "MONTH") {
    const match = /^(\d{4})-(\d{2})$/.exec(period);
    return match !== null && Number(match[2]) >= 1 && Number(match[2]) <= 12;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(period);
  if (match === null) return false;
  const date = new Date(`${period}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() + 1 === Number(match[2]) && date.getUTCDate() === Number(match[3]);
}
export const googleTrendsComparisonEvidenceSchema = z.object({
  attemptId: z.string().min(1),
  sourceUrl: z.literal("https://trends.google.com/trends/explore"),
  geo: z.literal("US"),
  searchType: z.literal("WEB_SEARCH"),
  timeframe: z.literal("PAST_12_MONTHS"),
  attribution: z.literal("Google Trends"),
  importedAt: z.string().datetime(),
  granularity: z.enum(["WEEK", "MONTH"]),
  periods: z.array(z.string().min(1).max(16)).min(1).max(53),
  series: z.array(z.object({ term: googleTrendsComparisonTermSchema, values: z.array(z.number().int().min(0).max(100)).min(1).max(53) }).strict()).length(3),
}).strict().superRefine((evidence, context) => {
  const maxPoints = evidence.granularity === "WEEK" ? 53 : 13;
  if (evidence.periods.length > maxPoints || evidence.periods.some((period) => !isGoogleTrendsComparisonPeriod(period, evidence.granularity)) || new Set(evidence.periods).size !== evidence.periods.length) {
    context.addIssue({ code: "custom", path: ["periods"], message: "Comparison periods must be unique and match the declared granularity." });
  }
  if (evidence.series.map((series) => series.term).join("|") !== googleTrendsComparisonTerms.join("|")) {
    context.addIssue({ code: "custom", path: ["series"], message: "Comparison series must match the approved term order." });
  }
  if (evidence.series.some((series) => series.values.length !== evidence.periods.length)) {
    context.addIssue({ code: "custom", path: ["series"], message: "Each comparison series must have one value for every period." });
  }
});
export type GoogleTrendsComparisonEvidence = z.infer<typeof googleTrendsComparisonEvidenceSchema>;
export const googleTrendsCaptureFailureSchema = z.object({
  attemptId: z.string().min(1),
  outcome: z.enum(["UNAVAILABLE", "TIMED_OUT", "INVALID_RESPONSE", "RESPONSE_TOO_LARGE"]),
}).strict();
export type GoogleTrendsCaptureFailure = z.infer<typeof googleTrendsCaptureFailureSchema>;
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
  eventBase.extend({ type: z.literal("SubscriptionRuntimePreflightCompleted"), payload: subscriptionRuntimePreflightSchema }),
  eventBase.extend({ type: z.literal("SubscriptionWorkerExecutionOutcomeRecorded"), payload: subscriptionWorkerExecutionOutcomeSchema }),
  eventBase.extend({ type: z.literal("GoogleTrendsEvidenceCaptured"), payload: googleTrendsEvidenceSchema }),
  eventBase.extend({ type: z.literal("GoogleTrendsComparisonImported"), payload: googleTrendsComparisonEvidenceSchema }),
  eventBase.extend({ type: z.literal("GoogleTrendsCaptureFailed"), payload: googleTrendsCaptureFailureSchema }),
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
