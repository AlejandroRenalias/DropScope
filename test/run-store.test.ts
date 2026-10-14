import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { canonicalJson } from "../src/canonical.js";
import type { PlatformChecks } from "../src/run-files.js";
import { ImportError } from "../src/run-import-error.js";
import { importTraceBytes } from "../src/run-import.js";
import type { RunEvent } from "../src/run-events.js";
import { parseRunLog, publishRun, readRunLog, serializeRunLog } from "../src/run-store.js";

const T1 = "11111111111111111111111111111111";
const id = (n: number) => n.toString(16).padStart(16, "0");
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const span = (n: number) => ({ traceId: T1, spanId: id(n), name: `s${n}`, startTimeUnixNano: String(100 + n), endTimeUnixNano: String(200 + n),
  attributes: [{ key: "gen_ai.operation.name", value: { stringValue: "chat" } }, { key: "gen_ai.usage.input_tokens", value: { intValue: "3" } }] });
const traceFile = (n = 2) => bytes({ resourceSpans: [{ scopeSpans: [{ scope: { name: "s" }, spans: Array.from({ length: n }, (_, i) => span(i + 1)) }] }] });
const history = (mode: "HASH_ONLY" | "FULL" = "HASH_ONLY", n = 2) => importTraceBytes({ spans: traceFile(n), contentMode: mode });

const fake: PlatformChecks = { name: "fake", fileAttributes: () => 0, prepareRunsDirectory: () => {} };
let root: string;
let counter = 0;
beforeAll(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "dropscope-store-")); });
afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); });
afterEach(() => { vi.restoreAllMocks(); });
const freshDir = () => path.join(root, `runs-${(counter += 1)}`);
const codeOf = (fn: () => unknown): string | null => {
  try { fn(); return null; } catch (error) {
    if (error instanceof ImportError) return `${error.code}:${(error.reason ?? "").split(" ")[0]}`;
    throw error;
  }
};
const files = (dir: string) => fs.readdirSync(dir).sort();

describe("serialization and reading", () => {
  it("writes one canonical event per line, LF only, final newline, no BOM", () => {
    const events = history();
    const data = serializeRunLog(events);
    const text = new TextDecoder().decode(data);
    expect(text.endsWith("\n")).toBe(true);
    expect(text.includes("\r")).toBe(false);
    expect(data[0]).not.toBe(0xef);
    const lines = text.slice(0, -1).split("\n");
    expect(lines.length).toBe(events.length);
    lines.forEach((line, i) => expect(line).toBe(canonicalJson(events[i])));
    expect(parseRunLog(data)).toEqual(events);
  });

  it("rejects every deviation from the file format", () => {
    const good = new TextDecoder().decode(serializeRunLog(history()));
    const enc = (s: string) => new TextEncoder().encode(s);
    const lines = good.slice(0, -1).split("\n");
    const bad: Array<[string, Uint8Array]> = [
      ["empty", enc("")],
      ["BOM", new Uint8Array([0xef, 0xbb, 0xbf, ...enc(good)])],
      ["CRLF", enc(good.replace(/\n/g, "\r\n"))],
      ["no final newline", enc(good.slice(0, -1))],
      ["blank line", enc(`${lines[0]}\n\n${lines.slice(1).join("\n")}\n`)],
      ["invalid UTF-8", new Uint8Array([...enc(good.slice(0, -1)), 0xff, 0x0a])],
      ["pretty-printed line", enc(`${JSON.stringify(JSON.parse(lines[0]), null, 1).replace(/\n/g, " ")}\n${lines.slice(1).join("\n")}\n`)],
      ["reordered keys", enc(`${JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(lines[0])).reverse()))}\n${lines.slice(1).join("\n")}\n`)],
      ["duplicate key", enc(`${lines[0].slice(0, -1)},"runId":"${T1}"}\n${lines.slice(1).join("\n")}\n`)],
      ["junk line", enc(`${good}not json\n`)],
      ["truncated", enc(`${lines.slice(0, 3).join("\n")}\n`)],
    ];
    for (const [name, data] of bad) expect(String(codeOf(() => parseRunLog(data))), name).toMatch(/^E_INVALID_LOG/);
  });
});

