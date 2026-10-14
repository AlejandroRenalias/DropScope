// Safe local file access for the importer (spec section 11.1 and 11.2).
// - Input must be a plain local file: no network share, device name, alternate data stream, symbolic link
//   or junction anywhere in the path, and no cloud placeholder that would be downloaded on open.
// - The file is opened once; its identity is compared with the checked path; bytes are counted as they
//   arrive, whatever size the file system reports.
// - Where the platform cannot answer a check, the import fails closed (E_PLATFORM).
//
// Known limit: Node cannot read Windows file attributes from an open handle, so the placeholder check is
// made on the path just before the open. A file swapped in between would be caught by the identity check
// only when the file system reports stable file ids.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ImportError } from "./run-import-error.js";

const STAGE = "file";
export const FILE_ATTRIBUTE_OFFLINE = 0x1000;
export const FILE_ATTRIBUTE_RECALL_ON_OPEN = 0x40000;
export const FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS = 0x400000;
const PLACEHOLDER_MASK = FILE_ATTRIBUTE_OFFLINE | FILE_ATTRIBUTE_RECALL_ON_OPEN | FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS;

export type PlatformChecks = {
  readonly name: string;
  // Windows file attributes of a path (also rejects network drives), or null where there are none.
  fileAttributes(file: string): number | null;
  // Makes the directory exist with owner-only access, or verifies an existing one. `created` is true when
  // this call made the final directory.
  prepareRunsDirectory(dir: string, created: boolean): void;
};

const fail = (code: ConstructorParameters<typeof ImportError>[0], reason?: string): never => {
  throw new ImportError(code, STAGE, null, reason ?? null);
};

// ---- Windows implementation (PowerShell and icacls, absolute paths, no shell, path passed in the environment) ----
function systemExecutable(...parts: string[]): string {
  return path.join(process.env.SystemRoot ?? "C:\\Windows", ...parts);
}

function powershell(script: string, env: Record<string, string>): unknown {
  try {
    const text = execFileSync(
      systemExecutable("System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { env: { ...process.env, ...env }, encoding: "utf8", timeout: 20_000, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
    );
    return JSON.parse(text);
  } catch {
    return fail("E_PLATFORM", "POWERSHELL_UNAVAILABLE");
  }
}

const ALLOWED_SIDS = new Set(["S-1-5-18", "S-1-5-32-544"]); // SYSTEM and Administrators

export const windowsChecks: PlatformChecks = {
  name: "win32",
  fileAttributes(file) {
    const result = powershell(
      "$i = Get-Item -LiteralPath $env:DS_PATH -Force; " +
      "$d = [System.IO.DriveInfo]::new([System.IO.Path]::GetPathRoot($i.FullName)); " +
      "@{ attrs = [int]$i.Attributes; drive = $d.DriveType.ToString() } | ConvertTo-Json -Compress",
      { DS_PATH: file },
    ) as { attrs?: unknown; drive?: unknown };
    if (typeof result.attrs !== "number" || typeof result.drive !== "string") return fail("E_PLATFORM", "ATTRIBUTES_UNREADABLE");
    if (result.drive === "Network" || result.drive === "Unknown" || result.drive === "NoRootDirectory") fail("E_PATH", "NETWORK_OR_UNKNOWN_DRIVE");
    return result.attrs;
  },
  prepareRunsDirectory(dir, created) {
    const info = powershell(
      "@{ user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value } | ConvertTo-Json -Compress", {},
    ) as { user?: unknown };
    if (typeof info.user !== "string" || !/^S-1-[0-9-]+$/.test(info.user)) return fail("E_PLATFORM", "USER_SID_UNKNOWN");
    if (created) {
      try {
        execFileSync(systemExecutable("System32", "icacls.exe"),
          [dir, "/inheritance:r", "/grant:r", `*${info.user}:(OI)(CI)F`, "*S-1-5-18:(OI)(CI)F"],
          { windowsHide: true, stdio: "ignore", timeout: 20_000 });
      } catch {
        return fail("E_PLATFORM", "ACL_NOT_SET");
      }
    }
    const acl = powershell(
      "$a = Get-Acl -LiteralPath $env:DS_PATH; " +
      "$s = @($a.Access | ForEach-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value }); " +
      "@{ sids = $s } | ConvertTo-Json -Compress",
      { DS_PATH: dir },
    ) as { sids?: unknown };
    const sids = Array.isArray(acl.sids) ? acl.sids : typeof acl.sids === "string" ? [acl.sids] : null;
    if (sids === null) return fail("E_PLATFORM", "ACL_UNREADABLE");
    for (const sid of sids) if (sid !== info.user && !ALLOWED_SIDS.has(String(sid))) fail("E_PLATFORM", "RUNS_DIR_NOT_OWNER_ONLY");
  },
};

// ---- POSIX implementation: no offline attribute exists, directory mode is the access control ----
export const posixChecks: PlatformChecks = {
  name: "posix",
  fileAttributes: () => null,
  prepareRunsDirectory(dir, created) {
    if (created) fs.chmodSync(dir, 0o700);
    const stat = fs.lstatSync(dir);
    const uid = typeof process.getuid === "function" ? process.getuid() : stat.uid;
    if (!stat.isDirectory() || (stat.mode & 0o077) !== 0 || stat.uid !== uid) fail("E_PLATFORM", "RUNS_DIR_NOT_OWNER_ONLY");
  },
};

export function defaultChecks(): PlatformChecks {
  return process.platform === "win32" ? windowsChecks : posixChecks;
}

// ---- path rules ----
const RESERVED_NAME = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;

function checkPathText(raw: string): void {
  if (raw.length === 0 || raw.includes("\0")) fail("E_PATH", "EMPTY_OR_NUL");
  const windows = process.platform === "win32";
  if (windows) {
    if (raw.startsWith("\\\\") || raw.startsWith("//")) fail("E_PATH", "UNC_OR_DEVICE_PATH");
  }
}

function checkResolvedComponents(resolved: string): void {
  if (process.platform !== "win32") return;
  const root = path.parse(resolved).root;
  const rest = resolved.slice(root.length).split(path.sep).filter((s) => s.length > 0);
  for (const part of rest) {
    if (part.includes(":")) fail("E_PATH", "STREAM_OR_DRIVE_IN_PATH");
    if (RESERVED_NAME.test(part)) fail("E_PATH", "DEVICE_NAME");
    if (/[. ]$/.test(part)) fail("E_PATH", "TRAILING_DOT_OR_SPACE");
  }
}

// Resolves the path and rejects any symbolic link or junction in any existing component.
export function safeResolve(raw: string, allowMissingTail = false): string {
  checkPathText(raw);
  const resolved = path.resolve(raw);
  checkResolvedComponents(resolved);
  const root = path.parse(resolved).root;
  const parts = resolved.slice(root.length).split(path.sep).filter((s) => s.length > 0);
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && allowMissingTail) return resolved;
      return fail("E_PATH", "MISSING_OR_UNREADABLE");
    }
    if (stat.isSymbolicLink()) fail("E_PATH", "LINK_IN_PATH");
  }
  return resolved;
}

