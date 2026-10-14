# ADR-027: Run-event contract and trace import boundary

**Status:** Accepted by the user on 2026-10-13 (revision 3). Implementation may proceed; the implementation (importer, reducer, persistence) needs independent review under `AGENTS.md`. No further review of the ADR text is planned.  
**Date:** 2026-10-13  
**Extends:** the frozen architecture baseline v1 (section 18 event persistence, section 21 runtime boundaries) with a second event family. It differs from baseline section 18 and `docs/schemas/contracts.md` only where listed under "Deliberate differences". It supersedes no ADR.  
**Companion spec:** [`docs/schemas/run-event-contract-v1.md`](../schemas/run-event-contract-v1.md) holds the normative details (grammar, ordering algorithm, payload tables, privacy classification, limits, file rules). This ADR holds the decisions and the rules that must always hold. If they ever disagree, this ADR wins and the spec is corrected.

ADR-026 is reserved for the product-direction decision and is not drafted. This ADR does not prejudge it: the boundary is useful only if importing external agent-run traces becomes part of the product.

## Context

The mission contract (`MissionEvent`) is a closed, mission-specific union reduced by a pure reducer. Records of agent runs produced elsewhere (for example OpenTelemetry GenAI traces) are not missions. An exploratory spike (unreviewed evidence in `docs/development/spike-2026-10-13/`, not product code) imported four synthetic OTLP/JSON traces. Two independent reviews of earlier revisions rejected them for underspecification (ordering, privacy, input handling, persistence, identity). Revision 3 fixes the defects found and moves detail into the spec so that it can later become tested code.

## Decisions

1. **Separate family.** Imported runs use a new `RunEvent` family with its own schemas, pure reducer and files. `MissionEvent`, the mission reducer and mission histories are unchanged. No run event is appended to a mission history or the reverse. The mission `JsonlEventStore` is not reused.
2. **Closed v1 vocabulary.** `RunStarted`, `StepStarted`, `StepEnded`, `UsageRecorded`, `ContentRecorded`, `LogRecorded`, `ImportNote`, `RunEnded` (spec section 5). The envelope is `schemaVersion`, `sequenceNumber` (from 1, strictly +1), `runId`, `type`, `payload`. The reducer never reads source timestamps. Budget, claim and comparison events are out of scope.
3. **Pure importer, one trace.** An importer is a pure function from bytes and options to events: no clock, randomness, network, environment or filesystem access. Exactly one trace is imported per run, selected before any other processing (spec section 2). The first adapter reads OTLP/JSON with a pinned GenAI convention version. Other formats arrive as adapters without changing the contract.
4. **Determinism with a complete order.** The same input bytes, options and importer version produce a byte-identical log. Reordering the spans or log records inside one input does not change any event after the header or the final state, but it changes the input hash and therefore `artifactId` and the file name, so the header line differs (spec section 3, item 6). Source order is never the tie-breaker; any residual tie is a defect and fails closed. The total order, including duplicate, cycle, missing-parent, unfinished-span, negative-duration and tie handling, is defined in spec section 4. The order is derived and always disclosed as such; concurrency and clock skew are not corrected.
5. **Lossless or itemized.** Every field of the input is retained, withheld with a fingerprint, or itemized in an `ImportNote`. A silent drop is a defect. Retention is subject to the privacy rule in decision 6, which overrides it.
6. **Privacy by classification.** Every retained string, key and nested value is classified structural or content (spec section 6). The default `HASH_ONLY` mode withholds all content, including span names, status messages, event names, trace state, unlisted attribute keys, attribute values outside typed and pattern-gated allowlists, and log bodies, keeping only length and hash. `FULL` stores content and must be chosen per import. Note details contain only codes, counts, ids and enumerated names. `LENGTH_ONLY` and any export for sharing are deferred and need their own contract. Fingerprints and hashes of predictable content are guessable, so run files are local-only artifacts: never shared, never committed.
7. **Identity.** `runId` is the source trace id. A separate `artifactId` is derived deterministically from the selected trace, all input hashes, options, importer version, limits version and convention version (spec section 3). An existing file with the same artifact identity is validated and reused; a different identity or an invalid file fails closed; nothing is ever overwritten.
8. **Untrusted input.** The input is read by a strict, bounded JSON parser and an OTLP structure check at the import boundary; every event is validated with Zod when it is produced and when a log is read. One limits table, part of the importer version, bounds the whole pipeline: input size, structural breadth and depth, total parsed nodes, work per stage, output size and persisted-log reads (spec section 10). Algorithms are iterative and never recurse over untrusted structure. Numeric lexemes are bounded and range-checked before conversion; duplicate JSON properties are rejected. Errors are closed codes with a position only; input text is never echoed. Content is data: never executed, rendered as markup, sent to a model, or printed to a terminal without escaping.
9. **Files and persistence.** The importer reads only a local regular file, with the checks of spec section 11.1 (path and attribute checks run on the path before the open, so that opening a cloud placeholder never downloads it; the rest use the open handle) and a byte-counted read, and fails closed where the platform cannot provide a check. Run logs are write-once: exclusive temporary file, full validation, flush, publication without replacement. The default location in v1 is `%LOCALAPPDATA%\DropScope\runs`, not configurable until validation and permission rules exist; this is outside the repository and not normally under OneDrive's synced folders (Documents, Desktop, Pictures); the importer should warn if the resolved path is under a synced root. Admitting real traces requires a real access boundary, independently reviewed, tested and user-approved; this condition is superseded by ADR-028, which also says a settings rule alone is not enough. A log is valid only if the whole file passes the schemas and the reducer and ends with `RunEnded` carrying a matching `eventCount`; the baseline's truncated-line recovery does not apply.
10. **State at step N.** N is a `sequenceNumber`. State is defined only from recorded facts (spec section 8) with exact-integer usage totals and a defined admission rule for every event (spec section 9). It makes no claim about the model's hidden context.
11. **Versioning.** A reader supports every schema version it has shipped and rejects unknown versions. Changing the vocabulary or a payload shape means a new `schemaVersion`. Unrecognized upstream operations map to kind `OTHER`, so they do not force a version change. Re-import is optional regeneration, not the migration mechanism; it is impossible once the source is gone.

