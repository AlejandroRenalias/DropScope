# ADR-013: Subscription runtime preflight boundary

## Status

Accepted for Phase 3.7c.

## Decision

DropScope exposes one user-triggered local preflight per persisted mission. The local runtime starts `codex app-server` only after the Agent Desk button is pressed, sends `initialize`, then sends `account/read` with `refreshToken: false`. It does not start a login flow, Codex thread, turn, command, tool, or worker.

The runtime discards all account response fields except a closed coarse status: `CHATGPT_AUTHENTICATED`, `AUTHENTICATION_REQUIRED`, `UNSUPPORTED_AUTH_MODE`, or `UNAVAILABLE`. It persists `SubscriptionRuntimePreflightCompleted` with that status and `usageStatus: NOT_ITEMIZED` after the mission's disabled declaration. No identity, token, plan, rate-limit, usage, or billing data enters the event stream or browser DTO.

## Non-goals

This is not a live-worker authorization. It does not install dependencies, authenticate a user, refresh a token, inspect quota, spend subscription usage, enable network access, or grant approvals automatically. A failed or unavailable preflight is recorded honestly and does not trigger a retry.

The local runtime retains its existing trusted-loopback posture. The Agent Desk click is an application interaction gate, not a capability or anti-CSRF boundary against arbitrary software already able to make loopback requests on the same computer.

## Replay and future authorization

Replay derives the displayed result from the persisted preflight event. Histories without it remain `NOT_CHECKED`. A first Codex thread and turn require a separate user approval, reviewed event contract, and explicit command, filesystem, and network approval handling.
