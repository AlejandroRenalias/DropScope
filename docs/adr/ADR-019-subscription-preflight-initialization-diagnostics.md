# ADR-019: Subscription preflight initialization diagnostics

## Status

Accepted for Phase 3.8j.

## Decision

Phase 3.8i's closed preflight diagnostic vocabulary is extended only for the initialization handshake. New unavailable results distinguish an app-server process that exits before replying, a JSON-RPC initialization rejection, an initialization response DropScope cannot safely recognize, and the existing fixed-window initialization timeout. The former generic `INITIALIZATION_FAILED` remains valid for already persisted histories and unclassified local process errors.

The mapper uses internal error classes rather than passing through an exit message, JSON-RPC message, stderr, account field, token, plan, usage value, or command detail. The browser projects only the closed code after replay; it never invokes the process or reads an account response.

Phase 3.8k aligns the client-side order with the documented app-server handshake: after writing the sole `initialize` request, DropScope immediately writes the `initialized` notification before waiting for the initialization response. This changes neither the request payload nor the following read-only `account/read` check, which remains deferred until a valid initialization response arrives.

Phase 3.8l makes the fixed Windows launcher explicit: it invokes `cmd.exe /d /s /c codex.cmd app-server` to run the locally installed `.cmd` shim, while non-Windows platforms retain direct `codex app-server` execution. Every Windows command fragment is a source-controlled constant; no user, mission, account, or event value becomes part of a shell command. The app-server arguments, piped JSONL transport, timeout, diagnostic vocabulary, and read-only preflight behavior are unchanged.

## Non-goals

This does not start login, refresh a token, read usage or rate limits, add configurable app-server command input, make retries, capture stderr, create a thread or turn, invoke a worker, or enable the disabled live-worker control.
