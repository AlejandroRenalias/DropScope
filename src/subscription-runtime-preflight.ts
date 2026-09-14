import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import type { SubscriptionRuntimePreflightDiagnosticCode, SubscriptionRuntimePreflightStatus } from "./contracts.js";

export interface SubscriptionPreflightResult {
  accessStatus: SubscriptionRuntimePreflightStatus;
  diagnosticCode: SubscriptionRuntimePreflightDiagnosticCode;
}

export interface SubscriptionRuntimePreflight {
  check(): Promise<SubscriptionPreflightResult>;
}

export interface AppServerProcess {
  stdin: Writable;
  stdout: Readable;
  kill(): boolean;
  once(event: "error", listener: (error: Error) => void): this;
  once(event: "exit", listener: () => void): this;
}
export type AppServerSpawner = () => AppServerProcess;

interface RpcResponse {
  id?: number;
  result?: unknown;
  error?: { message?: unknown };
}

const defaultSpawner: AppServerSpawner = () => spawn("codex", ["app-server"], {
  stdio: ["pipe", "pipe", "ignore"],
  windowsHide: true,
});

/**
 * Runs only Codex app-server initialization and account/read with refresh disabled.
 * It deliberately maps the response to a coarse status and discards identity,
 * plan, usage, and credential fields before anything can reach DropScope state.
 */
export class CodexAppServerPreflight implements SubscriptionRuntimePreflight {
  constructor(
    private readonly spawnAppServer: AppServerSpawner = defaultSpawner,
    private readonly timeoutMs = 10_000,
  ) {}

  async check(): Promise<SubscriptionPreflightResult> {
    let process: AppServerProcess | undefined;
    try {
      process = this.spawnAppServer();
    } catch {
      return unavailable("APP_SERVER_START_FAILED");
    }
    try {
      const rpc = new AppServerRpc(process, this.timeoutMs);
      const initializeResponse = await rpc.request(1, "initialize", { clientInfo: { name: "dropscope", title: "DropScope", version: "0.1" } });
      if (!isRecord(initializeResponse)) return unavailable("INITIALIZATION_RESPONSE_INVALID");
      rpc.notify("initialized", {});
      let response: unknown;
      try {
        response = await rpc.request(2, "account/read", { refreshToken: false });
      } catch (error) {
        return unavailable(error instanceof AppServerTimeoutError ? "ACCOUNT_READ_TIMED_OUT" : "ACCOUNT_READ_FAILED");
      }
      const accessStatus = mapAccountReadResponse(response);
      return accessStatus === "UNAVAILABLE"
        ? unavailable("ACCOUNT_RESPONSE_INVALID")
        : { accessStatus, diagnosticCode: "NOT_APPLICABLE" };
    } catch (error) {
      return unavailable(classifyInitializationFailure(error));
    } finally {
      process?.kill();
    }
  }
}

function classifyInitializationFailure(error: unknown): Exclude<SubscriptionRuntimePreflightDiagnosticCode, "NOT_APPLICABLE"> {
  if (error instanceof AppServerTimeoutError) return "INITIALIZATION_TIMED_OUT";
  if (error instanceof AppServerExitedError) return "APP_SERVER_EXITED_DURING_INITIALIZATION";
  if (error instanceof AppServerRpcRejectedError) return "INITIALIZATION_REJECTED";
  return "INITIALIZATION_FAILED";
}

export function mapAccountReadResponse(response: unknown): SubscriptionRuntimePreflightStatus {
  if (!isRecord(response)) return "UNAVAILABLE";
  const account = response.account;
  if (isRecord(account) && account.type === "chatgpt") return "CHATGPT_AUTHENTICATED";
  if (account === null && response.requiresOpenaiAuth === true) return "AUTHENTICATION_REQUIRED";
  if (account === null || isRecord(account)) return "UNSUPPORTED_AUTH_MODE";
  return "UNAVAILABLE";
}

function unavailable(diagnosticCode: Exclude<SubscriptionRuntimePreflightDiagnosticCode, "NOT_APPLICABLE">): SubscriptionPreflightResult {
  return { accessStatus: "UNAVAILABLE", diagnosticCode };
}

class AppServerRpc {
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

  constructor(private readonly process: AppServerProcess, private readonly timeoutMs: number) {
    const lines = createInterface({ input: process.stdout });
    lines.on("line", (line) => this.receive(line));
    process.once("error", () => this.rejectAll(new AppServerProcessError()));
    process.once("exit", () => this.rejectAll(new AppServerExitedError()));
  }

  request(id: number, method: string, params: unknown): Promise<unknown> {
    const response = new Promise<unknown>((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.write({ method, id, params });
    return withTimeout(response, this.timeoutMs, () => this.pending.delete(id));
  }

  notify(method: string, params: unknown): void {
    this.write({ method, params });
  }

  private write(message: unknown): void {
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private receive(line: string): void {
    let response: RpcResponse;
    try { response = JSON.parse(line) as RpcResponse; } catch { return; }
    if (typeof response.id !== "number") return;
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    if (response.error) {
      pending.reject(new AppServerRpcRejectedError());
      return;
    }
    pending.resolve(response.result);
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, onTimeout: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      onTimeout();
      reject(new AppServerTimeoutError());
    }, timeoutMs);
    void promise.then((value) => { clearTimeout(timeout); resolve(value); }, (error: unknown) => { clearTimeout(timeout); reject(error); });
  });
}

class AppServerTimeoutError extends Error {
  constructor() {
    super("Codex app-server preflight timed out.");
  }
}

class AppServerProcessError extends Error {
  constructor() {
    super("Codex app-server process failed.");
  }
}

class AppServerExitedError extends Error {
  constructor() {
    super("Codex app-server exited before the preflight completed.");
  }
}

class AppServerRpcRejectedError extends Error {
  constructor() {
    super("Codex app-server rejected the preflight.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
