import { structuredWorkerResultSchema, workerRequestSchema, type WorkerRequest } from "./worker-adapter.js";

/**
 * The reviewable, non-executing plan for a first subscription-backed worker.
 * It deliberately contains no process, transport, credential, or retry code.
 */
export const firstLiveSubscriptionWorkerGuard = {
  execution: "REQUIRES_FRESH_EXPLICIT_APPROVAL",
  maximumTurns: 1,
  timeoutMs: 90_000,
  retryPolicy: "NONE",
  filesystem: "READ_ONLY",
  network: "DISABLED_BY_HOST_POLICY",
  output: "STRICT_STRUCTURED_RESULT",
} as const;

export type FirstLiveSubscriptionWorkerGuard = typeof firstLiveSubscriptionWorkerGuard;

export interface PlannedAppServerRequest {
  method: "thread/start" | "turn/start";
  params: Record<string, unknown>;
}

export interface SubscriptionLiveWorkerPlan {
  guard: FirstLiveSubscriptionWorkerGuard;
  requests: readonly [PlannedAppServerRequest, PlannedAppServerRequest];
}

/**
 * Builds the only request pair a later, separately approved implementation may use.
 * This function sends nothing: it is testable policy, not an app-server adapter.
 */
export function buildSubscriptionLiveWorkerPlan(request: WorkerRequest, cwd: string): SubscriptionLiveWorkerPlan {
  const parsedRequest = workerRequestSchema.parse(request);
  if (!cwd.trim()) throw new Error("A read-only worker cwd is required.");

  const resultSchema = structuredWorkerResultSchema.toJSONSchema();
  const instructions = [
    "Analyze only the supplied fixture objective.",
    "Do not perform web research, use public sources, modify files, or request broader permissions.",
    "Return only the strict structured result for this task and attempt.",
    `Task ID: ${parsedRequest.taskId}`,
    `Attempt ID: ${parsedRequest.attemptId}`,
    `Objective: ${parsedRequest.objective}`,
  ].join("\n");

  return {
    guard: firstLiveSubscriptionWorkerGuard,
    requests: [
      {
        method: "thread/start",
        params: {
          cwd,
          approvalPolicy: "onRequest",
          sandbox: "readOnly",
          serviceName: "dropscope",
        },
      },
      {
        method: "turn/start",
        params: {
          threadId: "$NEW_THREAD_ID",
          input: [{ type: "text", text: instructions }],
          cwd,
          approvalPolicy: "onRequest",
          sandboxPolicy: {
            type: "readOnly",
            access: {
              type: "restricted",
              includePlatformDefaults: true,
              readableRoots: [cwd],
            },
          },
          outputSchema: resultSchema,
        },
      },
    ],
  };
}
