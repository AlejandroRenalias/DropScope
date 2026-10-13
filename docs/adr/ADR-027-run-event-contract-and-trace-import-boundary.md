# ADR-027: Run-event contract and trace import boundary

**Status:** Proposed (draft revision 2, 2026-10-13). Not accepted. Needs the user's approval and an independent review of the revised text. Implementation is held until the user explicitly approves it.  
**Date:** 2026-10-13  
**Extends:** the frozen architecture baseline v1 (sections 18 event persistence, 21 runtime boundaries) with a second event family. It deliberately differs from baseline section 18 and `docs/schemas/contracts.md` where listed under "Deliberate differences". It supersedes no ADR.

ADR-026 is reserved for the product-direction decision and is not drafted. This ADR does not prejudge that decision: it defines a data boundary that is useful only if importing external agent-run traces becomes part of the product, so implementation waits for the user's go-ahead.

## Context

The mission event contract (`MissionEvent`) is a closed, mission-specific union reduced by a pure reducer. Records of agent runs produced elsewhere (for example OpenTelemetry GenAI traces) are not missions. An exploratory spike (unreviewed evidence kept in `docs/development/spike-2026-10-13/`, not product code) imported four synthetic OTLP/JSON traces and informed this ADR. An independent review of revision 1 found the first draft's ordering rule, evidence claims, privacy default and input handling underspecified; this revision addresses those findings. What the spike showed and did not show is in "Evidence" below.

## Decision

### 1. Separate family
Imported runs use a new `RunEvent` family with its own schemas, pure reducer and files. `MissionEvent`, the mission reducer and mission histories are unchanged. No run event is appended to a mission history or the reverse. The mission `JsonlEventStore` is not reused (it is bound to the mission schema).

### 2. Envelope and vocabulary
Envelope: `schemaVersion`, `sequenceNumber` (starts at 1, strictly increasing by 1), `runId`, `type`, `payload`. The reducer never reads source timestamps.

Closed v1 events: `RunStarted`, `StepStarted`, `StepEnded`, `UsageRecorded`, `ContentRecorded`, `ImportNote`, `RunEnded`.
- `RunStarted`: `traceId`, `derivedOrder: true`, `importer {id, version}`, `conventionVersion`, `contentMode`, `inputs [{role, byteLength, sha256}]`, `limitsVersion`. It records no input path and no wall-clock time.
- `StepStarted`: `stepId`, `parentStepId|null`, `kind` (`LLM_CALL`, `TOOL_CALL`, `AGENT`, `OTHER`), `operationName` (the original operation, required when `kind` is `OTHER`), `name`, `startNs`, `scope`, retained span fields (section 5).
- `StepEnded`: `stepId`, `endNs|null`, `endEffectiveNs`, `statusCode` (integer, 2 means error), `statusMessage`, retained events.
- `UsageRecorded`: `stepId`, `inputTokens`, `outputTokens` (non-negative safe integers).
- `ContentRecorded`: `stepId`, `field`, `channel` (`SPAN_ATTRIBUTE` or `LOG_RECORD`), `byteLength`, `sha256`, and `value` only in `FULL` content mode.
- `ImportNote`: `code`, `stepId|null`, closed per-code detail. Codes: `MISSING_PARENT`, `PARENT_CYCLE_BROKEN`, `DUPLICATE_SPAN_COLLAPSED`, `CHILD_OUTSIDE_PARENT_INTERVAL`, `NEGATIVE_DURATION_CLAMPED`, `UNFINISHED_SPAN_CLOSED`, `ORPHAN_LOG_RECORD`, `UNKNOWN_FIELD`, `UNRECOGNIZED_OPERATION`, `CONTENT_ABSENT`, `USAGE_NOT_SUMMED`, `UNUSABLE_USAGE`, `ENUM_NAME_ACCEPTED`, `SCHEMA_URL_ABSENT`, `SCHEMA_URL_MISMATCH`, `WITHHELD_ATTRIBUTE`, `SECRET_PATTERN_COUNT`.
- `RunEnded`: `eventCount`.

An unrecognized operation (for example a handoff) becomes kind `OTHER` with its `operationName` and an `UNRECOGNIZED_OPERATION` note; it is never rejected. Adding a kind later is compatible; removing one is not. Budget, claim and comparison events are out of scope.

