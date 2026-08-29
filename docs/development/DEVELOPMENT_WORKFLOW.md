# DropScope Development Workflow

## Purpose

This workflow governs Codex agents developing DropScope. It is separate from the in-product commander, reviewer, and evidence policies in `docs/policies/`.

## Roles

- **Active Commander:** the Terra main task. It owns scope, integration, CI watching, final gates, and usage tracking.
- **Bounded worker:** one fresh focused Codex worker at a time. It receives a completed bounded-task brief: objective, owned files, acceptance tests, and a stop condition.
- **Independent reviewer:** a read-only Codex context that did not implement the change. It reviews the exact candidate SHA and reports actionable findings only.

## Classification and routing

Classify every issue by complexity, risk, and declared file scope before implementation. Product-policy or architecture decisions require user approval before implementation.

| Condition | Initial implementation route |
| --- | --- |
| Low complexity and bounded scope | Fresh Luna/low worker, or Commander directly when delegation costs more than the work. |
| Medium complexity and bounded scope | Fresh Luna/medium worker. |
| High complexity, unclear scope, or important uncertainty | Terra/medium. |

Complexity selects the implementation model. Risk selects the required controls. Recheck risk against the actual diff after CI; a low-complexity change can still require review.

## Standard change flow

1. Freeze the brief: problem, boundaries, acceptance criteria, complexity, risk, scope, and focused tests.
2. Assign no more than one bounded worker, or implement directly when delegation adds no value.
3. Run focused local tests and the relevant local checks. Create the candidate commit and record its exact SHA.
4. Run CI on that SHA, then apply a mechanical scope/check gate and recheck risk from the actual diff.
5. Request an independent read-only review only if the rechecked risk requires it. The reviewer receives the brief, diff, CI evidence, and exact SHA—not implementation authority.
6. Resolve permitted findings with targeted fixes; each changed SHA needs fresh relevant tests, CI, and any required review of the changed risk area.
7. Apply the final exact-SHA gate, merge only the approved SHA, and record usage and review value.

## Exact-SHA invariant

CI and review approvals are evidence about a particular Git commit, not a branch name. Any change creates a new SHA and requires fresh CI; required review must cover that new SHA or its explicitly scoped delta. The Active Commander must compare the PR head SHA with the approved SHA immediately before merge.

## Risk-based independent review

Independent review is required only when risk warrants it:

- correctness-sensitive or state-transition work: fresh read-only Luna/medium reviewer;
- security, architecture, persistence, migration, or frozen-policy work: fresh read-only Terra/medium reviewer.

The reviewer must not have implemented or commanded the change. Low-risk work uses focused tests, CI, a mechanical gate, and lightweight Commander acceptance; do not add independent AI review by default. Do not run duplicate final reviews without a material new risk or new SHA.

## Failure handling

- Flaky or infrastructure failure: rerun once without changing code.
- Clear local code failure: make one targeted repair.
- Policy, scope, architecture, security, or material uncertainty: escalate immediately.
- Allow at most two implementation attempts globally per issue. Changing models does not reset the counter. After the second failed attempt, stop and escalate to the user.

## Final exact-SHA gate

Before merge, the Active Commander verifies all of the following on the candidate SHA:

- focused tests passed;
- CI passed on that exact head SHA;
- required checks are present;
- changed files remain within declared scope;
- acceptance criteria are satisfied;
- required independent review passed; and
- merge targets that exact tested and approved SHA.

## User decision points

Ask the user before decisions that materially change product behavior, architecture, permissions, destructive operations, public exposure, costs, or agreed scope. Keep normal implementation, targeted fixes, tests, and local commits within the approved issue scope.

## Usage discipline

Keep prompts compact, inspect only relevant files, and avoid duplicate reviews. For each new task, record model/effort, worker runs, implementation attempts, review cycles, CI runs, whether extra model work changed the outcome, and exact visible credits only when available in `USAGE_LOG.md`.
