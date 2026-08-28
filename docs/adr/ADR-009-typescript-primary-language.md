# ADR-009: TypeScript as the Primary Implementation Language

**Status:** Accepted  
**Date:** 2026-08-28

## Context

DropScope needs one set of contracts across a local CLI, orchestration engine, runtime adapters, tests, and a later browser interface. The user is learning through agent-assisted implementation and does not currently read a programming language fluently.

The engine also needs genuine asynchronous scheduling and runtime validation of simulated and later model-generated messages.

## Decision

Use TypeScript as the primary implementation language.

Use Zod at every external or persistence boundary because TypeScript types do not exist at runtime. Commands, events, fixtures, policies loaded as data, worker results, evidence, findings, and review results must be parsed before they can become authoritative.

## Reasons

- Shared contracts between engine, CLI, and React interface
- Suitable asynchronous programming model
- Strong editor and coding-agent support
- Direct fit with the planned local web interface
- Direct path to a future Codex SDK adapter
- Deliberate opportunity to learn typed contracts through a real project

## Tradeoffs

- The user will initially rely heavily on coding-agent assistance.
- Reviewing generated implementation detail is harder without language fluency.
- TypeScript can create false confidence if runtime input is not validated.
- The first walking skeleton may take longer than a language already familiar to the user.

## Required mitigation

No generated code may merge without a test the user wrote or can independently verify failing before the change and passing afterward.

The learning unit is therefore observable behavior and a testable contract, not approval of code the user cannot yet read confidently. Explanations should connect each code change to the contract, event, state transition, or acceptance criterion it implements.

## Consequences

- TypeScript is used in `packages/engine`, runtime adapters, CLI, and web UI.
- Zod is architecturally required, not an optional convenience.
- Type-only validation is insufficient for authoritative data.
- Tests and contract examples must remain readable and small enough for independent verification.

