# DropScope development instructions

## Authority and scope

- The Terra main task is the **Active Commander** and sole integrator for this repository. Keep its current model and settings.
- Start with at most one bounded Codex worker at a time. All execution is Codex-only.
- Preserve unrelated work. Never rewrite frozen architecture or product-runtime policies without a superseding ADR and user approval.
- `docs/policies/commander-policy.yaml` and `docs/policies/reviewer-rubric.yaml` govern agents inside the DropScope product. They do not govern Codex development work.

## Delivery rules

- Use an issue-sized scope, focused tests, and a small reviewable diff.
- CI, review, and merge approval apply to one exact commit SHA. Do not merge a newer SHA than the one CI and required review approved.
- Routine low-risk work uses CI plus the Active Commander gate. Independent Codex review is required only for milestones, architecture/contracts, orchestration or state transitions, persistence/migrations, security-sensitive changes, and significant releases.
- An independent reviewer is read-only and uses a separate Codex context. Apply targeted fixes only; after two unsuccessful fix/review cycles, diagnose and escalate to the user.
- Involve the user only for important product, architecture, permission, destructive, or scope-expanding decisions.
- Record visible usage and review value in `docs/development/USAGE_LOG.md`.

Read `docs/development/DEVELOPMENT_WORKFLOW.md` before non-trivial work.
