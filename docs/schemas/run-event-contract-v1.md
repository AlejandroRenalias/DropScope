# Run-event contract v1 (companion spec to ADR-027)

**Status:** DRAFT. Normative only once ADR-027 is accepted; until then it records intent. Numbers marked (P) are provisional and must be measured on real traces. It does not amend `docs/schemas/contracts.md`; it defines a separate event family.

Conventions: "fail closed" means the import stops with a closed error code (section 12) and publishes nothing. Integers that may exceed 2^53 are decimal strings. Strings compare by UTF-16 code unit. Fixed-schema objects serialize with keys sorted by code unit; user data uses the tagged form in section 3.

## 1. Input grammar

1. One UTF-8 JSON document per role: `spans` (OTLP `ExportTraceServiceRequest`) and an optional `logs` role (`ExportLogsServiceRequest`). At most one document per role. Invalid UTF-8, a BOM, or trailing bytes fail closed.
2. The JSON parser is strict: duplicate property names in any JSON object fail closed; number lexemes stay text until validated; limits (section 10) are enforced while parsing. OTLP key-value lists are arrays of `{key, value}`, where duplicate keys are legitimate and preserved (section 3).
3. Integer lexemes: a JSON string matching `^-?[0-9]{1,20}$` or a JSON number token matching `^-?[0-9]{1,16}$` within plus or minus (2^53 - 1); anything else fails closed. Time fields are uint64; start times must be greater than zero. `intValue` is int64. Dropped counts are uint32. Doubles are JSON numbers; the OTLP strings `"NaN"`, `"Infinity"` and `"-Infinity"` are tagged non-finite doubles.
4. Ids: trace ids 32 and span ids 16 hexadecimal characters, case-insensitive, lowercased. All-zero trace or span ids fail closed. An absent, empty or all-zero parent id means no parent.
5. Enums are integers. Names for `SpanKind` and `StatusCode` are accepted with one `ENUM_NAME_ACCEPTED` note per input (count). An unknown enum value fails closed.
6. `AnyValue` must have exactly one arm; none or several fail closed.
7. A property the mapping does not define is kept as tagged raw data in `unknownFields` (classified content) and counted in an `UNKNOWN_FIELD` note.

## 2. Phases (strict order)

1. Parse and enforce limits.
2. Validate the structure of every span and log record.
3. Select the trace: no spans, fail closed (`E_EMPTY`); several trace ids and no selection option, fail closed (`E_MULTIPLE_TRACES`); a selection naming an absent trace, fail closed (`E_TRACE_NOT_FOUND`). `RunStarted.selectedTrace` is `ONLY` or `EXPLICIT`.
4. Filter to the selected trace, before anything else. Excluded spans and logs are counted in one `OTHER_TRACE_EXCLUDED` note. Logs associate by the pair (trace id, span id). A log of the selected trace whose span id is absent or not among the selected spans, or a log with a missing trace id or span id, is kept as an orphan (`ORPHAN_LOG_RECORD`). A log of another trace is excluded.
5. Collapse duplicates (3.4).
6. Repair parents (4.8), then times (4.1, 4.2).
7. Order and emit (section 4), applying the privacy rules (section 6) as values are emitted.
8. Validate the whole event list with the schemas and the reducer, then publish (section 11).

## 3. Canonical form and identities

