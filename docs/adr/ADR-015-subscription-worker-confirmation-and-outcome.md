# ADR-015: Subscription worker confirmation and outcome boundary

## Status

Accepted for Phase 3.8c.

## Decision

The first future subscription worker requires a one-use confirmation held only in local runtime memory. It is bound to one mission and one running attempt, expires after 60 seconds, and is consumed even when the attempt or expiry check fails. It is never emitted as a mission event, stored in browser storage, or made replayable.

After a separately authorized real turn reaches a terminal result, the runtime may append exactly one `SubscriptionWorkerExecutionOutcomeRecorded` event before the existing `FindingSubmitted` or permanent-failure lifecycle event. Its closed payload contains only the attempt ID, a coarse terminal outcome, `elapsedMs` capped at 90 seconds, and `providerUsageStatus: UNKNOWN`. It omits thread IDs, account details, quotas, prices, raw errors, and provider usage measurements.

The event requires the persisted disabled declaration, a persisted authenticated preflight, and a running attempt. It does not authorize, schedule, retry, complete, or fail work itself; the scheduler remains the only authority for those transitions.

## Non-goals

This phase adds no HTTP endpoint, app-server transport, process launch, prompt, scheduler wiring, browser confirmation action, or enabled live-run control. It does not start or approve a worker.

## Future execution

A later, separately approved real-run phase must consume this confirmation immediately before a single execution, show all app-server approval requests to the user, append the coarse outcome, and then pass only validated structured output to the existing scheduler lifecycle. Any timeout, unavailable runtime, declined approval, interruption, invalid output, or turn failure is durable and has no retry or API fallback.
