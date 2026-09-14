import { describe, expect, it } from "vitest";

import { SubscriptionLiveWorkerAuthorization } from "../src/subscription-live-worker-authorization.js";

const target = { missionId: "mission-1", attemptId: "attempt-1" };

describe("subscription live-worker confirmation", () => {
  it("issues a one-use, in-memory confirmation for exactly one mission attempt", () => {
    const authorization = new SubscriptionLiveWorkerAuthorization(() => 1_000, () => "capability-1");
    const confirmation = authorization.confirm(target);

    expect(confirmation).toEqual({ capability: "capability-1", missionId: "mission-1", attemptId: "attempt-1", expiresAtMs: 61_000 });
    expect(() => authorization.consume(confirmation.capability, target)).not.toThrow();
    expect(() => authorization.consume(confirmation.capability, target)).toThrow("already consumed");
  });

  it("fails closed when the target is different or the confirmation expires", () => {
    let now = 1_000;
    const authorization = new SubscriptionLiveWorkerAuthorization(() => now, () => "capability-2", 100);
    const mismatch = authorization.confirm(target);
    expect(() => authorization.consume(mismatch.capability, { missionId: "mission-1", attemptId: "other-attempt" })).toThrow("does not match");
    expect(() => authorization.consume(mismatch.capability, target)).toThrow("already consumed");

    const expired = authorization.confirm(target);
    now = 1_100;
    expect(() => authorization.consume(expired.capability, target)).toThrow("expired");
  });

  it("keeps only the newest pending confirmation for one mission attempt", () => {
    let capability = 0;
    const authorization = new SubscriptionLiveWorkerAuthorization(() => 1_000, () => `capability-${++capability}`);
    const first = authorization.confirm(target);
    const second = authorization.confirm(target);

    expect(() => authorization.consume(first.capability, target)).toThrow("missing or already consumed");
    expect(() => authorization.consume(second.capability, target)).not.toThrow();
  });

  it("rejects malformed targets and invalid confirmation configuration", () => {
    expect(() => new SubscriptionLiveWorkerAuthorization(Date.now, () => "capability", 0)).toThrow("TTL");
    const authorization = new SubscriptionLiveWorkerAuthorization();
    expect(() => authorization.confirm({ missionId: "", attemptId: "attempt-1" })).toThrow();
  });
});
