import { describe, expect, it } from "vitest";
import { missionEventSchema, type MissionEvent } from "../src/contracts.js";
import { replay } from "../src/reducer.js";

const event = <T extends MissionEvent["type"]>(sequenceNumber: number, type: T, payload: Extract<MissionEvent, { type: T }> ["payload"]): Extract<MissionEvent, { type: T }> => ({
  schemaVersion: 1,
  sequenceNumber,
  missionId: "provenance-demo",
  eventId: `provenance-demo-${sequenceNumber}`,
  timestamp: `2026-09-10T00:00:${String(sequenceNumber).padStart(2, "0")}.000Z`,
  type,
  payload,
} as Extract<MissionEvent, { type: T }>);

const startedAttempt = (attemptId = "recorded:a1") => [
  event(1, "MissionCreated", { totalBudget: 20, missionSeed: 1, policyVersions: { tribunal: "1" } }),
  event(2, "TaskAuthorized", { taskId: "recorded", objective: "Read recorded evidence.", cost: 10, workClass: "MANDATORY", researchKey: "recorded", authorizationReason: "MANDATORY_BASELINE", dependencies: [] }),
  event(3, "TaskScheduled", { taskId: "recorded", attemptId, objective: "Read recorded evidence.", cost: 10, workClass: "MANDATORY", researchKey: "recorded", workerRole: "EVIDENCE_RESEARCHER", dependencies: [] }),
  event(4, "BudgetReserved", { attemptId, cost: 10 }),
  event(5, "TaskStarted", { attemptId, simulatedDelayMs: 0 }),
];

const recorded = (sequenceNumber: number, attemptId: string) => event(sequenceNumber, "WorkerExecutionRecorded", { attemptId, mode: "RECORDED_DRY_RUN", providerUsageStatus: "NOT_APPLICABLE" });
const subscriptionStartedAttempt = (attemptId = "subscription:a1") => [
  event(1, "MissionCreated", { totalBudget: 20, missionSeed: 1, policyVersions: { tribunal: "1" } }),
  event(2, "SubscriptionRuntimeDeclared", { executionEnabled: false, accessStatus: "NOT_CHECKED", usageStatus: "NOT_ITEMIZED" }),
  event(3, "SubscriptionRuntimePreflightCompleted", { accessStatus: "CHATGPT_AUTHENTICATED", usageStatus: "NOT_ITEMIZED" }),
  event(4, "TaskAuthorized", { taskId: "subscription", objective: "Read fixture-only evidence.", cost: 10, workClass: "MANDATORY", researchKey: "subscription", authorizationReason: "MANDATORY_BASELINE", dependencies: [] }),
  event(5, "TaskScheduled", { taskId: "subscription", attemptId, objective: "Read fixture-only evidence.", cost: 10, workClass: "MANDATORY", researchKey: "subscription", workerRole: "EVIDENCE_RESEARCHER", dependencies: [] }),
  event(6, "BudgetReserved", { attemptId, cost: 10 }),
  event(7, "TaskStarted", { attemptId, simulatedDelayMs: 0 }),
];
const subscriptionOutcome = (sequenceNumber: number, attemptId: string) => event(sequenceNumber, "SubscriptionWorkerExecutionOutcomeRecorded", { attemptId, outcome: "TIMEOUT", providerUsageStatus: "UNKNOWN", elapsedMs: 90_000 });