## Deliberate differences from baseline v1

- The envelope omits `eventId`, `timestamp`, `correlationId` and `causationId`. Source times are payload data (integer nanosecond strings, not ISO 8601) because they are ordering inputs, not event times; a step's causal link is `parentStepId`. Projections may format them.
- `sequenceNumber` starts at 1 (the shared contracts say non-negative).
- Persistence is write-once, not append-only, and recovery is validation plus re-import rather than truncated-line discard.
- An import boundary and a second persistence adapter are added beyond baseline section 21.
- Content is withheld by default, unlike the verbatim records of the mission model (consistent with the minimization of ADR-021 and ADR-022).
- Enumerations are closed in v1, as the shared conventions require; evolution is by `schemaVersion`.

## Non-goals

Budget policy, claim verification and run comparison (each needs its own contract and ADR). Live capture, an OTLP receiver, a proxy or an SDK. OTLP protobuf, metrics, JSON Lines and multi-trace runs. Any HTTP route for import: a future route must take bytes, not paths, have its own size limit, require and validate `Origin` and `Host`, and return closed error codes (the existing server accepts requests without `Origin`, caps bodies at 64 KiB and returns raw error messages). Model calls and worker execution. Migration of mission histories. Any change to the product plan or its milestones.

## Consequences

A second event family and reducer to maintain, kept separate so mission behavior cannot regress. New code is confined to run-event schemas, an importer, a reducer, a CLI entry and tests, with the spec becoming schemas and golden tests. The upstream conventions are in Development status and may change; the adapter pins a version and records it. The implementation is review-required under `AGENTS.md` (persistence, state transitions, security-sensitive input handling, architecture), and the agent-permission change in decision 9 needs its own review and approval.

## Open questions

- Limits in the spec are provisional and need measuring on real traces.
- Whether a configurable run directory is ever needed, and under what validation.
- Whether a sanitized sharing export is wanted at all.

## Evidence (non-normative)

Shown on four synthetic traces (16 to 56 spans; local stub model, pinned OpenTelemetry instrumentation): byte-identical re-import of the same input; token totals equal to both the traces' attributes and the stub server's own tally; the same totals when content arrives as OTLP log records; an unknown operation (a handoff) from a real agent framework (OpenAI Agents SDK); and handling of nine malformed variants after three importer fixes.

Not shown: the spike's "round trip" compared the log with the importer's own flattened spans, not the input file, and dropped span flags, `schemaUrl` and log fields; order independence used one shuffle on inputs without timestamp ties; the error count compared the same enum name on both sides; prefix reproducibility compares a function with itself; the malformed-input script asserts nothing; in three of four traces the tool, agent and root spans came from the spike's own code. Not tested at all: real production traces, streaming, cross-machine clock skew, adversarial inputs, file-path hazards, Windows line endings. The spec was written to close these gaps, and the implementation's tests must cover them.
