import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

export const subscriptionPreflightStatuses = [
  "CHATGPT_AUTHENTICATED",
  "AUTHENTICATION_REQUIRED",
  "UNSUPPORTED_AUTH_MODE",
  "UNAVAILABLE",
] as const;
export type SubscriptionPreflightStatus = (typeof subscriptionPreflightStatuses)[number];

export interface SubscriptionRuntimePreflight {
  check(): Promise<SubscriptionPreflightStatus>;
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

  async check(): Promise<SubscriptionPreflightStatus> {
    let process: AppServerProcess | undefined;
    try {
      process = this.spawnAppServer();
      const rpc = new AppServerRpc(process, this.timeoutMs);
      await rpc.request(1, "initialize", { clientInfo: { name: "dropscope", title: "DropScope", version: "0.1" } });
      rpc.notify("initialized", {});
      const response = await rpc.request(2, "account/read", { refreshToken: false });
      return mapAccountReadResponse(response);
    } catch {
      return "UNAVAILABLE";
    } finally {
      process?.kill();
    }
  }
}

export function mapAccountReadResponse(response: unknown): SubscriptionPreflightStatus {
  if (!isRecord(response)) return "UNAVAILABLE";
  const account = response.account;
  if (isRecord(account) && account.type === "chatgpt") return "CHATGPT_AUTHENTICATED";
  if (account === null && response.requiresOpenaiAuth === true) return "AUTHENTICATION_REQUIRED";
  if (account === null || isRecord(account)) return "UNSUPPORTED_AUTH_MODE";
  return "UNAVAILABLE";
}

class AppServerRpc {
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

  constructor(private readonly process: AppServerProcess, private readonly timeoutMs: number) {
    const lines = createInterface({ input: process.stdout });
    lines.on("line", (line) => this.receive(line));
    process.once("error", () => this.rejectAll(new Error("Codex app-server is unavailable.")));
    process.once("exit", () => this.rejectAll(new Error("Codex app-server exited before the preflight completed.")));
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
      pending.reject(new Error(typeof response.error.message === "string" ? response.error.message : "Codex app-server rejected the preflight."));
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
      reject(new Error("Codex app-server preflight timed out."));
    }, timeoutMs);
    void promise.then((value) => { clearTimeout(timeout); resolve(value); }, (error: unknown) => { clearTimeout(timeout); reject(error); });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
