# Phase 0 spike (2026-10-13): throwaway evidence, not product code

This folder is a frozen copy of an exploratory spike. It is **not** imported by `src/`, is not type-checked or tested by CI, and has had no independent review. It exists so the claims in `PROGRESS.md` and ADR-027 can be reproduced. Do not build on it; the real importer, if approved, is written fresh under ADR-027.

## What is here

| File | Purpose |
| --- | --- |
| `gen_trace.py` | Stub OpenAI-compatible server on loopback plus an instrumented agent. `--flavor a` (openai-v2 GenAI instrumentation, content captured), `b` (OpenLLMetry, content off, parallel sub-agents, tool timeout), `d` (openai-v2, content as OTLP log records). Writes OTLP/JSON, plus a `.truth` file with the server's own token tally. |
| `gen_agents.py` | Flavor `c`: OpenAI Agents SDK (triage agent hands off to a researcher with parallel function tools) with its OTel instrumentation, against the same kind of stub. |
| `importer.mjs` | Throwaway OTLP/JSON to run-event importer and pure reducer. |
| `checks.mjs` | Determinism, order independence, lossless round trip, totals against the trace and against the server tally, prefix reproducibility, a mechanical citation probe and a budget replay probe. |
| `mutate.mjs` | Adversarial inputs (missing parent, duplicate id, clock skew, zero, negative and missing durations, unknown value type, truncated file). |
| `pins-a.txt`, `pins-b.txt`, `pins-c.txt` | Exact Python dependency pins per flavor (separate virtual environments; flavor `d` uses the `a` environment plus `opentelemetry-util-genai==0.4b0`, already reflected in `pins-a.txt`). |
| `traces/` | The four generated traces and their `.truth` files. |

## Everything is synthetic and local

No real model, API key or external network is involved. All text, tool results and citations are scripted. A scan of the traces found no personal data, hostnames or local paths (only loopback addresses and random UUIDs). Regenerating produces different ids and timestamps, so use the committed traces to reproduce the recorded results.

## Reproduce the checks (Node 22 or later, no installs)

```bash
node checks.mjs traces/trace-a.json traces/trace-b.json traces/trace-c.json traces/trace-d.json
node mutate.mjs
```

Temporary output goes to the operating system's temp directory, not into the repository.

## Regenerate traces (optional)

Create one virtual environment per `pins-*.txt`, `pip install -r` it, then run `gen_trace.py --flavor a|b|d --out trace.json` or `gen_agents.py trace.json`. Flavor `d` needs the `a` environment.

## Known weaknesses found by independent review (spike frozen as is)

An independent review of the first ADR draft found these limits in the spike's own checks. The code was not changed; treat the results as exploratory.

- The "lossless round trip" compares the run log with the importer's own flattened spans, not with the raw input. Span `flags`, scope `schemaUrl` and log record fields (`observedTimeUnixNano`, `flags`, most attributes) are not carried into the run log.
- Order independence uses one fixed shuffle on traces with no timestamp ties and no span anomalies, so tie-breaking and anomaly ordering are not exercised. Several malformed cases (duplicate ids, two missing parents, a cycle) can still change output with input order.
- The error count matches the string `STATUS_CODE_ERROR` on both sides; the generators emit enum names (protobuf `MessageToDict`), whereas OTLP/JSON uses integers. With integer codes the count would read zero.
- Prefix reproducibility compares a function with itself. Hashes of structured content are `sha256("[object Object]")`, and `gen_ai.system_instructions` is not in the content-key list.
- `mutate.mjs` asserts nothing, always exits 0, re-imports in the same order, and hides one note code.
- In traces a, b and d the tool, agent and root spans come from `gen_trace.py`, not from instrumentation; only the chat spans are third-party.
- Not handled: very deep nesting, `__proto__` as an id, string-typed usage values, non-finite numbers.

## Limits

Synthetic traces from one process and one clock; no streaming responses; no real production traces; no UI; the citation probe is mechanical string matching and says nothing about whether a source supports a claim. A budget replay is counterfactual ("would have stopped"), never enforcement.