1. Tagged values: `{"t":"s","v":string}`, `{"t":"i","v":"decimal"}`, `{"t":"d","v":number|"NaN"|"Infinity"|"-Infinity"}`, `{"t":"o","v":boolean}`, `{"t":"b","v":"base64"}` (standard padded base64, validated), `{"t":"a","v":[tagged...]}`, `{"t":"k","v":[[key,tagged],...]}`. A key-value list keeps source order and duplicate keys. A string with an unpaired surrogate fails closed (`E_UNICODE`).
2. Serialization is compact JSON without whitespace. The content hash is lowercase hexadecimal SHA-256 over the UTF-8 bytes of the tagged value's serialization. Byte length means the length of those bytes.
3. Fields that hold user data use the field form: `{"v": tagged}` when verbatim, `{"w": {"n": byteLength, "h": sha256}}` when withheld.
4. Canonical span identity is the serialization of the span with all of its fields, its resource (attributes, `schemaUrl`) and its scope (name, version, attributes, `schemaUrl`). Two spans with the same span id and the same identity collapse to one, with `DUPLICATE_SPAN_COLLAPSED` (count). Two spans with the same span id and different identities fail closed (`E_CONFLICTING_DUPLICATE`). Identical log records (all fields plus context) collapse with `DUPLICATE_LOG_COLLAPSED` (count). Differing logs stay distinct.
5. Each attribute and event keeps its source ordinal (index in its list). Ordinals are a final tie-breaker only where a rule below says so.
6. `artifactId` is SHA-256 over the serialization of: the selected trace id; each input's role and sha256 in role order; `contentMode`; importer id and version; `limitsVersion`; the convention version. `runId` is the trace id. Permuting spans or log records within an input changes the input hash and therefore `artifactId`, not `runId`.

## 4. Order

1. Fixed maximum `M`: over the selected spans after collapse, the maximum of every start and of every end that is present, nonzero and not before its own start. `M` does not depend on unfinished spans.
2. Effective end: a present, nonzero end at or after the start is itself. An end before the start becomes the start (`NEGATIVE_DURATION_CLAMPED`). A missing or zero end becomes `M` (`UNFINISHED_SPAN_CLOSED`). If `M` equals the start, the span has zero duration.
3. Step events sort by the tuple (time as unsigned integer, class, depth key, span id). Class 0: end of a non-zero-duration span. Class 1: start of any span. Class 2: end of a zero-duration span. Depth key: ascending depth for starts, descending for ends. Span ids are unique after collapse, so the tuple is total.
4. Immediately after a span's `StepEnded`, in this order: its `UsageRecorded` (if any metric exists); its `ContentRecorded` events ordered by (field name, ordinal); then, for each log associated with the span in log order (4.5), a `LogRecorded` followed by that log's `ContentRecorded` events ordered by (field name, ordinal).
5. Log order key: logs with a time (`timeUnixNano`, else `observedTimeUnixNano`, when nonzero) sort before logs without; then by that time; then by canonical serialization bytes (unique after collapse).
6. Orphan logs follow all step events, in log order.
7. `ImportNote` events follow, sorted by (code, step id or empty string, detail serialization). An identical note is never repeated; repeated causes use a count field. `RunEnded` is last. `eventCount` counts every event, including `RunStarted` and `RunEnded`.
8. Parent repair: a missing parent makes the span a root (`MISSING_PARENT`). Cycles are found iteratively; in each cycle the span with the smallest span id has its parent cleared (`PARENT_CYCLE_BROKEN`). Depth is then computed iteratively. A child that starts at or after its parent's effective end, or ends after it, is noted (`CHILD_OUTSIDE_PARENT_INTERVAL`).

## 5. Events

`schemaVersion` is 1. Envelope: `schemaVersion`, `sequenceNumber` (starts at 1, +1 per event), `runId`, `type`, `payload`. "Field" is the field form (3.3).