describe("worker execution provenance", () => {
  it("accepts only the closed subscription runtime declaration payload", () => {
    const valid = event(2, "SubscriptionRuntimeDeclared", { executionEnabled: false, accessStatus: "NOT_CHECKED", usageStatus: "NOT_ITEMIZED" });
    expect(missionEventSchema.safeParse(valid).success).toBe(true);
    expect(missionEventSchema.safeParse({ ...valid, payload: { ...valid.payload, executionEnabled: true } }).success).toBe(false);
    expect(missionEventSchema.safeParse({ ...valid, payload: { ...valid.payload, accessStatus: "CHECKED" } }).success).toBe(false);
    expect(missionEventSchema.safeParse({ ...valid, payload: { ...valid.payload, usageStatus: "ITEMIZED" } }).success).toBe(false);
    expect(missionEventSchema.safeParse({ ...valid, payload: { ...valid.payload, extra: true } }).success).toBe(false);
  });

  it("does not infer a subscription declaration for legacy history", () => {
    expect(replay([event(1, "MissionCreated", { totalBudget: 20, missionSeed: 1 })]).subscriptionRuntimeDeclaration).toBeUndefined();
  });

  it("rejects a declaration before mission creation and duplicate declarations", () => {
    const declaration = event(1, "SubscriptionRuntimeDeclared", { executionEnabled: false, accessStatus: "NOT_CHECKED", usageStatus: "NOT_ITEMIZED" });
    expect(() => replay([declaration])).toThrow("running mission");
    const created = event(1, "MissionCreated", { totalBudget: 20, missionSeed: 1 });
    expect(() => replay([created, { ...declaration, sequenceNumber: 2, missionId: created.missionId }])).not.toThrow();
    expect(() => replay([created, { ...declaration, sequenceNumber: 2, missionId: created.missionId }, { ...declaration, sequenceNumber: 3, missionId: created.missionId }])).toThrow("already recorded");
  });

  it("persists one sanitized subscription preflight after the disabled declaration", () => {
    const created = event(1, "MissionCreated", { totalBudget: 20, missionSeed: 1 });
    const declaration = event(2, "SubscriptionRuntimeDeclared", { executionEnabled: false, accessStatus: "NOT_CHECKED", usageStatus: "NOT_ITEMIZED" });
    const preflight = event(3, "SubscriptionRuntimePreflightCompleted", { accessStatus: "CHATGPT_AUTHENTICATED", usageStatus: "NOT_ITEMIZED" });
    expect(missionEventSchema.safeParse(preflight).success).toBe(true);
    expect(missionEventSchema.safeParse({ ...preflight, payload: { ...preflight.payload, usageStatus: "REPORTED" } }).success).toBe(false);
    expect(replay([created, declaration, preflight]).subscriptionRuntimePreflight).toEqual(preflight.payload);
    expect(() => replay([created, { ...preflight, sequenceNumber: 2 }])).toThrow("must be declared");
    expect(() => replay([created, declaration, preflight, { ...preflight, sequenceNumber: 4 }])).toThrow("already recorded");
  });

  it("persists one recorded dry-run declaration against a running attempt", () => {
    const state = replay([...startedAttempt(), recorded(6, "recorded:a1")]);

    expect(state.workerExecutionProvenance).toEqual({
      "recorded:a1": { mode: "RECORDED_DRY_RUN", providerUsageStatus: "NOT_APPLICABLE" },
    });
  });

  it("preserves legacy histories and rejects early or duplicate declarations", () => {
    expect(replay(startedAttempt().slice(0, 1)).workerExecutionProvenance).toEqual({});
    expect(() => replay([...startedAttempt().slice(0, 4), recorded(5, "recorded:a1")])).toThrow("Only a running attempt");
    expect(() => replay([...startedAttempt("__proto__"), recorded(6, "__proto__"), recorded(7, "__proto__")])).toThrow("already recorded");
  });

  it("rejects a live mode or provider usage measurement in this dry-run-only contract", () => {
    const valid = recorded(6, "recorded:a1");

    expect(missionEventSchema.safeParse(valid).success).toBe(true);
    expect(missionEventSchema.safeParse({ ...valid, payload: { ...valid.payload, mode: "LIVE_PROVIDER" } }).success).toBe(false);
    expect(missionEventSchema.safeParse({ ...valid, payload: { ...valid.payload, providerUsageStatus: "REPORTED" } }).success).toBe(false);
  });

  it("records one sanitized live-worker outcome only after authenticated preflight and task start", () => {
    const outcome = subscriptionOutcome(8, "subscription:a1");
    expect(missionEventSchema.safeParse(outcome).success).toBe(true);
    expect(missionEventSchema.safeParse({ ...outcome, payload: { ...outcome.payload, providerUsageStatus: "NOT_ITEMIZED" } }).success).toBe(false);
    expect(missionEventSchema.safeParse({ ...outcome, payload: { ...outcome.payload, threadId: "private" } }).success).toBe(false);
    expect(replay([...subscriptionStartedAttempt(), outcome]).subscriptionWorkerExecutionOutcomes).toEqual({
      "subscription:a1": { attemptId: "subscription:a1", outcome: "TIMEOUT", providerUsageStatus: "UNKNOWN", elapsedMs: 90_000 },
    });
  });

  it("rejects subscription outcomes before authentication, task start, or a duplicate outcome", () => {
    const outcome = subscriptionOutcome(8, "subscription:a1");
    expect(() => replay([...startedAttempt("subscription:a1"), { ...outcome, sequenceNumber: 6 }])).toThrow("Authenticated subscription preflight");
    expect(() => replay([...subscriptionStartedAttempt().slice(0, 6), { ...outcome, sequenceNumber: 7 }])).toThrow("Only a running attempt");
    expect(() => replay([...subscriptionStartedAttempt(), outcome, { ...outcome, sequenceNumber: 9 }])).toThrow("already recorded");
  });
});
