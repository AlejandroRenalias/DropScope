import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

import { buildSubscriptionLiveWorkerPlan, firstLiveSubscriptionWorkerGuard } from "./subscription-live-worker-contract.js";
import { type AppServerProcess, type AppServerSpawner, spawnCodexAppServer } from "./subscription-runtime-preflight.js";
import type { WorkerRequest } from "./worker-adapter.js";

export type SubscriptionLiveWorkerTerminalOutcome = "TIMEOUT" | "UNAVAILABLE" | "APPROVAL_DECLINED" | "INTERRUPTED" | "INVALID_RESULT" | "TURN_FAILED";

/** A closed, non-diagnostic failure that the runtime may safely persist. */
export class SubscriptionLiveWorkerError extends Error {
  constructor(readonly outcome: SubscriptionLiveWorkerTerminalOutcome, readonly elapsedMs: number) {
    super(`Subscription worker ended with ${outcome}.`);
    this.name = "SubscriptionLiveWorkerError";
  }
}

export interface SubscriptionLiveWorkerRunner {
  run(request: WorkerRequest, sandboxCwd: string): Promise<unknown>;
}

/**
 * The only process-backed worker adapter. It keeps app-server identifiers,
 * messages, commands, paths, and errors inside this call and returns only the
 * final assistant JSON candidate to the existing result gate.
 */
export class CodexSubscriptionLiveWorkerAdapter implements SubscriptionLiveWorkerRunner {
  constructor(
    private readonly spawnAppServer: AppServerSpawner = spawnCodexAppServer,
    private readonly now: () => number = Date.now,
    private readonly timeoutMs = firstLiveSubscriptionWorkerGuard.timeoutMs,
  ) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > firstLiveSubscriptionWorkerGuard.timeoutMs) {
      throw new Error("Subscription worker timeout must be within the fixed 90-second maximum.");
    }
  }

  async run(request: WorkerRequest, sandboxCwd: string): Promise<unknown> {
    const startedAt = this.now();
    let appServer: AppServerProcess | undefined;
    let rpc: LiveWorkerRpc | undefined;
    const elapsed = () => Math.min(this.timeoutMs, Math.max(0, this.now() - startedAt));
    const failure = (outcome: SubscriptionLiveWorkerTerminalOutcome) => new SubscriptionLiveWorkerError(outcome, elapsed());

    try {
      appServer = this.spawnAppServer();
      rpc = new LiveWorkerRpc(appServer, (method) => {
        rpc?.abort(failure(isApprovalRequest(method) ? "APPROVAL_DECLINED" : "TURN_FAILED"));
      });
      return await withTimeout(this.runTurn(rpc, request, sandboxCwd), this.timeoutMs, () => rpc?.abort(failure("TIMEOUT")));
    } catch (error: unknown) {
      if (error instanceof SubscriptionLiveWorkerError) throw new SubscriptionLiveWorkerError(error.outcome, elapsed());
      throw failure("UNAVAILABLE");
    } finally {
      appServer?.kill();
    }
  }

  private async runTurn(rpc: LiveWorkerRpc, request: WorkerRequest, sandboxCwd: string): Promise<unknown> {
    const initialization = rpc.request(1, "initialize", {
      clientInfo: { name: "dropscope", title: "DropScope", version: "0.1" },
    });
    rpc.notify("initialized", {});
    if (!isRecord(await initialization)) throw new SubscriptionLiveWorkerError("UNAVAILABLE", 0);

    const plan = buildSubscriptionLiveWorkerPlan(request, sandboxCwd);
    const thread = await rpc.request(2, plan.requests[0].method, plan.requests[0].params);
    const threadId = threadResultId(thread);
    if (!threadId) throw new SubscriptionLiveWorkerError("UNAVAILABLE", 0);
    const turnParams = { ...plan.requests[1].params, threadId };
    await rpc.request(3, plan.requests[1].method, turnParams);

    const completed = await rpc.waitForTurn();
    if (completed.status === "interrupted") throw new SubscriptionLiveWorkerError("INTERRUPTED", 0);
    if (completed.status !== "completed") throw new SubscriptionLiveWorkerError("TURN_FAILED", 0);
    if (!completed.agentText) throw new SubscriptionLiveWorkerError("INVALID_RESULT", 0);
    try {
      return JSON.parse(completed.agentText) as unknown;
    } catch {
      throw new SubscriptionLiveWorkerError("INVALID_RESULT", 0);
    }
  }
}

