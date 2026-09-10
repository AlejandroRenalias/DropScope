# ADR-011: Persist Recorded Dry-Run Execution Provenance

**Status:** Accepted

**Date:** 2026-09-10

**Supersedes:** No prior ADR; extends the frozen simulation/runtime boundary.

## Context

The local runtime can replay a recorded worker result, but its persisted history previously identified an attempt only by role and finding text. A role or a text prefix cannot prove how a worker ran, whether provider usage applies, or whether another attempt used a live worker.

## Decision

Add `WorkerExecutionRecorded` as a schema-version-1 event. It is emitted immediately before the local runtime invokes the existing `RecordedWorkerAdapter` for a running attempt.

The accepted Phase 3.6 payload is deliberately closed:

- `mode: RECORDED_DRY_RUN`
- `providerUsageStatus: NOT_APPLICABLE`

The reducer stores one provenance record per running attempt. Duplicate, early, or malformed records are rejected. The scheduler accepts only `RecordedWorkerAdapter` for this path and rejects recorded execution when it has no durable event store. Histories that predate this event remain replayable and expose no inferred provenance.

## Consequences

- Agent Desk derives dry-run labeling from persisted provenance, not finding text.
- Mission summaries distinguish recorded dry runs from attempts whose provenance is not recorded.
- Research-budget units remain separate from provider billing.
- This ADR does not authorize a live provider, credentials, network traffic, or provider usage measurement. A future live-worker design requires a separate ADR and explicit approval.
