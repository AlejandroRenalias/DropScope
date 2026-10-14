# DropScope development instructions

These rules are shared by every coding agent working on this repository (Claude Code, Codex, or others). Tool-specific notes live in agent-specific files such as `CLAUDE.md`.

## Authority and scope

- The **lead agent** is the main session agent. It owns scope, integration, validation, and the final gates, and is the only agent that commits.
- The lead agent may run up to three bounded subagents concurrently when their work is independent and file ownership and dependencies are explicit. Do not add subagents, skills, or hooks without a concrete need.
- Preserve unrelated work. Never rewrite frozen architecture or product-runtime policies without a superseding ADR and user approval.
- `docs/policies/commander-policy.yaml` and `docs/policies/reviewer-rubric.yaml` govern agents inside the DropScope product. They do not govern development agents.

## Delivery rules

- Classify each issue by complexity, risk, and scope before changing code. Product-policy and architecture decisions stop for user approval before implementation.
- Complexity selects who implements: bounded, well-specified work may go to a fresh subagent; high complexity, unclear scope, or important uncertainty stays with the lead agent. Risk controls review, not the implementer; recheck risk against the integrated diff after CI.
- Use the compact brief at `docs/development/BOUNDED_TASK_BRIEF_TEMPLATE.md` for delegated work. Parallelize only independent workstreams with disjoint declared file ownership and no unresolved dependency between them. No two implementation workers may edit the same file; shared contracts, integration files, and cross-cutting changes have one owner. Workers do not commit, push, or merge.
- Independent read-only review (by a fresh reviewer that neither implemented nor led the change) is **required** for changes to: security, persistence, budget accounting, recovery, architecture (frozen or not), frozen policy, migrations, and correctness-sensitive or state-transition work. It is also required for changes to this file, `CLAUDE.md`, the development workflow, agent permissions, and publication rules. Other work needs focused tests, CI, a mechanical gate, and lightweight lead-agent acceptance, not independent review by default.
- On a flaky or infrastructure failure, rerun once without changing code. On a clear local failure, make one targeted repair. Escalate policy, scope, architecture, security, or material uncertainty immediately. Each workstream has at most two implementation attempts; reassigning it does not reset the counter.
- CI, review, and merge approval apply to one exact commit SHA. Do not merge a newer SHA than the one CI and required review approved.
- Before merge, confirm focused tests, CI on the exact head SHA, required checks, in-scope files, acceptance criteria, and any required independent review. Merge only that tested and approved SHA.
- Explicit user approval is required to push a branch, open, close or merge a pull request, delete a branch, change GitHub settings, run GitHub workflows or releases, or publish anything. Local edits and local commits within the approved issue scope do not need it.
- Visual regression snapshots may be updated only after the diff has been reviewed; never regenerate them to make a failing test pass.
- Apart from the approval gates above, involve the user only for important product, architecture, permission, destructive, or scope-expanding decisions.
- Record progress, validation results, implementation attempts, review cycles, and review outcomes in `docs/development/PROGRESS.md`. `docs/development/USAGE_LOG.md` is a frozen historical record of earlier Codex-era work; do not rewrite its rows.

Read `docs/development/DEVELOPMENT_WORKFLOW.md` before non-trivial work.

## Communication with the user

The user is a beginner in software engineering and does not know the jargon. These rules apply to every chat reply, report and document written for the user, and they are not paused by any exception.

- Use plain words and short sentences. Say what something is and why it matters before how it works.
- Explain every technical term, acronym, tool name and abbreviation in a short phrase the first time it appears in a conversation, and again when it has not appeared for a while. If unsure whether the user knows a term, explain it.
- Lead with the conclusion or the decision needed, then the reason. Use everyday comparisons. Do not stack identifiers (commit hashes, error codes, file paths) without saying what they are and why they matter.
- Do not assume earlier context: restate in one sentence what a decision is about.
- Code, ADRs and specifications may stay technical, but anything the user must decide on needs a plain-language summary at the top.
- Reusable lessons from this repository are in `docs/development/WORKING_PRINCIPLES.md`.

## Temporary sprint exception

In effect from 2026-10-13 until 00:00 on 2026-10-31 in the user's local time zone (exclusive), unless the user explicitly ends it earlier. The user extended it on 2026-10-13 from its original end of 2026-10-20 and will re-decide when the first working version (phases 0 to 3 of `docs/development/PROPOSAL_AGENT_RUN_FORENSICS.md`) is reached. Continuing beyond that time requires another explicit, approved extension. After expiry without an extension, all engineering gates continue unchanged. The learning workflow stays paused: on 2026-10-13 the user decided not to resume it, and it resumes only if the user later says so. The plain-language rule in "Communication with the user" applies regardless. The exception changes working style only; it does not amend the product plan, the frozen architecture, any ADR, or any product policy.

- **Paused:** the 60/40 product/learning target, Routine versus Learning Checkpoint classification, mental-model briefings, `LEARNING.md` updates, and teaching-oriented debugging exercises. Earlier Codex-era documents that mention these remain valid history.
- **Kept:** a short technical explanation whenever a decision touches architecture, security, persistence, budget accounting, or recovery, plus the progress reports in `docs/development/PROGRESS.md` (done, in progress, remaining, risks).
- **Unchanged:** every gate above, the exact-SHA rule, the review requirements, and the approval gates.
