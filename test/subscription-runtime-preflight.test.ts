import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import { CodexAppServerPreflight, mapAccountReadResponse, type AppServerProcess } from "../src/subscription-runtime-preflight.js";

class FakeAppServer extends EventEmitter implements AppServerProcess {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly messages: unknown[] = [];
  readonly kill = vi.fn(() => {
    this.emit("exit");
    return true;
  });

  constructor(
    accountResponse: unknown,
    private readonly options: { initializationResponseDelayMs?: number; accountResponseDelayMs?: number; rejectInitialization?: boolean; exitDuringInitialization?: boolean; invalidInitializationResponse?: boolean; requireInitializedBeforeInitializationResponse?: boolean; failAccountRead?: boolean } = {},
  ) {
    super();
    this.stdin.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString("utf8").split("\n").filter(Boolean)) {
        const message = JSON.parse(line) as { id?: number; method?: string };
        this.messages.push(message);
        if (message.id === 1) {
          setTimeout(() => {
            if (this.options.exitDuringInitialization) {
              this.emit("exit");
              return;
            }
            const initializedWasConfirmed = this.messages.some((candidate) => isInitializedNotification(candidate));
            const response = this.options.rejectInitialization || (this.options.requireInitializedBeforeInitializationResponse && !initializedWasConfirmed)
              ? { id: 1, error: { message: "private initialization failure" } }
              : { id: 1, result: this.options.invalidInitializationResponse ? null : {} };
            this.stdout.write(JSON.stringify(response) + "\n");
          }, this.options.initializationResponseDelayMs ?? 0);
        }
        if (message.id === 2) {
          setTimeout(() => this.stdout.write(JSON.stringify(this.options.failAccountRead ? { id: 2, error: { message: "private account failure" } } : { id: 2, result: accountResponse }) + "\n"), this.options.accountResponseDelayMs ?? 0);
        }
      }
    });
  }
}

function isInitializedNotification(message: unknown): boolean {
  return typeof message === "object" && message !== null && "method" in message && message.method === "initialized";
}

