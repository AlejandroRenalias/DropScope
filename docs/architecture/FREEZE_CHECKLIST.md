# DropScope Architecture Baseline v1 — Freeze Checklist

**Date:** 2026-08-28

## Nine blocking decisions

- [x] B1 Determinism uses per-attempt random streams, persisted execution-affecting values, a pure reducer, sequence ordering, and a defined logical outcome.
- [x] B2 Budget uses four ledger states, computed mandatory protection, one focused revision, charged interruption, one mission-level recovery restart, and a crash-inclusive 110-unit worst case.
- [x] B3 Reviewer uses a separate frozen rubric and supports missing-evidence divergence while documenting partial scope independence.
- [x] B4 Canonical evidence includes independence group, signed strength, claim ID, fixture-declared reliability, and numeric frozen thresholds.
- [x] B5 Task/attempt state machines and mission projection/terminal semantics are explicit.
- [x] B6 Attempts, stale completion, interruption, JSONL durability, truncated-final-line, and recovery semantics are explicit.
- [x] B7 Risk & Eligibility Gatekeeper outcomes, consequences, and reason categories are explicit.
- [x] B8 Candidate count is consistently one to five, with insufficient evidence only when zero clear the gates after permitted research.
- [x] B9 TypeScript ADR, user-verifiable test discipline, and Zod runtime validation are accepted.

## Required Milestone 0 artifacts

- [x] Architecture Baseline v1 document
- [x] Commander policy file
- [x] Reviewer rubric policy file
- [x] Evidence policy and numeric thresholds
- [x] EvidenceRecord and shared contracts
- [x] Event envelope and required event types
- [x] Fixture manifest schema
- [x] OpenGap contract
- [x] Task and attempt transition tables
- [x] Mission phase and terminal-state semantics
- [x] ADR-009: TypeScript
- [x] ADR-010: Interrupted-attempt charging

## Consistency audit

- [x] Candidate-count language is consistent.
- [x] Budget arithmetic and formulas are consistent.
- [x] Reviewer and commander scoring implementations are explicitly separate.
- [x] Fixtures are prohibited from tuning frozen policies.
- [x] Holdout Fixture D is authored only after 1A freeze.
- [x] Milestone 1A exclusions are preserved.
- [x] No application code exists before this checklist passes.

## Freeze declaration

All boxes passed on 2026-08-28. Architecture Baseline v1 is frozen. Further load-bearing changes require a superseding ADR. The next artifact is a failing Milestone 1A.0 test.
