import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  FILE_ATTRIBUTE_OFFLINE, FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS, FILE_ATTRIBUTE_RECALL_ON_OPEN,
  defaultChecks, ensureRunsDirectory, posixChecks, readInputFile, safeResolve, windowsChecks, type PlatformChecks,
} from "../src/run-files.js";
import { ImportError } from "../src/run-import-error.js";

const windows = process.platform === "win32";
let root: string;
beforeAll(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "dropscope-files-")); });
afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); });

const fake = (attributes: number | null = 0): PlatformChecks => ({ name: "fake", fileAttributes: () => attributes, prepareRunsDirectory: () => {} });
const codeOf = (fn: () => unknown): string | null => {
  try { fn(); return null; } catch (error) {
    if (error instanceof ImportError) return `${error.code}:${error.reason ?? ""}`;
    throw error;
  }
};
const write = (name: string, data: string | Uint8Array): string => {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  return file;
};

describe("readInputFile", () => {
  it("reads a regular file and counts bytes against the limit", () => {
    const file = write("ok.json", "{}");
    expect(Buffer.from(readInputFile(file, 10, fake())).toString()).toBe("{}");
    expect(readInputFile(write("empty.json", ""), 10, fake()).length).toBe(0);
    const exact = write("exact.bin", Buffer.alloc(100, 1));
    expect(readInputFile(exact, 100, fake()).length).toBe(100);
    expect(codeOf(() => readInputFile(exact, 99, fake()))).toBe("E_LIMIT:FILE_TOO_LARGE");
  });

  it("rejects missing paths, directories, empty and NUL paths", () => {
    expect(codeOf(() => readInputFile(path.join(root, "nope.json"), 10, fake()))).toMatch(/^E_PATH/);
    expect(codeOf(() => readInputFile(root, 10, fake()))).toBe("E_FILE_KIND:NOT_A_REGULAR_FILE");
    expect(codeOf(() => readInputFile("", 10, fake()))).toBe("E_PATH:EMPTY_OR_NUL");
    expect(codeOf(() => readInputFile("a\0b", 10, fake()))).toBe("E_PATH:EMPTY_OR_NUL");
  });

  it("rejects a file whose platform attributes mark it as a cloud placeholder, before opening it", () => {
    const file = write("placeholder.json", "{}");
    for (const flag of [FILE_ATTRIBUTE_OFFLINE, FILE_ATTRIBUTE_RECALL_ON_OPEN, FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS]) {
      expect(codeOf(() => readInputFile(file, 10, fake(flag | 0x20)))).toBe("E_FILE_KIND:CLOUD_PLACEHOLDER_OR_OFFLINE");
    }
    expect(codeOf(() => readInputFile(file, 10, fake(0x20)))).toBeNull();
  });

  it("fails closed when the platform check itself fails", () => {
    const broken: PlatformChecks = { ...fake(), fileAttributes: () => { throw new ImportError("E_PLATFORM", "file", null, "ATTRIBUTES_UNREADABLE"); } };
    expect(codeOf(() => readInputFile(write("x.json", "{}"), 10, broken))).toBe("E_PLATFORM:ATTRIBUTES_UNREADABLE");
  });

  it("rejects a directory link (junction on Windows) anywhere in the path", () => {
    const target = path.join(root, "real");
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, "f.json"), "{}");
    const link = path.join(root, "linked");
    fs.symlinkSync(target, link, windows ? "junction" : "dir");
    expect(codeOf(() => readInputFile(path.join(link, "f.json"), 10, fake()))).toBe("E_PATH:LINK_IN_PATH");
    expect(codeOf(() => safeResolve(link))).toBe("E_PATH:LINK_IN_PATH");
  });

  it("rejects a file symbolic link when the platform lets this account create one", (ctx) => {
    const target = write("target.json", "{}");
    const link = path.join(root, "filelink.json");
    try { fs.symlinkSync(target, link, "file"); } catch { ctx.skip(); return; }
    expect(codeOf(() => readInputFile(link, 10, fake()))).toBe("E_PATH:LINK_IN_PATH");
  });

  it.skipIf(!windows)("rejects network, device and stream paths on Windows", () => {
    for (const bad of ["\\\\server\\share\\x.json", "//server/share/x.json", "\\\\.\\C:\\x.json", "\\\\?\\C:\\x.json"]) {
      expect(codeOf(() => readInputFile(bad, 10, fake())), bad).toBe("E_PATH:UNC_OR_DEVICE_PATH");
    }
    const file = write("s.json", "{}");
    expect(codeOf(() => readInputFile(`${file}:hidden`, 10, fake()))).toBe("E_PATH:STREAM_OR_DRIVE_IN_PATH");
    for (const name of ["NUL", "con.txt", "COM1", "lpt9.json"]) {
      expect(codeOf(() => readInputFile(path.join(root, name), 10, fake())), name).toBe("E_PATH:DEVICE_NAME");
    }
    expect(codeOf(() => readInputFile(`${file}.`, 10, fake()))).toBe("E_PATH:TRAILING_DOT_OR_SPACE");
  });

  it.skipIf(!windows)("uses real Windows attributes and drive type", () => {
    const file = write("real.json", "{\"a\":1}");
    const attrs = windowsChecks.fileAttributes(file);
    expect(typeof attrs).toBe("number");
    expect((attrs as number) & (FILE_ATTRIBUTE_OFFLINE | FILE_ATTRIBUTE_RECALL_ON_OPEN | FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS)).toBe(0);
    expect(Buffer.from(readInputFile(file, 100, defaultChecks())).toString()).toBe("{\"a\":1}");
  }, 60_000);

  it.skipIf(!windows)("fails closed when Windows cannot report attributes for the path", () => {
    expect(codeOf(() => windowsChecks.fileAttributes(path.join(root, "missing-file.json")))).toBe("E_PLATFORM:POWERSHELL_UNAVAILABLE");
  }, 60_000);
});

