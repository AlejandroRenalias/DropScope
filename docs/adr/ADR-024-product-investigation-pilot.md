# ADR-024: Product Investigation Pilot

## Status

Accepted for Phase 5.2 with the user's approval. This decision adds no external research capability.

## Decision

DropScope adds one fixed synthetic `product-investigation-pilot` fixture. It declares `PRODUCT_INVESTIGATION` immediately after `MissionCreated`, then reuses the existing deterministic scheduler, budget, eligibility, ranking, tribunal, audit, blind-review, JSONL runtime, and browser projections.

The fixture first records an eligible investigation priority, then records a fixed automatic failure-autopsy tribunal with a conservative `CAUTION` result, review, and revision cycle. The autopsy conclusion is fixture metadata shown beside the report. It explains opposing evidence; it does not alter the existing ranking, risk gate, or scoring policy.

The pilot accepts no URL, product description, store data, free-form input, external source, worker, subscription execution, retry, polling, or background action. Existing modes and legacy histories remain unchanged.

## Consequences

Phase 5.2 extends the closed mission-mode vocabulary, adds the fixture and shared-pipeline path, projects the fixed investigation/autopsy context, and adds replay/browser regression coverage. Any real product input, source capture, autopsy-dependent ranking, or new decision policy requires a separate approved ADR.
