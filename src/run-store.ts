// Run-log files (spec section 11.3 to 11.5): serialization, validated reading, and atomic publication.
// A file is written to an exclusive temporary name, validated from disk, flushed, and then published under
// its final name with a hard link, which fails if the name exists. Nothing is ever overwritten.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canonicalJson } from "./canonical.js";
import { defaultChecks, defaultRunsDirectory, ensureRunsDirectory, readInputFile, type PlatformChecks } from "./run-files.js";
import { ImportError } from "./run-import-error.js";
import type { RunEvent } from "./run-events.js";
import { validateRunHistory } from "./run-reducer.js";
import { DEFAULT_JSON_LIMITS, parseStrictJson } from "./strict-json.js";

export const MAX_RUN_LOG_BYTES = 128 * 1024 * 1024;
const TEMP_PREFIX = ".dropscope-tmp-";
const STALE_TEMP_MS = 10 * 60 * 1000;
const STAGE = "store";

const invalid = (reason: string): never => {
  throw new ImportError("E_INVALID_LOG", "read-log", null, reason);
};

// One event per line, canonical JSON, LF only, final newline, UTF-8 without a BOM.
export function serializeRunLog(events: readonly RunEvent[]): Uint8Array {
  const text = events.map((event) => `${canonicalJson(event)}\n`).join("");
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > MAX_RUN_LOG_BYTES) throw new ImportError("E_LIMIT", STAGE, null, "OUTPUT_TOO_LARGE");
  return bytes;
}

// Reads a run log: every line must parse strictly, match the schema, be in canonical form, and the whole
// history must satisfy the reducer's admission rules. Any deviation fails closed.
export function parseRunLog(bytes: Uint8Array): RunEvent[] {
  if (bytes.length === 0 || bytes.length > MAX_RUN_LOG_BYTES) return invalid("SIZE");
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return invalid("BOM");
  if (bytes[bytes.length - 1] !== 0x0a) return invalid("NO_FINAL_NEWLINE");
  if (bytes.includes(0x0d)) return invalid("CARRIAGE_RETURN");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return invalid("UTF8");
  }
  const lines = text.slice(0, -1).split("\n");
  const events: unknown[] = [];
  lines.forEach((line, index) => {
    if (line.length === 0) invalid(`BLANK_LINE ${index + 1}`);
    let value: unknown;
    try {
      parseStrictJson(new TextEncoder().encode(line), "read-log", DEFAULT_JSON_LIMITS);
      value = JSON.parse(line);
    } catch {
      return invalid(`LINE_SYNTAX ${index + 1}`);
    }
    if (canonicalJson(value) !== line) invalid(`LINE_NOT_CANONICAL ${index + 1}`);
    events.push(value);
  });
  return validateRunHistory(events);
}

export function readRunLog(file: string, checks: PlatformChecks = defaultChecks()): RunEvent[] {
  return parseRunLog(readInputFile(file, MAX_RUN_LOG_BYTES, checks));
}

export type PublishOptions = { runsDirectory?: string; checks?: PlatformChecks; now?: () => number };
export type PublishResult = { path: string; status: "CREATED" | "REUSED"; eventCount: number };

function removeStaleTemps(dir: string, now: number): void {
  for (const name of fs.readdirSync(dir)) {
    if (!name.startsWith(TEMP_PREFIX)) continue;
    const file = path.join(dir, name);
    try {
      const stat = fs.lstatSync(file);
      if (stat.isFile() && now - stat.mtimeMs > STALE_TEMP_MS) fs.unlinkSync(file);
    } catch {
      // A temp file that cannot be removed is ignored; it is never read as a run.
    }
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
}

// An existing file with the final name is reused only if it is a valid run of the same identity and has
// exactly the bytes this import would write.
function reuseExisting(file: string, intended: Uint8Array, artifactId: string, checks: PlatformChecks): void {
  const existing = readInputFile(file, MAX_RUN_LOG_BYTES, checks);
  const events = parseRunLog(existing);
  const header = events[0];
  if (header.type !== "RunStarted" || header.payload.artifactId !== artifactId || !sameBytes(existing, intended)) {
    throw new ImportError("E_EXISTS_DIFFERENT", STAGE);
  }
}

export function publishRun(history: readonly RunEvent[], options: PublishOptions = {}): PublishResult {
  const checks = options.checks ?? defaultChecks();
  // Validate before touching the disk: a history that fails admission is never published.
  const events = validateRunHistory(history);
  const header = events[0];
  if (header.type !== "RunStarted") throw new ImportError("E_INVALID_LOG", STAGE);
  const intended = serializeRunLog(events);

  const dir = ensureRunsDirectory(options.runsDirectory ?? defaultRunsDirectory(), checks);
  removeStaleTemps(dir, (options.now ?? Date.now)());

  const name = `${header.payload.traceId}-${header.payload.artifactId.slice(0, 16)}.runlog.jsonl`;
  const final = path.join(dir, name);
  const result = (status: PublishResult["status"]): PublishResult => ({ path: final, status, eventCount: events.length });

  const exists = (): boolean => {
    try {
      fs.lstatSync(final);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw new ImportError("E_PATH", STAGE, null, "FINAL_PATH_UNREADABLE");
    }
  };
  if (exists()) {
    reuseExisting(final, intended, header.payload.artifactId, checks);
    return result("REUSED");
  }

  const temp = path.join(dir, `${TEMP_PREFIX}${process.pid}-${crypto.randomBytes(8).toString("hex")}.tmp`);
  let fd: number | null = null;
  try {
    fd = fs.openSync(temp, "wx", 0o600);
    let offset = 0;
    while (offset < intended.length) offset += fs.writeSync(fd, intended, offset, intended.length - offset);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;

    // Validate what is actually on disk before it can become a run.
    const onDisk = readInputFile(temp, MAX_RUN_LOG_BYTES, checks);
    parseRunLog(onDisk);
    if (!sameBytes(onDisk, intended)) throw new ImportError("E_INVALID_LOG", STAGE, null, "WRITE_MISMATCH");

    try {
      fs.linkSync(temp, final);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EEXIST") {
        // Another import published the same name first: accept it only if it is identical.
        reuseExisting(final, intended, header.payload.artifactId, checks);
        return result("REUSED");
      }
      throw new ImportError("E_PLATFORM", STAGE, null, "HARD_LINK_UNSUPPORTED");
    }
    // Best effort: flush the directory entry where the platform allows it.
    try {
      const dirFd = fs.openSync(dir, "r");
      try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
    } catch {
      // Not possible on every platform; after a crash, re-import.
    }
    return result("CREATED");
  } finally {
    if (fd !== null) fs.closeSync(fd);
    try { fs.unlinkSync(temp); } catch { /* already gone */ }
  }
}
