import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  FILE_ATTRIBUTE_OFFLINE, SF_DATALESS, defaultChecks, defaultRunsDirectory, ensureRunsDirectory, makePosixChecks,
  readInputFile, syncedRootWarning, windowsChecks,
} from "../src/run-files.js";
import { ImportError } from "../src/run-import-error.js";
import { importTraceBytes } from "../src/run-import.js";
import { publishRun } from "../src/run-store.js";

const windows = process.platform === "win32";
let root: string;
beforeAll(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "dropscope-posix-")); });
afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

const codeOf = (fn: () => unknown): string | null => {
  try { fn(); return null; } catch (error) {
    if (error instanceof ImportError) return `${error.code}:${error.reason ?? ""}`;
    throw error;
  }
};
const withPlatform = <T>(value: string, fn: () => T): T => {
  const original = Object.getOwnPropertyDescriptor(process, "platform") as PropertyDescriptor;
  Object.defineProperty(process, "platform", { value });
  try { return fn(); } finally { Object.defineProperty(process, "platform", original); }
};

describe("platform selection", () => {
  it("uses the Windows checks on Windows, POSIX checks on Linux and macOS, and refuses elsewhere", () => {
    expect(withPlatform("win32", () => defaultChecks())).toBe(windowsChecks);
    expect(withPlatform("linux", () => defaultChecks()).name).toBe("posix");
    expect(withPlatform("darwin", () => defaultChecks()).name).toBe("darwin");
    expect(codeOf(() => withPlatform("freebsd", () => defaultChecks()))).toBe("E_PLATFORM:UNSUPPORTED_PLATFORM");
  });
});

describe("default runs folder", () => {
  it("uses XDG_DATA_HOME on Linux when it is an absolute path", () => {
    const base = path.resolve(root, "xdg");
    vi.stubEnv("XDG_DATA_HOME", base);
    expect(withPlatform("linux", () => defaultRunsDirectory())).toBe(path.join(base, "dropscope", "runs"));
  });

  it("falls back to ~/.local/share on Linux when XDG_DATA_HOME is empty or relative", () => {
    const home = path.resolve(root, "home");
    vi.spyOn(os, "homedir").mockReturnValue(home);
    const expected = path.join(home, ".local", "share", "dropscope", "runs");
    for (const value of ["", "relative/dir"]) {
      vi.stubEnv("XDG_DATA_HOME", value);
      expect(withPlatform("linux", () => defaultRunsDirectory()), value).toBe(expected);
    }
  });

  it("uses ~/Library/Application Support/DropScope/runs on macOS", () => {
    const home = path.resolve(root, "home");
    vi.spyOn(os, "homedir").mockReturnValue(home);
    expect(withPlatform("darwin", () => defaultRunsDirectory()))
      .toBe(path.join(home, "Library", "Application Support", "DropScope", "runs"));
  });

  it("uses %LOCALAPPDATA%/DropScope/runs on Windows and refuses when it is unset", () => {
    const local = path.resolve(root, "local");
    vi.stubEnv("LOCALAPPDATA", local);
    expect(withPlatform("win32", () => defaultRunsDirectory())).toBe(path.join(local, "DropScope", "runs"));
    vi.stubEnv("LOCALAPPDATA", "");
    expect(codeOf(() => withPlatform("win32", () => defaultRunsDirectory()))).toBe("E_PLATFORM:LOCALAPPDATA_UNSET");
  });
});

describe("synced folder warning on macOS and Linux paths", () => {
  it.each([
    "/Users/me/Library/Mobile Documents/com~apple~CloudDocs/runs",
    "/Users/me/Library/CloudStorage/Dropbox/runs",
    "/Users/me/Library/CloudStorage/OneDrive-Acme/runs",
    "/Users/me/Library/CloudStorage/GoogleDrive-me@example.com/runs",
    "/Users/me/iCloud Drive/runs",
    "/home/me/Dropbox/runs",
    "/home/me/Nextcloud/runs",
  ])("warns for %s", (dir) => {
    expect(syncedRootWarning(dir)).toBe("RUNS_DIR_IN_SYNCED_FOLDER");
  });

  it.each([
    "/Users/me/Library/Application Support/DropScope/runs",
    "/home/me/.local/share/dropscope/runs",
  ])("does not warn for %s", (dir) => {
    expect(syncedRootWarning(dir)).toBeNull();
  });
});

