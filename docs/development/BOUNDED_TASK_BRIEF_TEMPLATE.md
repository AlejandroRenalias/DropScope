# Bounded Task Brief

Use this compact brief before delegating or changing a non-trivial issue. Do not expand scope without reclassification.

```md
Issue:
Parallel batch / workstream ID:
Objective and acceptance criteria:
Declared file scope:
Files this worker may write:
Files reserved for the lead agent or other workers:
Dependencies and required inputs:
Complexity: low / medium / high
Risk: low / correctness-state / security-architecture-persistence-budget-recovery-migration-frozen-policy / workflow-permissions-publication
Route: lead agent direct / worker
Focused tests and required CI checks:
Workstream attempt: 1 of 2
Stop condition / escalation trigger:
Handoff format: changed files / focused-test result / unresolved concerns
```

Workers do not commit, push, merge, broaden scope, or edit another workstream's files. The lead agent integrates only after the batch completes.

After CI, record in `docs/development/PROGRESS.md` the candidate SHA, mechanical scope-check result, actual-diff risk recheck, implementation attempts, review requirement, review cycles and outcome, and CI runs.
