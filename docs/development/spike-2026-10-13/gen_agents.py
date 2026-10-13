"""Flavor "c": OpenAI Agents SDK (real agent framework) + its OTel instrumentation, against a local stub.
Triage agent hands off to a researcher agent that calls function tools (some in parallel). Synthetic, loopback only."""
import base64, json, os, sys, threading, time, zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

out = sys.argv[1]
_n = {"n": 0}
TRUTH = {"promptTokens": 0, "completionTokens": 0, "okCalls": 0, "rejected429": 0}
_lock = threading.Lock()


class Stub(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        msgs = body["messages"]
        with _lock:
            _n["n"] += 1
            n = _n["n"]
        time.sleep(0.01)
        system = " ".join(m["content"] for m in msgs if m["role"] == "system" and isinstance(m.get("content"), str))
        tool_msgs = [m for m in msgs if m["role"] == "tool"]
        real_tools = [m for m in tool_msgs if not str(m.get("content", "")).startswith('{"assistant"')]
        tool_names = [t["function"]["name"] for t in body.get("tools", [])]
        msg, finish = None, "stop"
        if "triage" in system.lower() and not tool_msgs:
            h = next(t for t in tool_names if t.startswith("transfer_to"))
            msg = {"role": "assistant", "content": None, "tool_calls": [{"id": f"call_{n:03d}a", "type": "function", "function": {"name": h, "arguments": "{}"}}]}
            finish = "tool_calls"
        elif "researcher" in system.lower() and len(real_tools) < 6:
            k = len(real_tools)
            calls = [{"id": f"call_{n:03d}{c}", "type": "function", "function": {"name": "search_web", "arguments": json.dumps({"query": f"synthetic topic {k + c}"})}} for c in range(2 if k % 4 == 0 else 1)]
            msg = {"role": "assistant", "content": None, "tool_calls": calls}
            finish = "tool_calls"
        else:
            msg = {"role": "assistant", "content": "Synthetic finding: widget demand rose 12% [S3]. Lead time is 9 days [S12]."}
        resp = {"id": f"chatcmpl-{n:04d}", "object": "chat.completion", "created": 1760000000 + n, "model": "stub-model-1",
                "choices": [{"index": 0, "message": msg, "finish_reason": finish}],
                "usage": {"prompt_tokens": 90 + 11 * n, "completion_tokens": 15 + n % 7, "total_tokens": 105 + 11 * n + n % 7}}
        with _lock:
            TRUTH["promptTokens"] += resp["usage"]["prompt_tokens"]; TRUTH["completionTokens"] += resp["usage"]["completion_tokens"]; TRUTH["okCalls"] += 1
        data = json.dumps(resp).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


server = ThreadingHTTPServer(("127.0.0.1", 0), Stub)
threading.Thread(target=server.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{server.server_address[1]}/v1"

os.environ.setdefault("OTEL_SEMCONV_STABILITY_OPT_IN", "gen_ai_latest_experimental")
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor, SpanExporter, SpanExportResult
from opentelemetry.exporter.otlp.proto.common.trace_encoder import encode_spans
from google.protobuf.json_format import MessageToDict


class Collect(SpanExporter):
    def __init__(self):
        self.spans = []

    def export(self, spans):
        self.spans.extend(spans)
        return SpanExportResult.SUCCESS


collector = Collect()
provider = TracerProvider(resource=Resource.create({"service.name": "synthetic-agents-sdk", "service.version": "0.0.0-spike"}))
provider.add_span_processor(SimpleSpanProcessor(collector))

import agents
from agents import Agent, Runner, function_tool, OpenAIChatCompletionsModel, set_tracing_disabled
from agents.tracing import set_trace_processors
from openai import AsyncOpenAI
from opentelemetry.instrumentation.openai_agents import OpenAIAgentsInstrumentor

inst = OpenAIAgentsInstrumentor()
inst.instrument(tracer_provider=provider, capture_message_content="span_only", base_url=BASE, server_address="127.0.0.1", server_port=server.server_address[1])
set_trace_processors([inst._processor])  # drop the SDK's default exporter so nothing leaves the machine

client = AsyncOpenAI(base_url=BASE, api_key="stub-not-a-secret", max_retries=0)
model = OpenAIChatCompletionsModel(model="stub-model-1", openai_client=client)


@function_tool
def search_web(query: str) -> str:
    time.sleep(0.005)
    return f"Synthetic result for '{query}': Source S{zlib.crc32(query.encode()) % 13} says widget metric changed."


researcher = Agent(name="researcher", instructions="You are the researcher agent. Use search_web, then answer with citations.", tools=[search_web], model=model)
triage = Agent(name="triage", instructions="You are the triage agent. Hand off to the researcher.", handoffs=[researcher], model=model)
result = Runner.run_sync(triage, "Investigate synthetic widget demand.")
print("final:", result.final_output)
provider.force_flush()
server.shutdown()

d = MessageToDict(encode_spans(collector.spans))
for rs in d["resourceSpans"]:
    for ss in rs["scopeSpans"]:
        for s in ss["spans"]:
            for k in ("traceId", "spanId", "parentSpanId"):
                if k in s:
                    s[k] = base64.b64decode(s[k]).hex()
json.dump(d, open(out, "w"), indent=1, sort_keys=True)
json.dump(TRUTH, open(out + ".truth", "w"))
print(f"flavor=c spans={len(collector.spans)} wrote={out}")
