# ADR-010: Charge Interrupted Attempts in Simulation

**Status:** Accepted  
**Date:** 2026-08-28

## Context

Milestone 1A uses simulated workers, so a process interruption does not consume real model tokens. Milestone 2 may interrupt work after tokens or other paid resources have already been consumed.

Using free interruption semantics in simulation and charged interruption semantics later would change the budget model exactly when real workers are introduced.

## Decision

When a task attempt starts, its reserved cost becomes committed. If the process is interrupted before a valid terminal event, that committed cost is finalized as spent during recovery and is not refunded.

Recovery creates a new attempt with a new cost. Interruption does not consume the task’s transient-worker retry allowance. Recovery restarts are capped at one per mission in Milestone 1A.

## Reasons

- Keeps simulation accounting compatible with future real-agent accounting
- Makes crash recovery exercise real budget pressure
- Avoids optimistic refunds that may be impossible with model providers
- Keeps transient worker failure and engine interruption as separate failure classes

## Tradeoff

Milestone 1A deliberately overcharges interrupted simulated work.

## Consequences

- The documented worst-case 1A path includes one charged interrupted attempt.
- The worst-case required path costs 110 of 120 units.
- More than one recovery restart per mission is rejected in 1A.
- Usage reports must label the interrupted charge clearly.

