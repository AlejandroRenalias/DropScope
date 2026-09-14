# ADR-018: Subscription preflight safe diagnostics

## Status

Accepted for Phase 3.8i.

## Decision

DropScope continues to persist exactly one user-triggered subscription preflight per mission and remains dry-run-only. New preflight events add one closed `diagnosticCode` alongside the existing coarse access status. The allowed codes identify only the failed local layer: app-server start, initialization failure or timeout, account-read failure or timeout, or an account response that cannot be safely recognized. Successful supported and unsupported account responses receive `NOT_APPLICABLE`.

The diagnostic mapper discards every thrown error message and every app-server response field before creating the result. In particular, it never persists or projects an account email, plan, token, account identifier, raw RPC error, command, path, usage, rate limit, or billing data. A timeout is surfaced as a category only, not with a duration beyond the existing fixed 10-second policy.

Existing version-1 histories without a diagnostic code remain valid and replay as the prior generic unavailable message. New events are projected from their persisted closed code, so reload and browser replay do not re-query Codex.

## Non-goals

This does not start a login flow, token refresh, thread, turn, command, tool, worker, network access, retry, fallback, confirmation, or execution path. It does not change the disabled live-worker control or create a route beyond the existing user-triggered preflight endpoint.
