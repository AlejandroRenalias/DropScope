# DropScope Development Workflow

## Purpose

This workflow governs Codex agents developing DropScope. It is separate from the in-product commander, reviewer, and evidence policies in `docs/policies/`.

## Roles

- **Active Commander:** the Terra main task. It owns scope, integration, CI watching, final gates, and usage tracking.
- **Bounded worker:** a fresh focused Luna subagent. Up to three may run concurrently when their workstreams are independent, their file ownership is disjoint, and their dependencies are explicit. Each receives a completed bounded-task brief: objective, owned files, acceptance tests, and a stop condition.
- **Independent reviewer:** a read-only Codex context that did not implement the change. It reviews the exact candidate SHA and reports actionable findings only.

The Terra Commander is the sole integrator. Workers do not integrate, commit, push, merge, or broaden scope.

## Classification and routing

Classify every issue by complexity, risk, and declared file scope before implementation. Product-policy or architecture decisions require user approval before implementation.

| Condition | Initial implementation route |
| --- | --- |
| Low complexity and bounded scope | Fresh Luna/low worker, or Commander directly when delegation costs more than the work. |
| Medium complexity and bounded scope | Fresh Luna/medium worker. |
| High complexity, unclear scope, or important uncertainty | Terra Commander. |

Complexity selects the implementation model. Risk selects the required controls. Recheck risk against the actual diff after CI; a low-complexity change can still require review.

## Standard change flow

1. Freeze the issue and its workstream briefs: problem, boundaries, acceptance criteria, complexity, risk, file ownership, dependencies, focused tests, and stop conditions.
2. Form one parallel batch of one to three fresh Luna workers only when every pair of workstreams is independent and has disjoint write scope. Otherwise run the workstreams sequentially. Do not assign multiple workers to solve the same problem competitively.
3. Each worker changes only its owned files, runs its focused tests, and returns a concise handoff. Workers do not commit, push, merge, or edit shared integration files unless a brief gives one worker sole ownership.
4. After the full batch finishes, Terra inspects and integrates the combined work, resolves integration-only issues, runs the relevant combined local checks, creates the candidate commit, and records its exact SHA.
5. Run CI on that SHA, then apply a mechanical scope/check gate and recheck risk from the integrated diff.
6. Request an independent read-only review only if the rechecked risk requires it. Start review after implementation workers have stopped. The reviewer receives the briefs, integrated diff, CI evidence, and exact SHA—not implementation authority.
7. Resolve permitted findings with targeted fixes; each changed SHA needs fresh relevant tests, CI, and any required review of the changed risk area.
8. Apply the final exact-SHA gate, merge only the approved SHA, and record usage and review value.

## Exact-SHA invariant

CI and review approvals are evidence about a particular Git commit, not a branch name. Any change creates a new SHA and requires fresh CI; required review must cover that new SHA or its explicitly scoped delta. The Active Commander must compare the PR head SHA with the approved SHA immediately before merge.

## Risk-based independent review

Independent review is required only when risk warrants it:

- correctness-sensitive or state-transition work: fresh read-only Luna/medium reviewer;
- security, architecture, persistence, migration, or frozen-policy work: fresh read-only Luna/high reviewer.

The reviewer must not have implemented or commanded the change. Low-risk work uses focused tests, CI, a mechanical gate, and lightweight Commander acceptance; do not add independent AI review by default. Do not run duplicate final reviews without a material new risk or new SHA.

## Failure handling

- Flaky or infrastructure failure: rerun once without changing code.
- Clear local code failure: make one targeted repair in the affected workstream only.
- Policy, scope, architecture, security, or material uncertainty: escalate immediately.
- Allow at most two implementation attempts per workstream. Changing effort or reassigning the workstream does not reset the counter. After its second failed attempt, stop that workstream and escalate to the user; do not restart the entire parallel batch.

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

Keep prompts compact, inspect only relevant files, and avoid duplicate work and reviews. Record the parallel batch size and each workstream's model/effort, worker runs, implementation attempts, review cycles, CI runs, whether extra model work changed the outcome, and exact visible credits only when available in `USAGE_LOG.md`. If usage begins rising unexpectedly, reduce the next batch size rather than weakening acceptance gates.