| Event | Payload |
| --- | --- |
| `RunStarted` | `traceId`; `derivedOrder: true`; `importer {id, version}`; `conventionVersion`; `contentMode` (`HASH_ONLY`, `FULL`); `selectedTrace`; `inputs [{role, byteLength, sha256}]` by role; `limitsVersion`; `artifactId`; `contexts [{contextId, resource {attributes, schemaUrl}, scope {name, version, attributes, schemaUrl}}]` (attributes as lists of `{ordinal, key: Field, value: Field}`; names, versions and URLs as Field). No path, no wall-clock time. |
| `StepStarted` | `stepId`; `parentStepId` or null; `contextId`; `kind` (`LLM_CALL`, `TOOL_CALL`, `AGENT`, `OTHER`); `operationName` (Field or null; null only when the span has no operation attribute); `name` Field; `label` (derived string, section 6.4); `otlpKind`; `startNs`; `traceState` Field; `flags`; `droppedAttributesCount`; `droppedEventsCount`; `droppedLinksCount`; `attributes` (list as above, excluding fields moved to `ContentRecorded`); `links` (list of Field); `unknownFields` Field or null. |
| `StepEnded` | `stepId`; `endNs` or null; `endEffectiveNs`; `statusCode` (0, 1, 2; 2 is error); `statusMessage` Field; `events [{ordinal, timeNs, name: Field, attributes, droppedAttributesCount}]`. |
| `UsageRecorded` | `stepId`; `inputTokens` and `outputTokens`, each a decimal string or null (null means absent). Emitted only for `LLM_CALL` steps with at least one usable metric. |
| `ContentRecorded` | `stepId` or null; `logOrdinal` or null (exactly one of the two is set); `channel` (`SPAN_ATTRIBUTE`, `LOG_RECORD`); `field` (one of the five known content names verbatim, else the literal `gen_ai.other` with the key in `fieldKey` Field); `ordinal`; `value` Field. |
| `LogRecorded` | `logOrdinal` (position in log order); `stepId` or null; `contextId`; `timeNs`; `observedTimeNs`; `severityNumber`; `severityText` Field; `flags`; `eventName` Field; `droppedAttributesCount`; `attributes` (excluding content fields). The body is recorded as `ContentRecorded`. |
| `ImportNote` | `code`; `stepId` or null; `detail` per the table in 7. Details contain only codes, counts, ids and enumerated names, never user keys or values. |
| `RunEnded` | `eventCount`. |

Content fields: `gen_ai.input.messages`, `gen_ai.output.messages`, `gen_ai.system_instructions`, `gen_ai.tool.call.arguments`, `gen_ai.tool.call.result`, any other `gen_ai.*` attribute not on the allowlist (6.2), and every log body and log attribute that is not otherwise allowlisted.

Kinds: `gen_ai.operation.name` of `chat`, `text_completion`, `generate_content` or `embeddings` is `LLM_CALL`; `execute_tool` is `TOOL_CALL`; `invoke_agent` or `create_agent` is `AGENT`; anything else, including a missing operation, is `OTHER`. A present but unmapped operation emits `UNRECOGNIZED_OPERATION`; a missing operation does not.

## 6. Privacy classification

1. Structural values are: integers and enums defined by the mapping, ids, times, the importer's own enumerated strings, and strings that match their allowlist pattern. Everything else is content: span names, status messages, event names, trace state, schema URLs and scope or resource strings that fail their patterns, unknown fields, log bodies, attribute keys not on the allowlist, and attribute values under non-allowlisted keys or failing the pattern or type of an allowlisted key.
2. Allowlist (key, type, pattern):

| Key | Type | Pattern |
| --- | --- | --- |
| `gen_ai.operation.name` | string | `^[a-z_]{1,64}$` |
| `gen_ai.provider.name`, `gen_ai.system` | string | `^[a-z0-9._-]{1,64}$` |
| `gen_ai.request.model`, `gen_ai.response.model` | string | `^[A-Za-z0-9._:/@+-]{1,128}$` |
| `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.usage.total_tokens` | int | non-negative |
| `gen_ai.response.finish_reasons` | array of string | each `^[a-z_]{1,32}$` |
| `gen_ai.tool.name` | string | `^[A-Za-z0-9._-]{1,128}$` |
| `gen_ai.tool.type` | string | `^[a-z_]{1,32}$` |
| `gen_ai.agent.name` | string | `^[A-Za-z0-9._ -]{1,128}$` |
| `gen_ai.agent.id`, `gen_ai.response.id` | string | `^[A-Za-z0-9._:-]{1,128}$` |
| `error.type` | string | `^[A-Za-z0-9._:-]{1,128}$` |
| `server.port` | int | 0 to 65535 |
| scope `name` / `version` | string | `^[a-z0-9._-]{1,128}$` / `^[0-9A-Za-z.+-]{1,64}$` |
| `schemaUrl` | string | `^https://opentelemetry\.io/schemas/[0-9.]{1,32}$` |

   `server.address` and every resource attribute are content.
