# ADR-029: Read the common non-standard names, and record that we did

**Status:** Accepted, 2026-11-21.  
**Amends:** `docs/schemas/run-event-contract-v1.md` sections 5, 6.2, 8.1, 9 and 13 (contract v1.1, schema version 3). Everything else in ADR-027 stands.

## Summary

The importer decided a step's kind only from `gen_ai.operation.name` and read token counts only from `gen_ai.usage.input_tokens` and `gen_ai.usage.output_tokens`. A trace from OpenInference (Arize), the LangSmith export (LangChain, LangGraph) or an older OpenLLMetry imported without error, but every step was "Other" and the token totals were zero. See [Works with](../WORKS_WITH.md).

From schema version 3 the importer also reads the names those emitters use, and it records in each step and each usage event which attribute it used.

## Decision

1. **Kind.** `gen_ai.operation.name` still decides first, and a present value that is not mapped is never overridden. Without it, the first present key that maps to a kind decides, in this order: `openinference.span.kind`, `traceloop.span.kind`, `langsmith.span.kind`, `llm.request.type`. The value tables are in contract section 5. Grouping spans (`workflow`, `task`, `chain`, `CHAIN`, `RETRIEVER` and similar) stay "Other".
2. **Usage.** For each metric the first present key of three decides: `gen_ai.usage.input_tokens`, `gen_ai.usage.prompt_tokens`, `llm.token_count.prompt` (and the matching output names). The first key present decides even when its value is unusable, so numbers of two emitters are never mixed. Only model-call steps are summed, as before.
3. **Recorded per step.** `StepStarted.kindSource` names the key that decided the kind (null for kind "Other"). `UsageRecorded.inputSource` and `outputSource` name the keys the counts came from. The replay screen says so in plain words when the name is not the standard one.
4. **Checked on read.** For version 3 the reducer requires these fields and checks them against what the step shows: the named key must be present verbatim with a value that maps to the recorded kind. A hand-edited file cannot claim a mapping its attributes do not support. Version 2 files must not contain the fields.
5. **Privacy.** The mapped keys join the allowlist, each with a closed pattern (short enumerated words, a model name, or a whole number). They carry no free text. Content such as `input.value`, `llm.input_messages.*`, `traceloop.entity.input` and `gen_ai.prompt.*` stays withheld.
6. **Versions.** The schema version becomes 3 and the importer version 5. A reader accepts 2 and 3, and a file never mixes them. Version 2 files stay valid and are not rewritten. Importing the same trace again writes a new file next to the old one, because the importer version is part of the artifact id.

## Alternatives considered

- **Map silently, record nothing.** Rejected: a reader of the run could not tell a standard reading from a guess.
- **Mark mapped steps with an import note only.** Rejected: a note is per run and sorted, a source is a property of one step, and the reducer can check a field but not a note's meaning.
- **Fall back past an unusable value to the next key.** Rejected: it could hide a malformed count behind another emitter's number. The first key present decides, each metric on its own.
- **Map `chain` or `workflow` spans to agents.** Rejected: they group work and do not do it, and calling them agents would inflate the agent count.

## Consequences

- Traces from OpenInference, LangChain and LangGraph through LangSmith, and both generations of OpenLLMetry give real step kinds and token totals. Budget replay and run diff work on them without change.
- The fixtures in `test/fixtures/exporters/` pin each rule. They are synthetic and written from public documentation, not captured from real installations; a real stack can differ.
- Emitters keep changing names. A new name is a contract change of the same kind as this one.
- Old files keep opening. A tool that compares artifact ids of the same trace across importer versions sees different ids.
