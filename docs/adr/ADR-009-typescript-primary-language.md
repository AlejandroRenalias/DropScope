# ADR-009: TypeScript as the Primary Implementation Language

**Status:** Accepted  
**Date:** 2026-08-28

## Context

DropScope needs one set of contracts across a local CLI, orchestration engine, runtime adapters, tests, and a later browser interface.

The engine also needs genuine asynchronous scheduling and runtime validation of simulated and later model-generated messages.

## Decision

Use TypeScript as the primary implementation language.

Use Zod at every external or persistence boundary because TypeScript types do not exist at runtime. Commands, events, fixtures, policies loaded as data, worker results, evidence, findings, and review results must be parsed before they can become authoritative.

## Reasons

- Shared contracts between engine, CLI, and React interface
- Suitable asynchronous programming model
- Strong editor and coding-agent support
- Direct fit with the planned local web interface
- Direct path to a future local worker adapter
- Typed contracts that document the system's behavior

## Tradeoffs

- TypeScript can create false confidence if runtime input is not validated.
- The first walking skeleton may take longer than in a language the maintainers already use daily.

## Required mitigation

No change merges without a test that fails before the change and passes afterward.

The unit of review is observable behavior and a testable contract. Each change should connect to the contract, event, state transition, or acceptance criterion it implements.

## Consequences

- TypeScript is used in `packages/engine`, runtime adapters, CLI, and web UI.
- Zod is architecturally required, not an optional convenience.
- Type-only validation is insufficient for authoritative data.
- Tests and contract examples must remain readable and small enough for independent verification.

