# DropScope development instructions

## Authority and scope

- The Terra main task is the **Active Commander** and sole integrator for this repository. Keep its current model and settings.
- Start with at most one bounded Codex worker at a time. All execution is Codex-only.
- Preserve unrelated work. Never rewrite frozen architecture or product-runtime policies without a superseding ADR and user approval.
- `docs/policies/commander-policy.yaml` and `docs/policies/reviewer-rubric.yaml` govern agents inside the DropScope product. They do not govern Codex development work.

## Delivery rules

- Classify each issue by complexity, risk, and scope before changing code. Product-policy and architecture decisions stop for user approval before implementation.
- Route implementation by complexity: low, bounded work uses a fresh Luna/low worker; medium, bounded work a fresh Luna/medium worker; high complexity, unclear scope, or important uncertainty Terra/medium. Risk controls review, not the implementation model; recheck risk against the actual diff after CI.
- Use the compact brief at `docs/development/BOUNDED_TASK_BRIEF_TEMPLATE.md` for delegated work. Keep one bounded worker active at a time; do not create an efficiency skill.
- Low-risk work needs focused tests, CI, a mechanical gate, and lightweight Commander acceptance—not independent AI review by default. When risk requires review, use a fresh read-only reviewer who neither implemented nor commanded the change: Luna/medium for correctness-sensitive or state-transition work; Terra/medium for security, architecture, persistence, migration, or frozen-policy work.
- On a flaky/infrastructure failure, rerun once without changing code. On a clear local failure, make one targeted repair. Escalate policy, scope, architecture, security, or material uncertainty immediately. There are at most two implementation attempts globally per issue; changing models does not reset the counter.
- CI, review, and merge approval apply to one exact commit SHA. Do not merge a newer SHA than the one CI and required review approved.
- Before merge, confirm focused tests, CI on the exact head SHA, required checks, in-scope files, acceptance criteria, and any required independent review. Merge only that tested and approved SHA.
- Involve the user only for important product, architecture, permission, destructive, or scope-expanding decisions.
- Record model/effort, worker runs, implementation attempts, review cycles, CI runs, and whether extra model work changed the outcome in `docs/development/USAGE_LOG.md`; record exact credits only when visible.

Read `docs/development/DEVELOPMENT_WORKFLOW.md` before non-trivial work.
