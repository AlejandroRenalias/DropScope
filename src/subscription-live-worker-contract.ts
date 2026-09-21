import { structuredWorkerResultSchema, workerRequestSchema, type WorkerRequest } from "./worker-adapter.js";

/** The complete, fixed evidence supplied to the one-worker live pilot. */
export const liveWorkerPilotEvidence = "The supplied local pilot concerns a workspace research task. It has no public sources, external data, or additional files. Record one concise finding that this fixed pilot evidence is sufficient only for the local test mission.";

/**
 * The reviewable fixed request plan for a first subscription-backed worker.
 * It deliberately contains no credential, usage, or retry behavior.
 */
export const firstLiveSubscriptionWorkerGuard = {
  execution: "REQUIRES_FRESH_EXPLICIT_APPROVAL",
  maximumTurns: 1,
  timeoutMs: 90_000,
  retryPolicy: "NONE",
  filesystem: "READ_ONLY",
  network: "DISABLED_BY_HOST_POLICY",
  output: "STRICT_STRUCTURED_RESULT",
  confirmation: "ONE_TIME_IN_MEMORY",
  confirmationTtlMs: 60_000,
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
 * Builds the only request pair the guarded adapter may use.
 * This function sends nothing: it is testable policy, not an app-server adapter.
 */
export function buildSubscriptionLiveWorkerPlan(request: WorkerRequest, cwd: string): SubscriptionLiveWorkerPlan {
  const parsedRequest = workerRequestSchema.parse(request);
  if (!cwd.trim()) throw new Error("A read-only worker cwd is required.");

  const resultSchema = structuredWorkerResultSchema.toJSONSchema();
  const instructions = [
    "Analyze only the supplied fixture objective and the inline pilot evidence below.",
    "Do not use tools, perform web research, use public sources, read files, modify files, or request permissions.",
    "Return only the strict structured result for this task and attempt.",
    `Task ID: ${parsedRequest.taskId}`,
    `Attempt ID: ${parsedRequest.attemptId}`,
    `Objective: ${parsedRequest.objective}`,
    `Inline pilot evidence: ${liveWorkerPilotEvidence}`,
  ].join("\n");

  return {
    guard: firstLiveSubscriptionWorkerGuard,
    requests: [
      {
        method: "thread/start",
        params: {
          cwd,
          approvalPolicy: "on-request",
          sandbox: "read-only",
          ephemeral: true,
          serviceName: "dropscope",
        },
      },
      {
        method: "turn/start",
        params: {
          threadId: "$NEW_THREAD_ID",
          input: [{ type: "text", text: instructions }],
          cwd,
          approvalPolicy: "on-request",
          sandboxPolicy: {
            type: "readOnly",
            networkAccess: false,
          },
          outputSchema: resultSchema,
        },
      },
    ],
  };
}
