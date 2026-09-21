import { randomUUID } from "node:crypto";
import { z } from "zod";

const confirmationTargetSchema = z.object({
  missionId: z.string().min(1),
  attemptId: z.string().min(1),
}).strict();

export type SubscriptionLiveWorkerConfirmationTarget = z.infer<typeof confirmationTargetSchema>;

export interface SubscriptionLiveWorkerConfirmation {
  readonly capability: string;
  readonly missionId: string;
  readonly attemptId: string;
  readonly expiresAtMs: number;
}

/**
 * Server-memory-only confirmation for one future live worker invocation.
 * It is deliberately not an event and cannot survive reload, restart, or replay.
 */
export class SubscriptionLiveWorkerAuthorization {
  private readonly pending = new Map<string, SubscriptionLiveWorkerConfirmation>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly createCapability: () => string = randomUUID,
    private readonly ttlMs = 60_000,
  ) {
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new Error("Confirmation TTL must be a positive integer.");
  }

  confirm(target: SubscriptionLiveWorkerConfirmationTarget): SubscriptionLiveWorkerConfirmation {
    const parsed = confirmationTargetSchema.parse(target);
    for (const [capability, pending] of this.pending) {
      if (pending.missionId === parsed.missionId && pending.attemptId === parsed.attemptId) this.pending.delete(capability);
    }
    const confirmation: SubscriptionLiveWorkerConfirmation = {
      capability: this.createCapability(),
      missionId: parsed.missionId,
      attemptId: parsed.attemptId,
      expiresAtMs: this.now() + this.ttlMs,
    };
    this.pending.set(confirmation.capability, confirmation);
    return confirmation;
  }

  consume(capability: string, target: SubscriptionLiveWorkerConfirmationTarget): void {
    const parsed = confirmationTargetSchema.parse(target);
    const confirmation = this.pending.get(capability);
    // Consume first so a mismatched or expired capability cannot be replayed.
    this.pending.delete(capability);
    if (!confirmation) throw new Error("Live worker confirmation is missing or already consumed.");
    if (confirmation.missionId !== parsed.missionId || confirmation.attemptId !== parsed.attemptId) {
      throw new Error("Live worker confirmation does not match this mission attempt.");
    }
    if (this.now() >= confirmation.expiresAtMs) throw new Error("Live worker confirmation has expired.");
  }
}
