# Bounded Task Brief

Use this compact brief before delegating or changing a non-trivial issue. Do not expand scope without reclassification.

```md
Issue:
Parallel batch / workstream ID:
Objective and acceptance criteria:
Declared file scope:
Files this worker may write:
Files reserved for Terra or other workers:
Dependencies and required inputs:
Complexity: low / medium / high
Risk: low / correctness-state / security-architecture-persistence-migration-frozen-policy
Initial route: Commander direct / fresh Luna low / fresh Luna medium / Terra Commander
Focused tests and required CI checks:
Workstream attempt: 1 of 2
Stop condition / escalation trigger:
Handoff format: changed files / focused-test result / unresolved concerns
```

Workers do not commit, push, merge, broaden scope, or edit another workstream's files. Terra integrates only after the batch completes.

After CI, record the parallel batch size, candidate SHA, mechanical scope-check result, actual-diff risk recheck, review requirement and outcome, CI runs, and whether extra model work changed the outcome in `USAGE_LOG.md`.
