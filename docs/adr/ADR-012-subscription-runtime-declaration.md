# ADR-012: Subscription runtime declaration boundary

## Status

Accepted for Phase 3.7a.

## Decision

New local fixture missions append `SubscriptionRuntimeDeclared` immediately after `MissionCreated`. Its closed payload declares `executionEnabled: false`, `accessStatus: NOT_CHECKED`, and `usageStatus: NOT_ITEMIZED`. The reducer persists it once and never infers it for legacy histories.

`SubscriptionWorkerAdapter` validates a request and then deterministically rejects because live subscription execution is disabled. It has no SDK, credential, process, network, or billing dependency. `WorkerExecutionRecorded` remains exclusively the provenance event for recorded dry runs.

## Non-goals

This slice does not authenticate, inspect quota, invoke Codex, install dependencies, or claim provider costs. It does not enable live execution or automatic retries.

## Replay and authorization

The event stream remains authoritative. The declaration is shown in Agent Desk only when persisted. A future first live invocation requires explicit product and permission authorization, with a new reviewed contract and tests.
