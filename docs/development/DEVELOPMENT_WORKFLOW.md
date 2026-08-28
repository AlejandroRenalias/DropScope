# DropScope Development Workflow

## Purpose

This workflow governs Codex agents developing DropScope. It is separate from the in-product commander, reviewer, and evidence policies in `docs/policies/`.

## Roles

- **Active Commander:** the Terra main task. It owns scope, integration, CI watching, final gates, and usage tracking.
- **Bounded worker:** one focused Codex worker at a time initially. It receives a defined objective, owned files, acceptance tests, and a stop condition.
- **Independent reviewer:** a read-only Codex context that did not implement the change. It reviews the exact candidate SHA and reports actionable findings only.

## Standard change flow

1. Freeze the issue: define the problem, boundaries, acceptance criteria, risk class, and tests.
2. Assign one bounded Codex worker, or implement directly when delegation adds no value.
3. Run focused local tests, then the relevant full local checks.
4. Create a draft pull request linked to the issue and record its exact head SHA.
5. GitHub Actions runs on that SHA. The Active Commander watches the existing check run with `gh pr checks <PR_NUMBER> --watch`; waiting is not a sequence of new agent prompts.
6. Apply the Commander gate: scope is still frozen, CI passed, diff is understandable, and the head SHA is unchanged.
7. Request an independent read-only Codex review only when required by the risk class below. The reviewer receives the issue, acceptance criteria, diff, CI evidence, and exact SHA—not implementation authority.
8. Resolve findings with targeted fixes. Re-run local tests and CI on the new exact SHA. Re-review only the changed risk area when review remains required.
9. Stop after two unsuccessful fix/review cycles. Diagnose the recurring problem and ask the user for direction rather than spending more attempts.
10. The Active Commander performs the final gate and merges only the exact approved SHA. Verify `main`, issue closure, and record the learning and visible usage.

## Exact-SHA invariant

CI and review approvals are evidence about a particular Git commit, not a branch name. Any change creates a new SHA and requires fresh CI; required review must cover that new SHA or its explicitly scoped delta. The Active Commander must compare the PR head SHA with the approved SHA immediately before merge.

### Temporary local-verification fallback

GitHub Actions is paused while the repository has no available Actions minutes. Until it is restored, a successful local `npm run typecheck` and `npm test` run recorded against the exact head SHA replaces the CI gate. The PR must include the commands, success output summary, and SHA. Required independent review and the Active Commander gate remain unchanged. Do not make the repository public solely to bypass this temporary limit. Restore the normal GitHub Actions gate when minutes are available again.

## Risk-based independent review

Independent review is mandatory for:

- milestone completion or significant release;
- architecture, contracts, or frozen-policy-adjacent changes;
- agent orchestration, scheduling, state transitions, retries, or recovery;
- persistence, migrations, durability, or data-loss risk;
- security-sensitive changes.

Routine low-risk changes use CI plus the Active Commander gate. Do not run duplicate final reviews without a material new risk or new SHA.

## User decision points

Ask the user before decisions that materially change product behavior, architecture, permissions, destructive operations, public exposure, costs, or agreed scope. Keep normal implementation, targeted fixes, tests, and local commits within the approved issue scope.

## Usage discipline

Keep prompts compact, inspect only relevant files, and avoid duplicate reviews. Record approximate visible usage or credits when available, plus whether independent review changed the outcome, in `USAGE_LOG.md`.