// ---- reading ----
export function readInputFile(file: string, maxBytes: number, checks: PlatformChecks = defaultChecks()): Uint8Array {
  const resolved = safeResolve(file);
  const before = fs.lstatSync(resolved, { bigint: true });
  if (!before.isFile()) return fail("E_FILE_KIND", "NOT_A_REGULAR_FILE");
  // Attributes are read before the open: opening a cloud placeholder would download it.
  const attributes = checks.fileAttributes(resolved);
  if (attributes !== null && (attributes & PLACEHOLDER_MASK) !== 0) fail("E_FILE_KIND", "CLOUD_PLACEHOLDER_OR_OFFLINE");

  let fd: number;
  try {
    fd = fs.openSync(resolved, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  } catch {
    return fail("E_PATH", "OPEN_FAILED");
  }
  try {
    const stat = fs.fstatSync(fd, { bigint: true });
    if (!stat.isFile()) return fail("E_FILE_KIND", "NOT_A_REGULAR_FILE");
    if ((stat.ino !== 0n || before.ino !== 0n) && (stat.ino !== before.ino || stat.dev !== before.dev)) fail("E_PATH", "FILE_CHANGED_DURING_OPEN");
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const buffer = Buffer.allocUnsafe(Math.min(1 << 20, maxBytes + 1 - total));
      const read = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (read === 0) break;
      total += read;
      if (total > maxBytes) fail("E_LIMIT", "FILE_TOO_LARGE");
      chunks.push(buffer.subarray(0, read));
    }
    return new Uint8Array(Buffer.concat(chunks, total));
  } finally {
    fs.closeSync(fd);
  }
}

// ---- the runs directory ----
export function defaultRunsDirectory(): string {
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA;
    if (!base) return fail("E_PLATFORM", "LOCALAPPDATA_UNSET");
    return path.join(base, "DropScope", "runs");
  }
  return path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"), "dropscope", "runs");
}

export function ensureRunsDirectory(dir: string, checks: PlatformChecks = defaultChecks()): string {
  const resolved = safeResolve(dir, true);
  const existed = fs.existsSync(resolved);
  if (!existed) fs.mkdirSync(resolved, { recursive: true });
  // A freshly made tree must not contain links either.
  safeResolve(resolved);
  const stat = fs.lstatSync(resolved);
  if (!stat.isDirectory()) return fail("E_FILE_KIND", "RUNS_PATH_NOT_A_DIRECTORY");
  checks.prepareRunsDirectory(resolved, !existed);
  return resolved;
}