3. `HASH_ONLY` (default): every content value is withheld (`{"w": {...}}`); structural values are verbatim. `FULL` (explicit per-import option): every value is verbatim. This section overrides any retention statement elsewhere. `LENGTH_ONLY` is deferred from v1. A sanitized export for sharing needs its own contract and covers input fingerprints, identifiers and metadata as well as content hashes.
4. The `label` of a step is derived only from structural data: its kind, its `operationName` if verbatim, and its model if it passes its pattern.
5. The input fingerprints and hashes of low-entropy values can confirm a guess about predictable content. Run files are therefore local-only artifacts and must not be shared or committed.
6. The secret and personal-data scanner runs over content before withholding, in linear time with a per-string cap, and emits only `SECRET_PATTERN_COUNT` (counts per pattern class). It never stores or echoes a matched value.

## 7. Import notes

| Code | Emitted when | Detail |
| --- | --- | --- |
| `OTHER_TRACE_EXCLUDED` | spans or logs of another trace were filtered | `spans`, `logs` counts |
| `DUPLICATE_SPAN_COLLAPSED`, `DUPLICATE_LOG_COLLAPSED` | identical duplicates collapsed | `count` |
| `MISSING_PARENT`, `PARENT_CYCLE_BROKEN` | per affected span | none |
| `CHILD_OUTSIDE_PARENT_INTERVAL`, `NEGATIVE_DURATION_CLAMPED`, `UNFINISHED_SPAN_CLOSED` | per affected span | none |
| `ORPHAN_LOG_RECORD` | per orphan log | `logOrdinal` |
| `UNKNOWN_FIELD` | per step or log with unknown properties | `count` |
| `UNRECOGNIZED_OPERATION` | operation present but unmapped | none (the name is in the step) |
| `CONTENT_ABSENT` | an `LLM_CALL` or `TOOL_CALL` step has no content from any channel | none |
| `USAGE_NOT_SUMMED` | usage attributes on a non-LLM span or on a log record | `count` |
| `UNUSABLE_USAGE` | a usage value is not a non-negative safe integer, or duplicate usage keys disagree | `count` |
| `ENUM_NAME_ACCEPTED` | enum given as a name | `count` per input |
| `SCHEMA_URL_ABSENT`, `SCHEMA_URL_MISMATCH` | per context | `contextId` |
| `WITHHELD_ATTRIBUTE` | attributes withheld in `HASH_ONLY` | `count`, `bytes` per step |
| `SECRET_PATTERN_COUNT` | scanner found patterns | counts per pattern class, once per run |

## 8. Usage and state

1. Usage is read only from `gen_ai.usage.input_tokens` and `gen_ai.usage.output_tokens` of `LLM_CALL` spans, and only as non-negative safe integers (each at most 2^53 - 1). Duplicate keys with equal values count once; with different values the metric is unusable (`UNUSABLE_USAGE`) and is not summed. An absent metric is null, which is different from zero.
2. Totals accumulate as exact integers (BigInt) and serialize as decimal strings. There is no overflow rejection.
3. State at step N, where N is a `sequenceNumber`: open and closed steps; counts by kind; cumulative input and output tokens; content available by field and channel; errors (steps with status code 2); notes by code. No claim is made about the model's hidden context.

## 9. Reducer admission

Reject (fail closed on read, abort before publish) any history that violates: `RunStarted` first and unique, with the declared `contentMode`; `sequenceNumber` starting at 1 and rising by exactly 1; one constant `runId`; `StepStarted` ids unique; `StepEnded` exactly once per started step and only for an open step; `UsageRecorded` at most once per step, only for an `LLM_CALL` step, after its `StepEnded`; `ContentRecorded` and `LogRecorded` referencing an existing step (or null with an orphan note); no `value` Field in `ContentRecorded` unless `contentMode` is `FULL` and no withheld form where the field is structural; `ImportNote` only after every step, usage, content and log event; `RunEnded` unique, last, with no open steps and a matching `eventCount`. Parent references are checked at `RunEnded` for existence only, not for timing, because skewed clocks can start a child before its parent.

