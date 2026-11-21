# Works with

DropScope imports OTLP/JSON traces. It recognises a step by the `gen_ai.operation.name` attribute of the OpenTelemetry GenAI conventions and reads token counts from `gen_ai.usage.input_tokens` and `gen_ai.usage.output_tokens`. Names that other emitters use for the same things are mapped (see below). Any other attribute is kept as withheld content or ignored. That is not an error: the trace still imports.

## How each row was checked

The fixtures in `test/fixtures/exporters/` are small synthetic traces. Each follows the attribute names that the emitter's public documentation or source code lists. All values are invented. They are **not captures from a real installation**. A real stack can differ by version and by configuration. If a trace from your stack behaves differently, that is a gap in the table, and a report is welcome.

`test/exporter-shapes.test.ts` imports each fixture and checks the result, so the table below cannot drift from the code.

## Results

| Emitter | Attribute shape used in the fixture | Steps recognised | Token totals | Notes |
| --- | --- | --- | --- | --- |
| OpenTelemetry instrumentation for the OpenAI Agents SDK | `gen_ai.operation.name` of `invoke_agent`, `chat`, `execute_tool`, `agent_handoff` | Agent, model call, tool. `agent_handoff` is kind "Other" with an "unrecognised operation" note. | Yes | Standard names. Content is in `gen_ai.input.messages`, `gen_ai.output.messages` and `gen_ai.tool.call.*`. |
| Pydantic AI (Logfire or any backend) | `gen_ai.operation.name` of `invoke_agent`, `chat`, `execute_tool`; `logfire.*` extras | Agent, model call, tool | Yes | Standard names. The agent span repeats its children's usage; DropScope notes it and does not count it twice. |
| OpenLLMetry (Traceloop), current | `gen_ai.operation.name` `chat` on model calls; `traceloop.span.kind` on workflow and tool spans | Model call, tool. Workflow spans are "Other". | Yes | Model calls use the standard names; tool spans are read from `traceloop.span.kind`. Prompts and completions (`gen_ai.prompt.N.*`) are withheld content. |
| OpenLLMetry (Traceloop), older | `llm.request.type`, `gen_ai.usage.prompt_tokens`, `gen_ai.usage.completion_tokens` | Model call (from `llm.request.type`). Workflow spans are "Other". | Yes | Mapped names, recorded in each step. |
| LangChain and LangGraph, LangSmith OTel export | `langsmith.span.kind`, `llm.request.type`, `gen_ai.usage.prompt_tokens`, `gen_ai.prompt.N.*` | Model call and tool (from `langsmith.span.kind`). The chain span is "Other". | Yes | Mapped names, recorded in each step. |
| OpenInference (Arize) | `openinference.span.kind`, `llm.token_count.*`, `llm.model_name`, `input.value` | Agent, model call, tool | Yes | Mapped names, recorded in each step. `input.value` and the message attributes stay withheld. |

## Mapped names

Since run schema version 3 (contract v1.1, [ADR-029](adr/ADR-029-name-mapping-for-common-emitters.md)) the importer reads these names when the standard one is absent:

- Step kind: `openinference.span.kind` (`LLM`, `EMBEDDING`, `TOOL`, `AGENT`), `traceloop.span.kind` (`agent`, `tool`), `langsmith.span.kind` (`llm`, `embedding`, `tool`), `llm.request.type` (`chat`, `completion`, `embedding`). Grouping spans (`workflow`, `task`, `chain`, `CHAIN`, `RETRIEVER`) stay "Other".
- Token counts: `gen_ai.usage.prompt_tokens` and `gen_ai.usage.completion_tokens`, `llm.token_count.prompt` and `llm.token_count.completion`.

The standard `gen_ai.operation.name` and `gen_ai.usage.*_tokens` always win. Each step records the attribute its kind came from, and each token record the attributes its counts came from. The replay screen says so when the name is not the standard one, and the run file shows it in the raw event.

Runs saved before this change (schema version 2) still open. They only ever used the standard names.

## Regenerating the fixtures

```bash
npx tsx test/fixtures/exporters/make-exporter-fixtures.ts
```