describe("publishRun", () => {
  it("creates the run file under its deterministic name and leaves no temporary files", () => {
    const dir = freshDir();
    const events = history();
    const result = publishRun(events, { runsDirectory: dir, checks: fake });
    const header = events[0] as Extract<RunEvent, { type: "RunStarted" }>;
    expect(result.status).toBe("CREATED");
    expect(path.basename(result.path)).toBe(`${T1}-${header.payload.artifactId.slice(0, 16)}.runlog.jsonl`);
    expect(files(dir)).toEqual([path.basename(result.path)]);
    expect(readRunLog(result.path, fake)).toEqual(events);
  });

  it("is idempotent: importing the same input again reuses the file without touching it", () => {
    const dir = freshDir();
    const first = publishRun(history(), { runsDirectory: dir, checks: fake });
    const stamp = fs.statSync(first.path).mtimeMs;
    const second = publishRun(history(), { runsDirectory: dir, checks: fake });
    expect(second).toMatchObject({ status: "REUSED", path: first.path });
    expect(fs.statSync(first.path).mtimeMs).toBe(stamp);
    expect(files(dir).length).toBe(1);
  });

  it("keeps different content modes as different files", () => {
    const dir = freshDir();
    publishRun(history("HASH_ONLY"), { runsDirectory: dir, checks: fake });
    publishRun(history("FULL"), { runsDirectory: dir, checks: fake });
    expect(files(dir).length).toBe(2);
  });

  it("never overwrites: a different file under the final name fails closed and stays unchanged", () => {
    const dir = freshDir();
    const events = history();
    const first = publishRun(events, { runsDirectory: dir, checks: fake });
    const original = fs.readFileSync(first.path);

    // A valid run with another identity under this name.
    const other = serializeRunLog(history("FULL"));
    fs.writeFileSync(first.path, other);
    expect(codeOf(() => publishRun(events, { runsDirectory: dir, checks: fake }))).toBe("E_EXISTS_DIFFERENT:");
    expect(Buffer.compare(fs.readFileSync(first.path), Buffer.from(other))).toBe(0);

    // Garbage under this name.
    fs.writeFileSync(first.path, "garbage\n");
    expect(codeOf(() => publishRun(events, { runsDirectory: dir, checks: fake }))).toMatch(/^E_INVALID_LOG/);
    expect(fs.readFileSync(first.path, "utf8")).toBe("garbage\n");

    // Same identity but different bytes (a valid file for the same header with one extra note is not possible,
    // so tamper with a withheld hash and re-canonicalize).
    fs.writeFileSync(first.path, original);
    const lines = original.toString().slice(0, -1).split("\n").map((l) => JSON.parse(l));
    const content = lines.find((l) => l.type === "StepStarted");
    content.payload.name = { w: { n: 1, h: "b".repeat(64) } };
    fs.writeFileSync(first.path, lines.map((l) => `${canonicalJson(l)}\n`).join(""));
    expect(codeOf(() => publishRun(events, { runsDirectory: dir, checks: fake }))).toBe("E_EXISTS_DIFFERENT:");
    expect(files(dir).length).toBe(1);
  });

  it("does not publish a history that fails admission", () => {
    const dir = freshDir();
    const broken = history().slice(0, -1);
    expect(codeOf(() => publishRun(broken, { runsDirectory: dir, checks: fake }))).toMatch(/^E_INVALID_LOG/);
    expect(fs.existsSync(dir) ? files(dir) : []).toEqual([]);
  });

  it("leaves no partial final file when the final step fails, and cleans its temporary file", () => {
    const dir = freshDir();
    vi.spyOn(fs, "linkSync").mockImplementation(() => { throw Object.assign(new Error("no links"), { code: "EPERM" }); });
    expect(codeOf(() => publishRun(history(), { runsDirectory: dir, checks: fake }))).toBe("E_PLATFORM:HARD_LINK_UNSUPPORTED");
    expect(files(dir)).toEqual([]);
  });

  it("leaves no partial final file when writing fails midway", () => {
    const dir = freshDir();
    vi.spyOn(fs, "fsyncSync").mockImplementation(() => { throw new Error("disk error"); });
    expect(() => publishRun(history(), { runsDirectory: dir, checks: fake })).toThrow();
    expect(files(dir)).toEqual([]);
  });

  it("handles a race: if another import wins the name, identical bytes are reused and different bytes fail", () => {
    const events = history();
    const intended = serializeRunLog(events);
    const realLink = fs.linkSync;

    const dir1 = freshDir();
    vi.spyOn(fs, "linkSync").mockImplementation((existing, target) => {
      fs.writeFileSync(target as string, intended);
      return realLink(existing, target);
    });
    expect(publishRun(events, { runsDirectory: dir1, checks: fake }).status).toBe("REUSED");
    expect(files(dir1).length).toBe(1);
    vi.restoreAllMocks();

    const dir2 = freshDir();
    vi.spyOn(fs, "linkSync").mockImplementation((existing, target) => {
      fs.writeFileSync(target as string, serializeRunLog(history("FULL")));
      return realLink(existing, target);
    });
    expect(codeOf(() => publishRun(events, { runsDirectory: dir2, checks: fake }))).toBe("E_EXISTS_DIFFERENT:");
    expect(files(dir2).length).toBe(1);
  });

  it("removes stale temporary files at the next import and keeps fresh ones; they are never read as runs", () => {
    const dir = freshDir();
    fs.mkdirSync(dir, { recursive: true });
    const stale = path.join(dir, ".dropscope-tmp-1-aaaa.tmp");
    const fresh = path.join(dir, ".dropscope-tmp-2-bbbb.tmp");
    const foreign = path.join(dir, "notes.txt");
    for (const f of [stale, fresh, foreign]) fs.writeFileSync(f, "x");
    const old = new Date(Date.now() - 60 * 60 * 1000);
    fs.utimesSync(stale, old, old);
    publishRun(history(), { runsDirectory: dir, checks: fake });
    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
    expect(fs.existsSync(foreign)).toBe(true);
  });

  it("rejects reading a published run that was tampered with afterwards", () => {
    const dir = freshDir();
    const { path: file } = publishRun(history(), { runsDirectory: dir, checks: fake });
    const lines = fs.readFileSync(file, "utf8").slice(0, -1).split("\n").map((l) => JSON.parse(l));
    const started = lines.find((l) => l.type === "StepStarted");
    started.payload.name = { v: { t: "s", v: "leaked prompt" } };
    fs.writeFileSync(file, lines.map((l) => `${canonicalJson(l)}\n`).join(""));
    expect(codeOf(() => readRunLog(file, fake))).toMatch(/^E_INVALID_LOG:CONTENT_NOT_WITHHELD/);
  });
});

describe("worst case", () => {
  it("publishes and re-reads a 10,000-span run in reasonable time", () => {
    const dir = freshDir();
    const events = history("HASH_ONLY", 10_000);
    const started = performance.now();
    const result = publishRun(events, { runsDirectory: dir, checks: fake });
    expect(readRunLog(result.path, fake).length).toBe(events.length);
    expect(performance.now() - started).toBeLessThan(20_000);
  }, 60_000);
});