describe("Codex app-server subscription preflight", () => {
  it("initializes then reads only sanitized ChatGPT auth status without a thread or turn", async () => {
    const process = new FakeAppServer({ account: { type: "chatgpt", email: "private@example.com", planType: "pro" }, requiresOpenaiAuth: true });
    const result = await new CodexAppServerPreflight(() => process, 100).check();

    expect(result).toEqual({ accessStatus: "CHATGPT_AUTHENTICATED", diagnosticCode: "NOT_APPLICABLE" });
    expect(process.messages).toEqual([
      expect.objectContaining({ id: 1, method: "initialize" }),
      expect.objectContaining({ method: "initialized" }),
      { id: 2, method: "account/read", params: { refreshToken: false } },
    ]);
    expect(JSON.stringify(process.messages)).not.toContain("private@example.com");
    expect(process.kill).toHaveBeenCalledOnce();
  });

  it("confirms initialized before waiting for the initialization response", async () => {
    const process = new FakeAppServer(
      { account: { type: "chatgpt" }, requiresOpenaiAuth: true },
      { requireInitializedBeforeInitializationResponse: true },
    );

    await expect(new CodexAppServerPreflight(() => process, 100).check()).resolves.toEqual({
      accessStatus: "CHATGPT_AUTHENTICATED",
      diagnosticCode: "NOT_APPLICABLE",
    });
    expect(process.messages.slice(0, 2)).toEqual([
      expect.objectContaining({ id: 1, method: "initialize" }),
      expect.objectContaining({ method: "initialized" }),
    ]);
  });

  it("maps account responses and persists only closed failure diagnostics", async () => {
    expect(mapAccountReadResponse({ account: null, requiresOpenaiAuth: true })).toBe("AUTHENTICATION_REQUIRED");
    expect(mapAccountReadResponse({ account: { type: "apiKey" }, requiresOpenaiAuth: true })).toBe("UNSUPPORTED_AUTH_MODE");
    expect(mapAccountReadResponse({ account: null, requiresOpenaiAuth: false })).toBe("UNSUPPORTED_AUTH_MODE");
    expect(mapAccountReadResponse({ account: { type: "chatgpt" }, requiresOpenaiAuth: true })).toBe("CHATGPT_AUTHENTICATED");
    await expect(new CodexAppServerPreflight(() => { throw new Error("private start failure"); }, 10).check()).resolves.toEqual({ accessStatus: "UNAVAILABLE", diagnosticCode: "APP_SERVER_START_FAILED" });
    const rejected = await new CodexAppServerPreflight(() => new FakeAppServer({}, { rejectInitialization: true }), 10).check();
    expect(rejected).toEqual({ accessStatus: "UNAVAILABLE", diagnosticCode: "INITIALIZATION_REJECTED" });
    expect(JSON.stringify(rejected)).not.toContain("private initialization failure");
    await expect(new CodexAppServerPreflight(() => new FakeAppServer({}, { invalidInitializationResponse: true }), 10).check()).resolves.toEqual({ accessStatus: "UNAVAILABLE", diagnosticCode: "INITIALIZATION_RESPONSE_INVALID" });
    await expect(new CodexAppServerPreflight(() => new FakeAppServer({}, { exitDuringInitialization: true }), 10).check()).resolves.toEqual({ accessStatus: "UNAVAILABLE", diagnosticCode: "APP_SERVER_EXITED_DURING_INITIALIZATION" });
    await expect(new CodexAppServerPreflight(() => new FakeAppServer({}, { failAccountRead: true }), 10).check()).resolves.toEqual({ accessStatus: "UNAVAILABLE", diagnosticCode: "ACCOUNT_READ_FAILED" });
    await expect(new CodexAppServerPreflight(() => new FakeAppServer("not-an-account-response"), 10).check()).resolves.toEqual({ accessStatus: "UNAVAILABLE", diagnosticCode: "ACCOUNT_RESPONSE_INVALID" });
  });

  it("uses a ten-second default window for a cold local app-server start", async () => {
    vi.useFakeTimers();
    try {
      const process = new FakeAppServer({ account: { type: "chatgpt" }, requiresOpenaiAuth: true }, { accountResponseDelayMs: 4_000 });
      const check = new CodexAppServerPreflight(() => process).check();

      await vi.advanceTimersByTimeAsync(3_001);
      expect(process.kill).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(999);
      await expect(check).resolves.toEqual({ accessStatus: "CHATGPT_AUTHENTICATED", diagnosticCode: "NOT_APPLICABLE" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("categorizes an initialization timeout without retaining the underlying error", async () => {
    vi.useFakeTimers();
    try {
      const process = new FakeAppServer({ account: { type: "chatgpt" }, requiresOpenaiAuth: true }, { initializationResponseDelayMs: 11 });
      const check = new CodexAppServerPreflight(() => process, 10).check();

      await vi.advanceTimersByTimeAsync(11);
      await expect(check).resolves.toEqual({ accessStatus: "UNAVAILABLE", diagnosticCode: "INITIALIZATION_TIMED_OUT" });
      expect(JSON.stringify(await check)).not.toContain("private");
    } finally {
      vi.useRealTimers();
    }
  });

  it("categorizes an account-read timeout without retaining the underlying error", async () => {
    vi.useFakeTimers();
    try {
      const process = new FakeAppServer({ account: { type: "chatgpt" }, requiresOpenaiAuth: true }, { accountResponseDelayMs: 11 });
      const check = new CodexAppServerPreflight(() => process, 10).check();

      await vi.advanceTimersByTimeAsync(11);
      const result = await check;
      expect(result).toEqual({ accessStatus: "UNAVAILABLE", diagnosticCode: "ACCOUNT_READ_TIMED_OUT" });
      expect(JSON.stringify(result)).not.toContain("private");
    } finally {
      vi.useRealTimers();
    }
  });
});
