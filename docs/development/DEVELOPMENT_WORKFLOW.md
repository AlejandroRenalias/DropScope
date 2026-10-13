# DropScope Development Workflow

## Purpose

This workflow governs coding agents developing DropScope. It is agent-neutral and separate from the in-product commander, reviewer, and evidence policies in `docs/policies/`. Shared rules are summarized in `AGENTS.md`; this document gives the detailed flow.

## Roles

- **Lead agent:** the main session agent. It owns scope, integration, validation, CI watching, final gates, and progress tracking, and is the sole integrator.
- **Bounded worker:** an optional fresh focused subagent. Up to three may run concurrently when their workstreams are independent, their file ownership is disjoint, and their dependencies are explicit. Each receives a completed bounded-task brief: objective, owned files, acceptance tests, and a stop condition.
- **Independent reviewer:** a read-only context (no write tools) that neither implemented nor led the change. It reviews the exact candidate SHA and reports actionable findings only.

Workers do not integrate, commit, push, merge, or broaden scope.

## Classification and routing

Classify every issue by complexity, risk, and declared file scope before implementation. Product-policy or architecture decisions require user approval before implementation.

| Condition | Implementation route |
| --- | --- |
| Low complexity and bounded scope | Lead agent directly, or a worker when delegation costs less than the work. |
| Medium complexity and bounded scope | A worker with a completed brief, or the lead agent. |
| High complexity, unclear scope, or important uncertainty | Lead agent. |

Complexity selects the implementer. Risk selects the required controls. Recheck risk against the actual diff after CI; a low-complexity change can still require review.

## Standard change flow

1. Freeze the issue and its workstream briefs: problem, boundaries, acceptance criteria, complexity, risk, file ownership, dependencies, focused tests, and stop conditions.
2. Form one parallel batch of one to three workers only when every pair of workstreams is independent and has disjoint write scope. Otherwise run the workstreams sequentially. Do not assign multiple workers to solve the same problem competitively.
3. Each worker changes only its owned files, runs its focused tests, and returns a concise handoff. Workers do not commit, push, merge, or edit shared integration files unless a brief gives one worker sole ownership.
4. After the full batch finishes, the lead agent inspects and integrates the combined work, resolves integration-only issues, runs the relevant combined local checks, creates the candidate commit, and records its exact SHA.
5. Run CI on that SHA (with the user's approval to push), then apply a mechanical scope/check gate and recheck risk from the integrated diff.
6. Request an independent read-only review if the rechecked risk requires it. Start review after implementation has stopped. The reviewer receives the briefs, integrated diff, CI evidence, and exact SHA, not implementation authority.
7. Resolve findings with targeted fixes; each changed SHA needs fresh relevant tests, CI, and any required review of the changed risk area.
8. Apply the final exact-SHA gate, merge only the approved SHA after explicit user approval, and record progress.

## Exact-SHA invariant

CI and review approvals are evidence about a particular Git commit, not a branch name. Any change creates a new SHA and requires fresh CI; required review must cover that new SHA or its explicitly scoped delta. The lead agent must compare the PR head SHA with the approved SHA immediately before merge.

## Risk-based independent review

Independent review is required for:

- security, persistence, budget accounting, recovery, migrations, architecture (frozen or not), frozen-policy work, and correctness-sensitive or state-transition work;
- changes to `AGENTS.md`, `CLAUDE.md`, this workflow, agent permission settings (for example `.claude/settings.json`), and publication or merge rules.

Use the highest available reasoning effort for security, persistence, budget, recovery, migration, and architecture (frozen or not) reviews. The reviewer must not have implemented or led the change, and must be read-only. Other low-risk work uses focused tests, CI, a mechanical gate, and lightweight lead-agent acceptance; do not add independent review by default. Do not run duplicate final reviews without a material new risk or a new SHA.

## Failure handling

- Flaky or infrastructure failure: rerun once without changing code.
- Clear local code failure: make one targeted repair in the affected workstream only.
- Policy, scope, architecture, security, or material uncertainty: escalate immediately.
- Allow at most two implementation attempts per workstream. Reassigning the workstream does not reset the counter. After its second failed attempt, stop that workstream and escalate to the user; do not restart the entire parallel batch.
- Distinguish environmental failures (missing browser, sandbox limits, network) from regressions, and report which one occurred. Never update visual snapshots just to make a test pass; review the image diff first.

## Final exact-SHA gate

Before merge, the lead agent verifies all of the following on the candidate SHA:

- focused tests passed (`npm run typecheck`, `npm test`, plus `npm run build` and `npm run test:e2e` for frontend changes);
- CI passed on that exact head SHA;
- required checks are present;
- changed files remain within declared scope;
- acceptance criteria are satisfied;
- required independent review passed; and
- merge targets that exact tested and approved SHA, with explicit user approval.

## User decision points

Ask the user before decisions that materially change product behavior, architecture, permissions, destructive operations, public exposure, costs, or agreed scope. In addition, pushes, pull requests (open, close, merge), branch deletion, GitHub setting, workflow or release changes, and publication of anything always need explicit approval. Normal implementation, targeted fixes, tests, and local commits within the approved issue scope do not.

## Progress discipline

Keep prompts compact, inspect only relevant files, and avoid duplicate work and reviews. Record in `docs/development/PROGRESS.md` what was done, validation results, implementation attempts per workstream, review cycles and outcomes, what remains, and open risks. `USAGE_LOG.md` is a frozen record of Codex-era usage; new entries go in `PROGRESS.md`. If effort begins rising unexpectedly, reduce the next batch size rather than weakening acceptance gates.

## Temporary seven-day sprint exception

During the sprint declared in `AGENTS.md`, the learning-oriented process (60/40 target, Learning Checkpoints, `LEARNING.md`) is paused, while technical explanations for architecture, security, persistence, budget, and recovery decisions and the `PROGRESS.md` reports are kept. The exception expires at 00:00 on 2026-10-20 in the user's local time zone unless the user explicitly extends or ends it earlier (see `AGENTS.md`). All gates in this document remain in force.