## 10. Limits (P, one table, part of `limitsVersion`)

Input: 32 MiB per file, 64 MiB per import; JSON depth 64, checked while scanning, before building values; 10,000 spans; 50,000 log records; 1,024 resource spans and 10,000 scope spans in total; 1,024 attributes, events and links per object; 100,000 elements in any generic array; 2,000,000 parsed nodes in total; keys up to 1 KiB; strings up to 8 MiB; span-tree depth 256. Output: 128 MiB absolute and 1,000,000 events. A persisted log is read through the same caps. Work: parsing, canonicalization, sorting, scanning and replay each must run in O(n log n) with no recursion over untrusted structure; each stage has a node and byte budget, and exceeding any limit fails closed with `E_LIMIT` naming the stage. Measured worst-case tests are required for every stage, not one timing test.

## 11. Files and publication

1. Input: a local regular file only. Resolve the path; reject network-share and device paths; reject a path with any symbolic link or junction in any component; open the file once and use the handle for all checks; reject non-regular files and files whose platform attributes mark them offline or recall-on-access (cloud placeholders); read at most the limit, counting bytes as they arrive, regardless of the reported size. Where the platform cannot provide a check, fail closed.
2. Default location in v1: `%LOCALAPPDATA%\DropScope\runs`, not configurable until validation and permission rules exist. The importer creates it with owner-only access and fails closed if that cannot be verified. Real traces are admitted only after the separately approved restriction on development-agent reads of that directory is in place.
3. File name: `<traceId>-<first 16 hex of artifactId>.runlog.jsonl`. If the file exists, its header (`RunStarted.artifactId`) is validated: equal identity means idempotent reuse after full validation, different identity or an invalid file fails closed. No overwrite, ever.
4. Publication: write the whole file to an exclusive temporary file in the same directory, validate it (section 9), flush it to disk, then publish under the final name without replacement (a hard link fails if the name exists; do not use a replacing rename). Remove the temporary file. A crash may leave a temporary file, never a partial final file. Durability of the new directory entry is best effort on platforms without a directory flush; after a crash, re-import. Stale temporary files (own prefix) are never read as runs and are removed at the next import start.
5. Serialization: UTF-8, no BOM, one event per line, LF only, a mandatory final newline, no blank lines. Reading validates every line against the schema and the reducer; any deviation fails closed. `.gitattributes` fixes LF for fixtures and golden files.
6. Terminal output escapes control characters and bidirectional overrides. Error messages are closed codes (section 12) with a position at most; input text is never echoed.

## 12. Error codes

`E_SYNTAX` (malformed JSON, a BOM, trailing bytes, a duplicate property name), `E_EMPTY`, `E_MULTIPLE_TRACES`, `E_TRACE_NOT_FOUND`, `E_CONFLICTING_DUPLICATE`, `E_NUMBER`, `E_ENUM`, `E_ANYVALUE`, `E_UNICODE`, `E_ID`, `E_LIMIT`, `E_PATH`, `E_FILE_KIND`, `E_EXISTS_DIFFERENT`, `E_INVALID_LOG`, `E_PLATFORM`. Each carries a stage name and, for parse errors, a byte position.

## 13. Versioning and migration

`schemaVersion` changes whenever the vocabulary, a payload shape or a rule here changes. A reader supports every schema version it has ever shipped; an unknown version is rejected. Enumerations in v1 are closed and unknown values are rejected, as `contracts.md` requires unless a migration permits otherwise; adding an event type or kind therefore means version 2, not a silent extension. Unrecognized operations map to `OTHER`, so new upstream operations do not force a version change. Migration is a reader or converter for the old version. Re-import from the source file is optional regeneration, and is impossible when the source is gone; a minimized log cannot be rebuilt from nothing, so continued reading of old versions is the support guarantee.