describe("ensureRunsDirectory", () => {
  // Version 1 supports Windows only, so defaultChecks() refuses elsewhere (tested below). These tests exercise the
  // directory logic with the platform's own checks, which on other systems are the explicit POSIX ones.
  const platformChecks = windows ? windowsChecks : posixChecks;

  it.skipIf(windows)("refuses to run by default on a platform other than Windows", () => {
    expect(codeOf(() => defaultChecks())).toBe("E_PLATFORM:UNSUPPORTED_PLATFORM");
  });

  it("creates a directory, accepts it again, and rejects a file in its place", () => {
    const dir = path.join(root, "a", "b", "runs");
    expect(ensureRunsDirectory(dir, platformChecks)).toBe(path.resolve(dir));
    expect(fs.statSync(dir).isDirectory()).toBe(true);
    expect(ensureRunsDirectory(dir, platformChecks)).toBe(path.resolve(dir));
    const file = write("notadir", "x");
    expect(codeOf(() => ensureRunsDirectory(file, platformChecks))).toBe("E_FILE_KIND:RUNS_PATH_NOT_A_DIRECTORY");
  }, 60_000);

  it("refuses a runs directory reached through a link", () => {
    const real = path.join(root, "realruns");
    fs.mkdirSync(real);
    const link = path.join(root, "runslink");
    fs.symlinkSync(real, link, windows ? "junction" : "dir");
    expect(codeOf(() => ensureRunsDirectory(link, fake()))).toBe("E_PATH:LINK_IN_PATH");
  });

  it.skipIf(!windows)("grants only the current user, SYSTEM and Administrators, and rejects a loosened directory", () => {
    const dir = path.join(root, "owner-only", "runs");
    ensureRunsDirectory(dir, windowsChecks);
    const listing = execFileSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "icacls.exe"), [dir], { encoding: "utf8" });
    expect(/Everyone|BUILTIN\\Users|Authenticated Users/i.test(listing)).toBe(false);
    execFileSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "icacls.exe"), [dir, "/grant", "*S-1-1-0:(R)"], { stdio: "ignore" });
    expect(codeOf(() => ensureRunsDirectory(dir, windowsChecks))).toBe("E_PLATFORM:RUNS_DIR_NOT_OWNER_ONLY");
  }, 90_000);

  it.skipIf(windows)("requires a private mode on POSIX", () => {
    const dir = path.join(root, "posix-runs");
    ensureRunsDirectory(dir, posixChecks);
    expect(fs.statSync(dir).mode & 0o077).toBe(0);
    fs.chmodSync(dir, 0o755);
    expect(codeOf(() => ensureRunsDirectory(dir, posixChecks))).toBe("E_PLATFORM:RUNS_DIR_NOT_OWNER_ONLY");
  });
});
