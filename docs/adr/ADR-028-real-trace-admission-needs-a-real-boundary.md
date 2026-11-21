# ADR-028: Real traces need a real access boundary

**Status:** Accepted, 2026-10-14.  
**Supersedes:** the admission condition in ADR-027 decision 9 (and `docs/schemas/run-event-contract-v1.md` section 11, item 2) only. Everything else in ADR-027 stands.

## Summary

DropScope saves imported agent runs in a folder on this computer. Real runs can contain private text. ADR-027 allowed real runs once a tool-level rule kept automated assistants out of that folder. A rule of that kind is a list of words and paths that one tool checks. It can be bypassed, for example by a command that builds the folder name from pieces, and it only configures one tool. It prevents some accidental reads and nothing more.

Real traces therefore stay out of this project until a boundary exists that the operating system enforces.

## Decision

1. **Real traces are not admitted** until a boundary is in place, reviewed, tested (decision 5) and approved. The boundary must protect every place the trace data can exist:
   - the original trace inputs (OTLP/JSON span and log files) before import;
   - the saved run files, at their actual resolved location (each Windows account has its own `%LOCALAPPDATA%`, and packaged apps can redirect it to a private copy);
   - every copy: OneDrive or other sync copies, backups, downloads, exports, temporary files;
   - loaded content: the replay screen reads the chosen file into browser memory, so it must run in a browser and session that no automated tool can connect to (no browser extension, remote debugging or preview helper shared with one).
2. **The boundary must be one that automated tools cannot override.** Accepted forms: a separate Windows user account that owns the data, or an isolated environment (virtual machine or container) that does not contain it. The account or environment that runs automated tools has no administrator rights and no backup or restore privilege (these can bypass file permissions), and no shared folder, mount or sync that exposes the data.
3. **Until then, only synthetic and demo traces** are used: the built-in demo runs and the test fixtures.
4. **Every tool counts**, including shell and child processes. The boundary must hold for each of them.
5. **Acceptance test.** A failed read proves nothing by itself: a wrong path, a missing file or a declined prompt all fail too. So:
   1. Put a synthetic file with known contents at the actual storage location, and at every other location from decision 1 that applies.
   2. Show that the data-side account reads it.
   3. From each tool's real execution identity, try every access route (file tools, shell, a computed path, a browser or helper connection) and record the operating-system error for each, with evidence that the boundary caused it.
   4. Repeat after any change to accounts, tools, shared folders, sync, backups or storage locations.

## Consequences

The product works with synthetic data. Real-trace use waits for a one-time setup (a second Windows account is the cheapest option) and a written setup record. Tool-level read rules can stay as an extra layer, but they are never described as isolation.

## Alternatives considered

- **Treat a tool-level rule as sufficient:** rejected. It can be bypassed by building the path, and it covers one tool.
- **A tool's built-in sandbox:** native Windows has no built-in shell sandbox that gives this boundary.
- **Per-tool rules for each assistant:** useful extra layers, but each can be bypassed the same way; not a boundary.
