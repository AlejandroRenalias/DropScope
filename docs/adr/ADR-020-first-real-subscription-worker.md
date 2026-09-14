# ADR-020: First real subscription-worker pilot

## Status

Accepted for Phase 3.9 with the user's explicit real-run and safest-permission approval.

## Decision

DropScope may execute exactly one real Codex app-server turn only through the fixed `live-worker-pilot` local mission. The browser must first obtain the existing authenticated preflight and one-use, 60-second, local-memory confirmation. A separate final **Run one live worker now** action consumes that confirmation immediately before the process can start. No capability, thread ID, turn ID, item ID, command, path, prompt transcript, provider response, account data, usage, plan, quota, price, or raw error is persisted or returned to the browser.

The app-server process receives one `initialize` / `initialized` handshake, then a fresh `account/read` with token refresh disabled in that same process. Only a `chatgpt` account result may proceed to one fresh ephemeral `thread/start`, then one `turn/start`. The installed app-server schema uses `on-request`, `read-only`, and a read-only turn policy with `networkAccess: false`. Its current read-only policy has no root or per-turn tool allowlist field, so the pilot supplies its complete fixed evidence inline, forbids tool use, and accepts only passive transcript items (`userMessage`, `agentMessage`, reasoning, plan, or context compaction). Any command, file, MCP, web, or dynamic-tool item terminates the process without accepting a result. Its working directory is a dedicated empty directory under DropScope's local runtime data root, not a mission history or source directory.

The safest permission policy is fail-closed: any command-execution, file-change, or permission approval request immediately terminates the local app-server process and records only `APPROVAL_DECLINED`. No approval response is sent, and no approval is accepted implicitly. Other unexpected server requests fail as `TURN_FAILED`. Timeout, unavailable runtime, interruption, malformed or identity-mismatched structured output, and turn failure are likewise reduced to the existing closed terminal vocabulary.

After the process is terminal, DropScope appends one `SubscriptionWorkerExecutionOutcomeRecorded` event with only the running attempt ID, coarse outcome, capped elapsed milliseconds, and `UNKNOWN` provider usage. A strictly validated successful result then uses the existing `FindingSubmitted` and `MissionCompleted` lifecycle. Every non-success uses `TaskFailedPermanent` and `MissionTerminated` with a coarse reason. There is no retry, fallback provider, API-key path, login flow, usage lookup, or automatic execution.

## Supersedes

This supersedes only ADR-014 and ADR-015's future-execution non-goals for the fixed pilot. Their one-turn, 90-second, one-use-confirmation, strict-result, no-network, no-retry, and no-billing-data constraints remain in force. The persisted subscription declaration intentionally remains `executionEnabled: false`; it describes the general subscription runtime, while this ADR admits the single guarded pilot exception.

## Non-goals

This does not make subscription execution generally available, add multi-worker execution, expose an approval relay, accept a tool permission, widen filesystem access, allow network access, retry a failed worker, estimate or collect subscription usage, use a metered API fallback, retain provider transcript data, push, publish, or create a remote resource.
