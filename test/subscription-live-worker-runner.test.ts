import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import { CodexSubscriptionLiveWorkerAdapter, SubscriptionLiveWorkerError } from "../src/subscription-live-worker-runner.js";
import type { AppServerProcess } from "../src/subscription-runtime-preflight.js";
import type { WorkerRequest } from "../src/worker-adapter.js";

const request: WorkerRequest = { missionId: "mission-1", taskId: "pilot-evidence", attemptId: "pilot-evidence:a1", objective: "Analyze the supplied local pilot fixture only.", workerRole: "EVIDENCE_RESEARCHER", maxCost: 10 };

class FakeLiveAppServer extends EventEmitter implements AppServerProcess {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly messages: Array<Record<string, unknown>> = [];
  readonly kill = vi.fn(() => { this.emit("exit"); return true; });

  constructor(
    private readonly turn: (server: FakeLiveAppServer) => void,
    private readonly account: unknown = { account: { type: "chatgpt" } },
  ) {
    super();
    this.stdin.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString("utf8").split("\n").filter(Boolean)) {
        const message = JSON.parse(line) as Record<string, unknown>;
        this.messages.push(message);
        if (message.id === 1) this.respond(1, {});
        if (message.id === 2) this.respond(2, this.account);
        if (message.id === 3) this.respond(3, { thread: { id: "private-thread-id" } });
        if (message.id === 4) {
          this.respond(4, { turn: { id: "private-turn-id", status: "inProgress", items: [] } });
          this.turn(this);
        }
      }
    });
  }

  respond(id: number, result: unknown): void { this.stdout.write(`${JSON.stringify({ id, result })}\n`); }
  notify(method: string, params: unknown): void { this.stdout.write(`${JSON.stringify({ method, params })}\n`); }
  request(method: string, params: unknown): void { this.stdout.write(`${JSON.stringify({ id: "private-request-id", method, params })}\n`); }
}

describe("CodexSubscriptionLiveWorkerAdapter", () => {
  it("starts exactly one thread and turn, keeps identifiers private, and returns only final assistant JSON", async () => {
    const process = new FakeLiveAppServer((server) => {
      const result = JSON.stringify({ taskId: request.taskId, attemptId: request.attemptId, status: "COMPLETED", finding: "Inline pilot evidence only." });
      server.notify("item/completed", { item: { type: "agentMessage", text: result } });
      server.notify("turn/completed", { turn: { status: "completed", items: [{ type: "agentMessage", text: result }] } });
    });

    const output = await new CodexSubscriptionLiveWorkerAdapter(() => process).run(request, "C:/isolated-pilot");
    expect(output).toEqual({ taskId: request.taskId, attemptId: request.attemptId, status: "COMPLETED", finding: "Inline pilot evidence only." });
    expect(process.messages.filter((message) => message.method === "thread/start")).toHaveLength(1);
    expect(process.messages.filter((message) => message.method === "turn/start")).toHaveLength(1);
    expect(process.messages.find((message) => message.method === "turn/start")).toMatchObject({ params: { cwd: "C:/isolated-pilot", sandboxPolicy: { type: "readOnly", networkAccess: false } } });
    expect(JSON.stringify(output)).not.toContain("private-thread-id");
    expect(process.kill).toHaveBeenCalledOnce();
  });

  it("fails closed and terminates when app-server requests any approval", async () => {
    let now = 1_000;
    const process = new FakeLiveAppServer((server) => {
      now = 1_009;
      server.request("item/commandExecution/requestApproval", { command: "private command", threadId: "private", turnId: "private" });
    });

    await expect(new CodexSubscriptionLiveWorkerAdapter(() => process, () => now).run(request, "C:/isolated-pilot")).rejects.toEqual(expect.objectContaining({ outcome: "APPROVAL_DECLINED", elapsedMs: 9 } satisfies Partial<SubscriptionLiveWorkerError>));
    expect(process.messages.some((message) => "result" in message && JSON.stringify(message).includes("accept"))).toBe(false);
    expect(process.kill).toHaveBeenCalledOnce();
  });

  it("refuses a non-ChatGPT account in the same app-server session before a thread starts", async () => {
    const process = new FakeLiveAppServer(
      () => { throw new Error("a turn must not start"); },
      { account: { type: "apiKey" } },
    );

    await expect(new CodexSubscriptionLiveWorkerAdapter(() => process).run(request, "C:/isolated-pilot")).rejects.toEqual(expect.objectContaining({ outcome: "UNAVAILABLE" }));
    expect(process.messages.some((message) => message.method === "thread/start" || message.method === "turn/start")).toBe(false);
    expect(process.kill).toHaveBeenCalledOnce();
  });

  it("fails closed when a non-passive tool item appears", async () => {
    const process = new FakeLiveAppServer((server) => {
      server.notify("item/started", { item: { type: "mcpToolCall", server: "private", tool: "side-effect" } });
    });

    await expect(new CodexSubscriptionLiveWorkerAdapter(() => process).run(request, "C:/isolated-pilot")).rejects.toEqual(expect.objectContaining({ outcome: "TURN_FAILED" }));
    expect(process.kill).toHaveBeenCalledOnce();
  });

  it("fails closed when a tool item appears only in the final turn payload", async () => {
    const process = new FakeLiveAppServer((server) => {
      server.notify("turn/completed", {
        turn: {
          status: "completed",
          items: [
            { type: "agentMessage", text: JSON.stringify({ taskId: request.taskId, attemptId: request.attemptId, status: "COMPLETED", finding: "Must not be accepted." }) },
            { type: "mcpToolCall", server: "private", tool: "side-effect" },
          ],
        },
      });
    });

    await expect(new CodexSubscriptionLiveWorkerAdapter(() => process).run(request, "C:/isolated-pilot")).rejects.toEqual(expect.objectContaining({ outcome: "TURN_FAILED" }));
    expect(process.kill).toHaveBeenCalledOnce();
  });

  it("classifies malformed final output without exposing it", async () => {
    const process = new FakeLiveAppServer((server) => {
      server.notify("item/completed", { item: { type: "agentMessage", text: "not json: private details" } });
      server.notify("turn/completed", { turn: { status: "completed", items: [{ type: "agentMessage", text: "not json: private details" }] } });
    });

    await expect(new CodexSubscriptionLiveWorkerAdapter(() => process).run(request, "C:/isolated-pilot")).rejects.toEqual(expect.objectContaining({ outcome: "INVALID_RESULT" }));
  });
});
