# ADR-023: Failure Autopsy Pilot

## Status

Accepted for Phase 5.1 with the user's approval. This decision adds no external research capability.

## Decision

DropScope adds one fixed synthetic `failure-autopsy-pilot` fixture. It uses the existing deterministic scheduler, budget rules, risk gate, tribunal, audit, blind review, local JSONL runtime, and browser projections. It accepts no product name, description, product URL, store URL, geography, free-form evidence, user input, source request, worker, subscription execution, retry, polling, or background action.

The fixture appends one `MissionModeDeclared` event with mode `FAILURE_AUTOPSY` immediately after `MissionCreated`, before any runtime declaration or task lifecycle event. Legacy histories without this event remain Learn-a-Market replays. The reducer admits the declaration once and only at that initial position.

The fixed fixture concludes with deterministic insufficient evidence and records its existing risk, tribunal, audit, and blind-review artifacts. Its Final Report may present the fixed failure reasons and the fixed evidence that would change the conclusion. Those statements are fixture metadata, not browser input or new scoring policy.

## Consequences

Phase 5.1 adds the strict mode event, reducer state, shared-scheduler option, fixture, replay projections, tests, and a browser path. The existing Learn-a-Market fixtures retain their event sequence and behavior. Any future product or store URL input, external source, free-form evidence, or mode-specific scoring requires a separate approved ADR.
