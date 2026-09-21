import { describe, expect, it } from "vitest";
import { SubscriptionLiveWorkerProtocolFake } from "../src/subscription-live-worker-protocol.js";

const request = { missionId: "pilot", taskId: "pilot-evidence", attemptId: "pilot-evidence:a1", objective: "Analyze only the fixture.", workerRole: "EVIDENCE_RESEARCHER", maxCost: 10 };
const completed = { taskId: "pilot-evidence", attemptId: "pilot-evidence:a1", status: "COMPLETED", finding: "Fixture-only finding." };

describe("subscription live worker protocol fake", () => {
  it.each([
    ["item/commandExecution/requestApproval", "COMMAND"],
    ["item/fileChange/requestApproval", "FILE_CHANGE"],
    ["item/permissions/requestApproval", "PERMISSIONS"],
  ] as const)("surfaces %s only as a sanitized pending approval", (method, approval) => {
    const fake = new SubscriptionLiveWorkerProtocolFake(request);
    expect(fake.receive({ method, params: { threadId: "do-not-expose", turnId: "do-not-expose", itemId: "do-not-expose", command: "do-not-expose" } })).toEqual({ status: "APPROVAL_REQUIRED", approval });
    expect(fake.declineApproval()).toEqual({ status: "APPROVAL_DECLINED" });
  });

  it("maps terminal stream status and validates only a matching structured result", () => {
    expect(new SubscriptionLiveWorkerProtocolFake(request).receive({ method: "turn/completed", params: { turn: { status: "interrupted" } } })).toEqual({ status: "INTERRUPTED" });
    expect(new SubscriptionLiveWorkerProtocolFake(request).receive({ method: "turn/completed", params: { turn: { status: "failed", error: { message: "do-not-expose" } } } })).toEqual({ status: "TURN_FAILED" });
    expect(new SubscriptionLiveWorkerProtocolFake(request).receive({ method: "turn/completed", params: { turn: { status: "completed" } } }, { taskId: "other", attemptId: "pilot-evidence:a1", status: "COMPLETED", finding: "wrong identity" })).toEqual({ status: "INVALID_RESULT" });
    expect(new SubscriptionLiveWorkerProtocolFake(request).receive({ method: "turn/completed", params: { turn: { status: "completed" } } }, completed)).toEqual({ status: "COMPLETED", result: completed });
  });

  it("never accepts an approval implicitly or processes a second notification", () => {
    const fake = new SubscriptionLiveWorkerProtocolFake(request);
    fake.receive({ method: "item/commandExecution/requestApproval", params: {} });
    expect(() => fake.receive({ method: "turn/completed", params: { turn: { status: "completed" } } }, completed)).toThrow("awaiting approval");
    fake.declineApproval();
    expect(() => fake.declineApproval()).toThrow("No subscription worker approval");
  });
});
