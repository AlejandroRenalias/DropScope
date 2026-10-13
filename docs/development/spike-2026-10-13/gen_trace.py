"""Spike trace generator: stub OpenAI-compatible server + third-party OTel instrumentation.

Everything is synthetic and local (127.0.0.1). No external network, no API key.
Flavor "a": opentelemetry-instrumentation-openai-v2 (GenAI semconv), content captured,
            single agent, sequential tool loop, one 429 + retry.
Flavor "b": opentelemetry-instrumentation-openai (OpenLLMetry), content NOT captured,
            planner + two parallel worker sub-agents, one tool exception.
"""
import argparse, zlib, base64, json, os, sys, threading, time, contextvars
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ap = argparse.ArgumentParser()
ap.add_argument("--flavor", choices=["a", "b", "d"], required=True)
ap.add_argument("--out", required=True)
args = ap.parse_args()

# ---------------------------------------------------------------- stub LLM server
_lock = threading.Lock()
_calls = {"n": 0, "rate_limited": False}
TRUTH = {"promptTokens": 0, "completionTokens": 0, "okCalls": 0, "rejected429": 0}


class Stub(BaseHTTPRequestHandler):
    def log_message(self, *a):  # silence
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        msgs = body["messages"]
        user = next(m["content"] for m in msgs if m["role"] == "user")
        with _lock:
            _calls["n"] += 1
            n = _calls["n"]
        time.sleep(0.01 + (n % 5) * 0.004)
        if "FORCE-429-ONCE" in user and not _calls["rate_limited"]:
            _calls["rate_limited"] = True
            TRUTH["rejected429"] += 1
            self.send_response(429)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": {"message": "synthetic rate limit", "type": "rate_limit_error"}}).encode())
            return
        step = user.split("STEP:")[-1].split()[0] if "STEP:" in user else "x"
        if "FINAL" in user:
            msg = {"role": "assistant", "content": "Synthetic finding: Widget demand rose 12% [S3] and unit cost fell 4% [S7]. Supplier lead time is 9 days [S12]. The market is saturated [S99]."}
            finish = "stop"
        else:
            tool = "fetch" if "FETCH" in user else "search"
            msg = {"role": "assistant", "content": None, "tool_calls": [{"id": f"call_{n:04d}", "type": "function", "function": {"name": tool, "arguments": json.dumps({"q": f"synthetic query {step}"})}}]}
            finish = "tool_calls"
        resp = {"id": f"chatcmpl-{n:04d}", "object": "chat.completion", "created": 1760000000 + n, "model": "stub-model-1",
                "choices": [{"index": 0, "message": msg, "finish_reason": finish}],
                "usage": {"prompt_tokens": 100 + 7 * n, "completion_tokens": 20 + (n % 9), "total_tokens": 120 + 7 * n + (n % 9)}}
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

# ---------------------------------------------------------------- OTel setup
os.environ.setdefault("OTEL_SEMCONV_STABILITY_OPT_IN", "gen_ai_latest_experimental")
if args.flavor == "a":
    os.environ["OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT"] = "SPAN_ONLY"
elif args.flavor == "d":
    os.environ["OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT"] = "EVENT_ONLY"
    os.environ["OTEL_INSTRUMENTATION_GENAI_EMIT_EVENT"] = "true"
else:
    os.environ["TRACELOOP_TRACE_CONTENT"] = "false"

from opentelemetry import trace, context as otel_context
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor, SpanExporter, SpanExportResult
from opentelemetry.exporter.otlp.proto.common.trace_encoder import encode_spans
from google.protobuf.json_format import MessageToDict
from opentelemetry.trace import Status, StatusCode


class Collect(SpanExporter):
    def __init__(self):
        self.spans = []

    def export(self, spans):
        self.spans.extend(spans)
        return SpanExportResult.SUCCESS


collector = Collect()
provider = TracerProvider(resource=Resource.create({"service.name": "synthetic-agent", "service.version": "0.0.0-spike"}))
provider.add_span_processor(SimpleSpanProcessor(collector))
trace.set_tracer_provider(provider)
tracer = trace.get_tracer("spike.agent", "0.0.0")

log_exporter = None
if args.flavor in ("a", "d"):
    from opentelemetry.instrumentation.openai_v2 import OpenAIInstrumentor
    lp = None
    if args.flavor == "d":
        from opentelemetry.sdk._logs import LoggerProvider
        from opentelemetry.sdk._logs.export import SimpleLogRecordProcessor, InMemoryLogRecordExporter
        log_exporter = InMemoryLogRecordExporter()
        lp = LoggerProvider(resource=Resource.create({"service.name": "synthetic-agent", "service.version": "0.0.0-spike"}))
        lp.add_log_record_processor(SimpleLogRecordProcessor(log_exporter))
    OpenAIInstrumentor().instrument(tracer_provider=provider, logger_provider=lp)