### 3. Accepted input
Per role, one UTF-8 JSON document in the OTLP/JSON mapping: spans (`resourceSpans`) and, optionally, logs (`resourceLogs`) as separate role-tagged inputs. Exactly one trace id; otherwise fail closed unless the caller selects one, recorded in `RunStarted`. Span ids are 16 and trace ids 32 hexadecimal characters, case-insensitive, lowercased; anything else fails closed. Enums are integers; names are accepted with an `ENUM_NAME_ACCEPTED` note. 64-bit integers are strict decimal strings or JSON numbers within the safe-integer range; a larger JSON number fails closed. Missing or zero start time fails closed. Each scope's `schemaUrl` is recorded; an absent or non-matching value is noted. The pinned convention version names the set of attribute keys and values the importer maps and the content allowlist (section 6). Non-goals for v1: OTLP protobuf, metrics, JSON Lines, multi-trace runs.

### 4. Derived total order (the complete rule)
1. Duplicate span ids: byte-identical canonical spans collapse with `DUPLICATE_SPAN_COLLAPSED`; conflicting duplicates fail closed.
2. A missing parent makes the span a root with `MISSING_PARENT`. A parent cycle is broken by treating the smallest span id in the cycle (code-unit order) as a root, with `PARENT_CYCLE_BROKEN`. Depth is computed iteratively after repair.
3. Effective end: a missing or zero end becomes the maximum effective time over all spans, with `UNFINISHED_SPAN_CLOSED`; an end before the start is clamped to the start, with `NEGATIVE_DURATION_CLAMPED`. A child whose interval is not inside its parent's is noted (`CHILD_OUTSIDE_PARENT_INTERVAL`), including a child that starts at or after its parent's end.
4. Step events sort by the tuple (time as an unsigned integer, class, depth key, span id by code-unit order). Class 0: end of a non-zero-duration span; class 1: start of any span; class 2: end of a zero-duration span. Depth key: ascending for starts, descending for ends.
5. After a step's `StepEnded`, in this order: its `UsageRecorded`, then its `ContentRecorded` events ordered by (field name, channel with span attributes before log records, then log records by observed time and canonical bytes).
6. All `ImportNote` events follow the last step event, sorted by (code, span id, canonical payload bytes), then `RunEnded` last with `eventCount`.
7. The determinism key is (input bytes of each role, options, importer version). Permuting spans or log records within an input changes only `inputs[*].sha256`.
Concurrency and clock skew between machines are not corrected; every projection that shows order says it is derived.

### 5. Lossless or itemized
User data is stored as tagged, order-preserving JSON: each OTLP value becomes a tagged scalar or array (integers as exact decimal strings, doubles with non-finite values tagged, bytes tagged), and key-value lists keep order and duplicate keys as pairs. Fixed-schema objects serialize with sorted keys. Retained per span: ids, `traceState`, name, kind, start and end times, attributes, dropped counts, events, links, status, flags. Retained per scope and resource: name, version, attributes, `schemaUrl`. A field the importer does not know is recorded as `UNKNOWN_FIELD`. The content hash is SHA-256 over the UTF-8 bytes of the value's tagged canonical JSON (lone surrogates escaped, never replaced). A silent drop is a defect.

