import { z } from "zod";
import { structuredWorkerResultSchema, type StructuredWorkerResult, type WorkerRequest } from "./worker-adapter.js";

const approvalKindSchema = z.enum(["COMMAND", "FILE_CHANGE", "PERMISSIONS"]);
const protocolNotificationSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("item/commandExecution/requestApproval"), params: z.object({}).passthrough() }),
  z.object({ method: z.literal("item/fileChange/requestApproval"), params: z.object({}).passthrough() }),
  z.object({ method: z.literal("item/permissions/requestApproval"), params: z.object({}).passthrough() }),
  z.object({ method: z.literal("turn/completed"), params: z.object({ turn: z.object({ status: z.enum(["completed", "interrupted", "failed"]) }).passthrough() }).passthrough() }),
]);

export type SubscriptionWorkerProtocolNotification = z.infer<typeof protocolNotificationSchema>;
export type SubscriptionWorkerProtocolState =
  | { status: "WAITING" }
  | { status: "APPROVAL_REQUIRED"; approval: "COMMAND" | "FILE_CHANGE" | "PERMISSIONS" }
  | { status: "COMPLETED"; result: StructuredWorkerResult }
  | { status: "INTERRUPTED" | "TURN_FAILED" | "INVALID_RESULT" | "APPROVAL_DECLINED" };

/**
 * Fake-only projection of the app-server stream for the first live-worker seam.
 * It does not spawn a process, send RPC, expose approval identifiers, or persist
 * anything. A later transport must ask the user for every approval; this class
 * intentionally supports decline only so no approval can be accepted implicitly.
 */
export class SubscriptionLiveWorkerProtocolFake {
  private state: SubscriptionWorkerProtocolState = { status: "WAITING" };

  constructor(private readonly request: WorkerRequest) {}

  current(): SubscriptionWorkerProtocolState {
    return this.state;
  }

  receive(notification: unknown, structuredResult?: unknown): SubscriptionWorkerProtocolState {
    if (this.state.status !== "WAITING") throw new Error("Subscription worker protocol is already terminal or awaiting approval.");
    const parsed = protocolNotificationSchema.parse(notification);
    if (parsed.method === "item/commandExecution/requestApproval") return this.setApproval("COMMAND");
    if (parsed.method === "item/fileChange/requestApproval") return this.setApproval("FILE_CHANGE");
    if (parsed.method === "item/permissions/requestApproval") return this.setApproval("PERMISSIONS");
    if (parsed.params.turn.status === "interrupted") return this.set({ status: "INTERRUPTED" });
    if (parsed.params.turn.status === "failed") return this.set({ status: "TURN_FAILED" });
    const result = structuredWorkerResultSchema.safeParse(structuredResult);
    if (!result.success || result.data.taskId !== this.request.taskId || result.data.attemptId !== this.request.attemptId) return this.set({ status: "INVALID_RESULT" });
    return this.set({ status: "COMPLETED", result: result.data });
  }

  declineApproval(): SubscriptionWorkerProtocolState {
    if (this.state.status !== "APPROVAL_REQUIRED") throw new Error("No subscription worker approval is pending.");
    return this.set({ status: "APPROVAL_DECLINED" });
  }

  private setApproval(approval: z.infer<typeof approvalKindSchema>): SubscriptionWorkerProtocolState {
    return this.set({ status: "APPROVAL_REQUIRED", approval });
  }

  private set(state: SubscriptionWorkerProtocolState): SubscriptionWorkerProtocolState {
    this.state = state;
    return state;
  }
}