else:
    from opentelemetry.instrumentation.openai import OpenAIInstrumentor
    OpenAIInstrumentor().instrument(tracer_provider=provider)

from openai import OpenAI, RateLimitError

client = OpenAI(base_url=BASE, api_key="stub-not-a-secret", max_retries=0)
CAPTURE = args.flavor == "a"  # tool content as attributes only in flavor a
TOOLS = [{"type": "function", "function": {"name": n, "description": f"synthetic {n}", "parameters": {"type": "object", "properties": {"q": {"type": "string"}}}}} for n in ("search", "fetch")]


def chat(prompt):
    return client.chat.completions.create(model="stub-model-1", messages=[{"role": "system", "content": "You are a synthetic research agent."}, {"role": "user", "content": prompt}], tools=TOOLS)


def tool(name, q, fail=False):
    with tracer.start_as_current_span(f"execute_tool {name}", kind=trace.SpanKind.INTERNAL) as sp:
        sp.set_attribute("gen_ai.operation.name", "execute_tool")
        sp.set_attribute("gen_ai.tool.name", name)
        sp.set_attribute("gen_ai.tool.type", "function")
        if CAPTURE:
            sp.set_attribute("gen_ai.tool.call.arguments", json.dumps({"q": q}))
        time.sleep(0.006)
        if fail:
            err = TimeoutError("synthetic tool timeout")
            sp.record_exception(err)
            sp.set_status(Status(StatusCode.ERROR, "synthetic tool timeout"))
            return None
        result = f"Synthetic result for '{q}': Source S{zlib.crc32(q.encode()) % 13} says widget metric changed."
        if CAPTURE:
            sp.set_attribute("gen_ai.tool.call.result", result)
        return result


def agent_loop(name, steps, flavor_extra=False):
    with tracer.start_as_current_span(f"invoke_agent {name}", kind=trace.SpanKind.INTERNAL) as sp:
        sp.set_attribute("gen_ai.operation.name", "invoke_agent")
        sp.set_attribute("gen_ai.agent.name", name)
        for i in steps:
            prompt = f"STEP:{i} gather evidence for synthetic topic"
            if i == 5 and name == "research-agent":
                prompt += " FORCE-429-ONCE"
                try:
                    chat(prompt)
                except RateLimitError:
                    pass  # span already ended with ERROR; agent retries once
            chat(prompt)
            tool("search", f"topic {i}")
            chat(f"STEP:{i} FETCH page")
            tool("fetch", f"page {i}", fail=(args.flavor == "b" and name == "worker-2" and i == steps[1]))
        chat("FINAL write findings with citations")


if args.flavor in ("a", "d"):
    with tracer.start_as_current_span("run research-agent"):
        agent_loop("research-agent", list(range(1, 14)))
else:
    with tracer.start_as_current_span("workflow multi-agent"):
        with tracer.start_as_current_span("invoke_agent planner") as sp:
            sp.set_attribute("gen_ai.operation.name", "invoke_agent")
            sp.set_attribute("gen_ai.agent.name", "planner")
            chat("STEP:0 plan the work")
            ctx = contextvars.copy_context()
            with ThreadPoolExecutor(max_workers=2) as pool:
                futs = [pool.submit(contextvars.copy_context().run, agent_loop, w, steps) for w, steps in (("worker-1", [1, 2, 3, 4, 5, 6]), ("worker-2", [7, 8, 9, 10, 11, 12]))]
                for f in futs:
                    f.result()
            chat("FINAL merge worker results with citations")

provider.force_flush()
server.shutdown()

# ---------------------------------------------------------------- write OTLP/JSON
req = encode_spans(collector.spans)
d = MessageToDict(req)  # proto3 JSON mapping; bytes -> base64


def hexify(v):
    return base64.b64decode(v).hex()


for rs in d["resourceSpans"]:
    for ss in rs["scopeSpans"]:
        for s in ss["spans"]:
            for k in ("traceId", "spanId", "parentSpanId"):
                if k in s:
                    s[k] = hexify(s[k])
with open(args.out, "w") as f:
    json.dump(d, f, indent=1, sort_keys=True)
if log_exporter is not None:
    from opentelemetry.exporter.otlp.proto.common._log_encoder import encode_logs
    ld = MessageToDict(encode_logs(log_exporter.get_finished_logs()))
    for rl in ld.get("resourceLogs", []):
        for sl in rl["scopeLogs"]:
            for lr in sl["logRecords"]:
                for k in ("traceId", "spanId"):
                    if k in lr:
                        lr[k] = hexify(lr[k])
    json.dump(ld, open(args.out.replace(".json", ".logs.json"), "w"), indent=1, sort_keys=True)
    print("log records:", len(log_exporter.get_finished_logs()))
json.dump(TRUTH, open(args.out + ".truth", "w"))
print(f"flavor={args.flavor} spans={len(collector.spans)} wrote={args.out}")
