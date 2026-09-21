# ADR-017: Subscription worker protocol fake

## Status

Accepted for Phase 3.8e.

## Decision

DropScope has a pure in-memory fake for the narrow app-server stream it will need later: command, file-change, and permission approval requests; terminal turn status; and a separately supplied strict structured-result candidate. Approval state exposes only its category. Thread IDs, turn IDs, item IDs, commands, paths, raw errors, and provider details are discarded.

The fake cannot spawn `codex app-server`, send JSON-RPC, accept an approval, persist data, mutate the scheduler, or invoke a worker. It permits only an explicit simulated decline, which maps to the existing coarse `APPROVAL_DECLINED` outcome in a later separately approved execution phase. The live-worker plan now also sets `networkAccess: false` in its read-only turn sandbox policy.

## Non-goals

This does not add an HTTP route, browser approval UI, transport, process, thread, turn, prompt, real result, outcome append, finding submission, permanent failure, retry, fallback, credential, usage, or billing path.