interface RpcResponse {
  id?: number | string;
  result?: unknown;
  error?: unknown;
  method?: unknown;
  params?: unknown;
}

interface TurnCompletion {
  status: string;
  agentText?: string;
}

class LiveWorkerRpc {
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private readonly turn = deferred<TurnCompletion>();
  private latestAgentText: string | undefined;
  private aborted = false;
  private abortError: Error | undefined;

  constructor(private readonly process: AppServerProcess, private readonly onServerRequest: (method: string) => void) {
    const lines = createInterface({ input: process.stdout });
    lines.on("line", (line) => this.receive(line));
    process.once("error", () => this.abort(new SubscriptionLiveWorkerError("UNAVAILABLE", 0)));
    process.once("exit", () => this.abort(new SubscriptionLiveWorkerError("UNAVAILABLE", 0)));
  }

  request(id: number, method: string, params: unknown): Promise<unknown> {
    if (this.abortError) return Promise.reject(this.abortError);
    const response = new Promise<unknown>((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.write({ method, id, params });
    return response;
  }

  notify(method: string, params: unknown): void {
    this.write({ method, params });
  }

  waitForTurn(): Promise<TurnCompletion> {
    return this.abortError ? Promise.reject(this.abortError) : this.turn.promise;
  }

  abort(error: Error): void {
    if (this.aborted) return;
    this.aborted = true;
    this.abortError = error;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.turn.reject(error);
  }

  private write(message: unknown): void {
    if (this.aborted) return;
    try {
      this.process.stdin.write(`${JSON.stringify(message)}\n`);
    } catch {
      this.abort(new SubscriptionLiveWorkerError("UNAVAILABLE", 0));
    }
  }

  private receive(line: string): void {
    let message: RpcResponse;
    try { message = JSON.parse(line) as RpcResponse; } catch { return; }
    if ((typeof message.id === "number" || typeof message.id === "string") && typeof message.method === "string") {
      this.onServerRequest(message.method);
      return;
    }
    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error !== undefined) pending.reject(new SubscriptionLiveWorkerError("UNAVAILABLE", 0));
      else pending.resolve(message.result);
      return;
    }
    if (message.method === "item/completed") {
      const item = isRecord(message.params) ? message.params.item : undefined;
      if (isRecord(item) && item.type === "agentMessage" && typeof item.text === "string") this.latestAgentText = item.text;
      return;
    }
    if (message.method === "turn/completed") {
      const turn = isRecord(message.params) ? message.params.turn : undefined;
      if (!isRecord(turn) || typeof turn.status !== "string") {
        this.abort(new SubscriptionLiveWorkerError("TURN_FAILED", 0));
        return;
      }
      this.turn.resolve({ status: turn.status, agentText: this.latestAgentText ?? agentTextFromItems(turn.items) });
    }
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  // A server can decline an approval synchronously with turn/start, before the
  // caller reaches waitForTurn. Keep that expected fail-closed rejection
  // observed until the caller awaits the same promise.
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, onTimeout: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => { onTimeout(); reject(new SubscriptionLiveWorkerError("TIMEOUT", timeoutMs)); }, timeoutMs);
    void promise.then(
      (value) => { clearTimeout(timeout); resolve(value); },
      (error: unknown) => { clearTimeout(timeout); reject(error); },
    );
  });
}

function threadResultId(value: unknown): string | undefined {
  if (!isRecord(value) || !isRecord(value.thread) || typeof value.thread.id !== "string" || value.thread.id.length === 0) return undefined;
  return value.thread.id;
}

function isApprovalRequest(method: string): boolean {
  return method === "item/commandExecution/requestApproval" || method === "item/fileChange/requestApproval" || method === "item/permissions/requestApproval";
}

function agentTextFromItems(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  for (const item of [...value].reverse()) {
    if (isRecord(item) && item.type === "agentMessage" && typeof item.text === "string") return item.text;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