### 6. Content and privacy
`contentMode` is `HASH_ONLY` (default), `FULL` (explicit opt-in per import) or `LENGTH_ONLY` (for sharing; no hashes, because hashes of low-entropy values such as email addresses are guessable). Content is any `gen_ai.*` attribute not on the pinned non-content allowlist (model, operation, token counts, tool name, agent name, finish reasons, ids) plus every log record body and attribute. In `HASH_ONLY` and `LENGTH_ONLY`, attributes outside the allowlist are also withheld (key, byte length, hash only in `HASH_ONLY`) with `WITHHELD_ATTRIBUTE`, because stack traces, URLs and command lines can carry secrets. This departs from keeping raw input verbatim and follows the data-minimization precedent of ADR-021 and ADR-022. Run files live by default in a per-user data directory outside the repository and outside synced folders; the current mission data root sits under the repository working directory (and, in the owner's setup, OneDrive), which is not acceptable for traces. Denying development agents read access to that directory is an agent-permission change that needs its own independent review and user approval; this ADR only requires it. Real traces are never committed; fixtures are synthetic or redacted. A secret and personal-data scanner (linear-time, capped per string, report-only) emits `SECRET_PATTERN_COUNT`; values are never echoed.

### 7. Untrusted input
Initial limits (constants that are part of the importer version): 32 MiB per file and 64 MiB per import, regular local files only; 10,000 spans; 50,000 log records; JSON depth 64 checked before parsing; span-tree depth 256; 1,024 attributes, events and links per object; keys up to 1 KiB; strings up to 8 MiB; output no larger than twice the input; a CI timing test at the limits. Algorithms are iterative, O(n log n), and never recurse over untrusted structure. Ids are validated before use as map keys and reducers use `Map`. Usage is accepted only as non-negative safe integers on LLM-call span attributes; any other usage value is noted (`UNUSABLE_USAGE`) or itemized without summing (`USAGE_NOT_SUMMED`). Duplicate attribute keys are kept. Errors are closed codes with a position only; input text is never echoed. Imported content is data: never executed, never rendered as markup, never sent to a model, and escaped for terminals (control characters and bidirectional overrides). Input is validated with Zod at the import boundary and when a run log is read.

### 8. Files and persistence
The CLI reads only a local regular file: it rejects network-share (UNC) and device paths, symbolic links and FIFOs, opens once, and checks size before reading. `runId` is 32 lowercase hexadecimal characters. Run logs are immutable: write a temporary file, fsync, rename without overwriting; names combine the trace id and a short input hash, and an existing file is never overwritten. A log is valid only if its last line is `RunEnded` with a matching `eventCount`; anything else is a hard failure with re-import guidance, and the baseline's truncated-line recovery does not apply. Derived analyses go to separate files. Migration is by re-import. Fixtures and golden files use LF line endings (`.gitattributes`). Existing path helpers (`containedPath`, `assertNotLink`, exclusive create) are the model.

### 9. State at step N
N is `sequenceNumber`. State is defined only from recorded facts: open and closed steps, counts by kind, cumulative usage (summed only from LLM-call span attributes), content available by field, errors (status code 2) and notes. Reducer admission rules, in the style of the mission reducer: `RunStarted` first and unique; each sequence number exactly one greater than the last; constant `runId`; `StepEnded` only for an open step; `RunEnded` last. State makes no claim about the model's hidden context.

## Deliberate differences from baseline v1
- The envelope omits `eventId`, `timestamp`, `correlationId` and `causationId`. Source times are payload data (integer nanosecond strings), not ISO 8601, because they are inputs to ordering, not event times; a step's causal link is `parentStepId`. Projections may format them.
- `sequenceNumber` starts at 1.
- Persistence is write-once, not append-only, and recovery is re-import.
- It adds an import boundary and a second persistence adapter beyond baseline section 21.
- Content minimization (section 6) differs from storing source records verbatim.

## Non-goals

Budget policy, claim verification and run comparison (each needs its own contract and ADR). Live capture, OTLP receiver, proxy or SDK. Any HTTP route for import: a future route must take bytes, not paths, have its own size limit, require and validate `Origin` and `Host`, and return closed error codes (the existing server accepts requests without `Origin`, has a 64 KiB body cap and returns raw error messages). Model calls and worker execution. Migration of mission histories. Any change to the product plan.

## Consequences

A second event family and reducer to maintain, kept separate so mission behavior cannot regress. New code is confined to run-event schemas, an importer, a reducer, a CLI entry and tests. The upstream conventions are in Development status and may change; the adapter pins a version and records it. Review is required under `AGENTS.md` for the ADR and for its implementation (persistence, state transitions, security-sensitive input handling, architecture), and the agent-permission change in section 6 needs its own review.

## Open questions for review

- Whether the default per-user run directory should be configurable, and its Windows location.
- Whether the limits in section 7 are right for real traces (they are provisional).
- Whether `LENGTH_ONLY` is worth a third mode in v1.

## Evidence (non-normative, what was and was not shown)

Shown on four synthetic traces (16 to 56 spans; generated by a local stub model and pinned OpenTelemetry instrumentation): byte-identical re-import of the same input; token totals equal to both the traces' attributes and the stub server's own tally; the same totals when content arrives as OTLP log records; a handoff operation from a real agent framework (OpenAI Agents SDK) exposing an unknown operation name; and graceful handling of nine malformed variants after three importer fixes.

Not shown, and weaker than earlier wording implied: the "round trip" compared the log with the importer's own flattened spans, not with the input file, and the spike dropped span flags, `schemaUrl` and log record fields; order independence was tested with one shuffle on inputs with no timestamp ties, so the tie and anomaly paths were not exercised by it; the error count compared the same enum name on both sides and would read zero for integer status codes; prefix reproducibility compares a function with itself; the malformed-input script asserts nothing and hides notes; in three of four traces the tool, agent and root spans came from the spike's own code, not from instrumentation. Not tested at all: real production traces, streaming responses, cross-machine clock skew, adversarial inputs (huge nesting, `__proto__` ids, string-typed usage), file-path hazards, Windows line endings. The rules above were written to close these gaps, and the implementation's tests must cover them.
