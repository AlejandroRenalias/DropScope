# Works with

DropScope imports OTLP/JSON traces. It recognises a step by the `gen_ai.operation.name` attribute of the OpenTelemetry GenAI conventions and reads token counts from `gen_ai.usage.input_tokens` and `gen_ai.usage.output_tokens`. Other attribute names are kept as withheld content or ignored. They are not an error: the trace still imports.

## How each row was checked

The fixtures in `test/fixtures/exporters/` are small synthetic traces. Each follows the attribute names that the emitter's public documentation or source code lists. All values are invented. They are **not captures from a real installation**. A real stack can differ by version and by configuration. If a trace from your stack behaves differently, that is a gap in the table, and a report is welcome.

`test/exporter-shapes.test.ts` imports each fixture and checks the result, so the table below cannot drift from the code.

## Results

| Emitter | Attribute shape used in the fixture | Steps recognised | Token totals | Notes |
| --- | --- | --- | --- | --- |
| OpenTelemetry instrumentation for the OpenAI Agents SDK | `gen_ai.operation.name` of `invoke_agent`, `chat`, `execute_tool`, `agent_handoff` | Agent, model call, tool. `agent_handoff` is kind "Other" with an "unrecognised operation" note. | Yes | Content is in `gen_ai.input.messages`, `gen_ai.output.messages` and `gen_ai.tool.call.*`. |
| Pydantic AI (Logfire or any backend) | `gen_ai.operation.name` of `invoke_agent`, `chat`, `execute_tool`; `logfire.*` extras | Agent, model call, tool | Yes | The agent span repeats its children's usage; DropScope notes it and does not count it twice. |
| OpenLLMetry (Traceloop), current | `gen_ai.operation.name` `chat` on model calls; `traceloop.span.kind` on workflow and tool spans | Model call only | Yes | Workflow and tool spans are kind "Other". Prompts and completions (`gen_ai.prompt.N.*`) are treated as withheld content. |
| OpenLLMetry (Traceloop), older | `llm.request.type`, `gen_ai.usage.prompt_tokens`, `gen_ai.usage.completion_tokens` | None (all "Other") | No | Imports without error. |
| LangChain and LangGraph, LangSmith OTel export | `langsmith.span.kind`, `llm.request.type`, `gen_ai.usage.prompt_tokens`, `gen_ai.prompt.N.*` | None (all "Other") | No | Imports without error. |
| OpenInference (Arize) | `openinference.span.kind`, `llm.token_count.*`, `llm.model_name`, `input.value` | None (all "Other") | No | Imports without error. |

## What is not changed, and why

Mapping the older and non-standard names (`llm.request.type`, `prompt_tokens`, `openinference.span.kind`, `traceloop.span.kind`) would change how the importer decides a step kind and what a saved run file means. The [run event contract](schemas/run-event-contract-v1.md) fixes both: a step without `gen_ai.operation.name` is kind "Other", and usage is read from the `input_tokens` and `output_tokens` names. Changing that needs a new contract version, not a quiet edit, so it is listed as future work and not done here.

If your stack writes the older names, the standard conventions deprecate them in favour of the names DropScope reads. Updating the instrumentation package is the usual fix.

## Regenerating the fixtures

```bash
npx tsx test/fixtures/exporters/make-exporter-fixtures.ts
```
