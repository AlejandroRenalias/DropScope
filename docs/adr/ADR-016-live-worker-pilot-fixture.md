# ADR-016: Isolated live-worker pilot fixture

## Status

Accepted for Phase 3.8d.

## Decision

`live-worker-pilot` is the sole fixture that may prepare an eligible first subscription-worker attempt. It has exactly one mandatory Evidence Researcher task. The existing deterministic scheduler durably emits `MissionCreated`, the disabled subscription declaration, authorization, scheduling, budget reservation, and `TaskStarted`, then pauses with that attempt still running.

The pause never invokes a worker adapter, app-server process, thread, turn, prompt, or network access. It retains the disabled declaration and does not enable the Agent Desk control. The pending attempt is only a future target for the separately approved confirmation-and-execution boundary from ADR-014 and ADR-015.

Crosscurrent remains a fully deterministic recorded dry-run fixture and is not a live-worker target.

## Non-goals

This does not add an execution endpoint, browser confirmation action, app-server transport, approval relay, output handling, scheduler completion or permanent-failure wiring, retries, fallback, credentials, billing data, or public research.
