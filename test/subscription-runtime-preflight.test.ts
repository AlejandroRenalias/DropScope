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
    private readonly accountResponseDelayMs = 0,
  ) {
    super();
    this.stdin.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString("utf8").split("\n").filter(Boolean)) {
        const message = JSON.parse(line) as { id?: number; method?: string };
        this.messages.push(message);
        if (message.id === 1) this.stdout.write(JSON.stringify({ id: 1, result: {} }) + "\n");
        if (message.id === 2) {
          setTimeout(() => this.stdout.write(JSON.stringify({ id: 2, result: accountResponse }) + "\n"), this.accountResponseDelayMs);
        }
      }
    });
  }
}

describe("Codex app-server subscription preflight", () => {
  it("initializes then reads only sanitized ChatGPT auth status without a thread or turn", async () => {
    const process = new FakeAppServer({ account: { type: "chatgpt", email: "private@example.com", planType: "pro" }, requiresOpenaiAuth: true });
    const result = await new CodexAppServerPreflight(() => process, 100).check();

    expect(result).toBe("CHATGPT_AUTHENTICATED");
    expect(process.messages).toEqual([
      expect.objectContaining({ id: 1, method: "initialize" }),
      expect.objectContaining({ method: "initialized" }),
      { id: 2, method: "account/read", params: { refreshToken: false } },
    ]);
    expect(JSON.stringify(process.messages)).not.toContain("private@example.com");
    expect(process.kill).toHaveBeenCalledOnce();
  });

  it("maps only coarse statuses and treats a failed local process as unavailable", async () => {
    expect(mapAccountReadResponse({ account: null, requiresOpenaiAuth: true })).toBe("AUTHENTICATION_REQUIRED");
    expect(mapAccountReadResponse({ account: { type: "apiKey" }, requiresOpenaiAuth: true })).toBe("UNSUPPORTED_AUTH_MODE");
    expect(mapAccountReadResponse({ account: null, requiresOpenaiAuth: false })).toBe("UNSUPPORTED_AUTH_MODE");
    expect(mapAccountReadResponse({ account: { type: "chatgpt" }, requiresOpenaiAuth: true })).toBe("CHATGPT_AUTHENTICATED");
    await expect(new CodexAppServerPreflight(() => { throw new Error("missing"); }, 10).check()).resolves.toBe("UNAVAILABLE");
  });

  it("uses a ten-second default window for a cold local app-server start", async () => {
    vi.useFakeTimers();
    try {
      const process = new FakeAppServer({ account: { type: "chatgpt" }, requiresOpenaiAuth: true }, 4_000);
      const check = new CodexAppServerPreflight(() => process).check();

      await vi.advanceTimersByTimeAsync(3_001);
      expect(process.kill).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(999);
      await expect(check).resolves.toBe("CHATGPT_AUTHENTICATED");
    } finally {
      vi.useRealTimers();
    }
  });
});
