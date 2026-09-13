import { describe, expect, it } from "vitest";

import { buildSubscriptionLiveWorkerPlan, firstLiveSubscriptionWorkerGuard } from "../src/subscription-live-worker-contract.js";
import type { WorkerRequest } from "../src/worker-adapter.js";

const request: WorkerRequest = {
  missionId: "mission-1",
  taskId: "task-1",
  attemptId: "attempt-1",
  objective: "Inspect only the supplied local fixture.",
  workerRole: "EVIDENCE_RESEARCHER",
  maxCost: 3,
};

describe("first subscription worker contract", () => {
  it("builds one fresh read-only thread and one strict turn without executing either", () => {
    const plan = buildSubscriptionLiveWorkerPlan(request, "C:/dropscope-fixture");

    expect(plan.guard).toEqual(firstLiveSubscriptionWorkerGuard);
    expect(plan.guard).toEqual({ execution: "REQUIRES_FRESH_EXPLICIT_APPROVAL", maximumTurns: 1, timeoutMs: 90_000, retryPolicy: "NONE", filesystem: "READ_ONLY", network: "DISABLED_BY_HOST_POLICY", output: "STRICT_STRUCTURED_RESULT" });
    expect(plan.requests.map((item) => item.method)).toEqual(["thread/start", "turn/start"]);
    expect(plan.requests[0].params).toMatchObject({ cwd: "C:/dropscope-fixture", approvalPolicy: "onRequest", sandbox: "readOnly", serviceName: "dropscope" });
    expect(plan.requests[1].params).toMatchObject({ threadId: "$NEW_THREAD_ID", cwd: "C:/dropscope-fixture", approvalPolicy: "onRequest", sandboxPolicy: { type: "readOnly", access: { type: "restricted", includePlatformDefaults: false, readableRoots: ["C:/dropscope-fixture"] } } });
  });

  it("uses the runtime result boundary and constrains the fixture-only instruction", () => {
    const turn = buildSubscriptionLiveWorkerPlan(request, "C:/dropscope-fixture").requests[1].params;
    const text = (turn.input as Array<{ text: string }>)[0]!.text;
    const outputSchema = turn.outputSchema as { properties: Record<string, unknown>; required: string[]; additionalProperties: boolean };

    expect(text).toContain("Do not perform web research");
    expect(text).toContain("Task ID: task-1");
    expect(text).toContain("Attempt ID: attempt-1");
    expect(outputSchema.required).toEqual(["taskId", "attemptId", "status", "finding"]);
    expect(outputSchema.properties).toHaveProperty("finding");
    expect(outputSchema.additionalProperties).toBe(false);
  });

  it("fails closed before a plan exists when the scheduler request or cwd is invalid", () => {
    expect(() => buildSubscriptionLiveWorkerPlan({ ...request, objective: "" }, "C:/dropscope-fixture")).toThrow();
    expect(() => buildSubscriptionLiveWorkerPlan(request, "   ")).toThrow("read-only worker cwd");
  });
});