describe("macOS placeholder checks", () => {
  const stat = (output: string | Error) => (): string => { if (output instanceof Error) throw output; return output; };

  it("refuses a dataless file (cloud content not on this computer)", () => {
    const checks = makePosixChecks({ platform: "darwin", statFlags: stat(`${SF_DATALESS.toString(16).toUpperCase()}\n`) });
    expect(checks.fileAttributes("/x/trace.json")).toBe(FILE_ATTRIBUTE_OFFLINE);
  });

  it("accepts a file whose flags carry no dataless bit", () => {
    expect(makePosixChecks({ platform: "darwin", statFlags: stat("0\n") }).fileAttributes("/x/trace.json")).toBe(0);
    expect(makePosixChecks({ platform: "darwin", statFlags: stat("20\n") }).fileAttributes("/x/trace.json")).toBe(0);
  });

  it("refuses an iCloud stub by its name without asking the system", () => {
    const checks = makePosixChecks({ platform: "darwin", statFlags: () => { throw new Error("not called"); } });
    expect(checks.fileAttributes("/x/.trace.json.icloud")).toBe(FILE_ATTRIBUTE_OFFLINE);
  });

  it("fails closed when the flags cannot be read or make no sense", () => {
    const unreadable = makePosixChecks({ platform: "darwin", statFlags: stat(new Error("boom")) });
    const nonsense = makePosixChecks({ platform: "darwin", statFlags: stat("zzz") });
    expect(codeOf(() => unreadable.fileAttributes("/x/a"))).toBe("E_PLATFORM:ATTRIBUTES_UNREADABLE");
    expect(codeOf(() => nonsense.fileAttributes("/x/a"))).toBe("E_PLATFORM:ATTRIBUTES_UNREADABLE");
  });

  it("reports no attributes on Linux, which has no placeholders", () => {
    const checks = makePosixChecks({ platform: "linux", statFlags: () => { throw new Error("not called"); } });
    expect(checks.fileAttributes("/x/a")).toBeNull();
  });

  it("refuses a placeholder before opening the file", () => {
    const file = path.join(root, "placeholder.json");
    fs.writeFileSync(file, "{}");
    const checks = makePosixChecks({ platform: "darwin", statFlags: stat(SF_DATALESS.toString(16)) });
    const open = vi.spyOn(fs, "openSync");
    expect(codeOf(() => readInputFile(file, 100, checks))).toBe("E_FILE_KIND:CLOUD_PLACEHOLDER_OR_OFFLINE");
    expect(open).not.toHaveBeenCalled();
  });
});

describe.skipIf(windows)("owner-only permissions and link checks on POSIX", () => {
  const checks = makePosixChecks({ platform: "linux" });

  it("creates a new runs folder with mode 0700, including folders made on the way", () => {
    const dir = path.join(root, "fresh", "deep", "runs");
    ensureRunsDirectory(dir, checks);
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
    expect(fs.statSync(path.join(root, "fresh")).mode & 0o777).toBe(0o700);
  });

  it("accepts an existing 0700 folder and refuses one that group or others can use", () => {
    const dir = path.join(root, "existing");
    fs.mkdirSync(dir, { mode: 0o700 });
    expect(ensureRunsDirectory(dir, checks)).toBe(dir);
    for (const mode of [0o750, 0o705, 0o770, 0o777]) {
      fs.chmodSync(dir, mode);
      expect(codeOf(() => ensureRunsDirectory(dir, checks)), mode.toString(8)).toBe("E_PLATFORM:RUNS_DIR_NOT_OWNER_ONLY");
    }
  });

  it("refuses a runs folder owned by another user", () => {
    const dir = path.join(root, "other-owner");
    fs.mkdirSync(dir, { mode: 0o700 });
    const owner = fs.lstatSync(dir).uid;
    vi.spyOn(process, "getuid").mockReturnValue(owner + 1);
    expect(codeOf(() => ensureRunsDirectory(dir, checks))).toBe("E_PLATFORM:RUNS_DIR_NOT_OWNER_ONLY");
  });

  it("writes imported run files with mode 0600", () => {
    const dir = path.join(root, "published");
    const span = {
      traceId: "11111111111111111111111111111111", spanId: "0000000000000001", name: "s", startTimeUnixNano: "100", endTimeUnixNano: "200",
      attributes: [{ key: "gen_ai.operation.name", value: { stringValue: "chat" } }],
    };
    const spans = new TextEncoder().encode(JSON.stringify({ resourceSpans: [{ scopeSpans: [{ spans: [span] }] }] }));
    const result = publishRun(importTraceBytes({ spans }), { runsDirectory: dir, checks });
    expect(fs.statSync(result.path).mode & 0o777).toBe(0o600);
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
  });

  it("refuses a symbolic link as the input file, and a link anywhere in its path", () => {
    const real = path.join(root, "real-dir");
    fs.mkdirSync(real);
    const file = path.join(real, "t.json");
    fs.writeFileSync(file, "{}");
    const fileLink = path.join(root, "file-link.json");
    const dirLink = path.join(root, "dir-link");
    fs.symlinkSync(file, fileLink);
    fs.symlinkSync(real, dirLink);
    expect(codeOf(() => readInputFile(fileLink, 100, checks))).toBe("E_PATH:LINK_IN_PATH");
    expect(codeOf(() => readInputFile(path.join(dirLink, "t.json"), 100, checks))).toBe("E_PATH:LINK_IN_PATH");
  });

  it("refuses a directory and a device as the input file", () => {
    expect(codeOf(() => readInputFile(root, 100, checks))).toBe("E_FILE_KIND:NOT_A_REGULAR_FILE");
    expect(codeOf(() => readInputFile("/dev/null", 100, checks))).toBe("E_FILE_KIND:NOT_A_REGULAR_FILE");
  });

  it("refuses a file larger than the limit", () => {
    const file = path.join(root, "big.json");
    fs.writeFileSync(file, "x".repeat(50));
    expect(codeOf(() => readInputFile(file, 10, checks))).toBe("E_LIMIT:FILE_TOO_LARGE");
  });
});
