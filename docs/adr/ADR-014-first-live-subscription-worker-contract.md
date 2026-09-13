# ADR-014: First live subscription worker contract

## Status

Accepted for Phase 3.8a.

## Decision

DropScope now has a pure, non-executing contract for its first possible subscription-backed worker. It plans exactly one fresh Codex thread followed by exactly one turn, with a 90-second maximum, read-only filesystem access restricted to the supplied fixture root, `onRequest` approvals, and the existing strict `{ taskId, attemptId, status, finding }` output boundary.

The plan records no thread ID, account data, token, plan, quota, price, or provider usage. It is not wired to the local runtime, HTTP server, scheduler, or a process transport. The Agent Desk renders a disabled live-run button only when the persisted subscription-runtime declaration exists. The control has no handler or execution endpoint.

Host policy must deny network access before any later execution adapter can consume this plan. The prompt separately prohibits web research, public sources, file modifications, and broader permission requests. There is no automatic retry, fallback, or metered API path.

## Non-goals

This does not start `codex app-server`, create a thread, begin a turn, send a prompt, create a worker event, or consume subscription capacity. It does not make a preflight result authorization to run.

## Future authorization

A later phase must obtain a fresh user approval immediately before a single execution, validate that the host network-denial policy is active, handle explicit app-server approval requests, durably record an outcome without retaining the Codex thread ID, and fail closed on timeout, invalid output, or unavailable access. That future phase needs new tests and review before it can add an execution endpoint or enable this control.
