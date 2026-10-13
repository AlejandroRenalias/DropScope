@AGENTS.md

# Claude Code notes

Shared engineering rules, review requirements, and the temporary sprint exception are in `AGENTS.md` (imported above). Detailed flow: `docs/development/DEVELOPMENT_WORKFLOW.md`. Only Claude-specific guidance is below.

## Commands (Node 24, matching CI)

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run (unit)
npm run build       # vite build
npm run test:e2e    # Playwright; frontend changes only
```

CI runs `npm ci`, `typecheck`, and `test` on Ubuntu. Run `build` and `test:e2e` locally for frontend work. `playwright.config.ts` uses the `chrome` channel, so Chrome must be installed. When visual snapshots exist (currently only on the backup branch) they are `win32`-specific; review any diff before accepting it, and never run `--update-snapshots` just to get green.

## Working rules

- Do not commit unrelated files; the repo may contain untracked prototypes and local artifacts. Stage explicit paths; never `git add -A`, `git add .` or `git commit -a`. Before committing, check `git status` and `git diff --cached --stat`, and re-stage any file edited after staging.
- Never push, open/close/merge a PR, delete a branch, change GitHub settings, run workflows or releases, or publish anything without explicit user approval (see `AGENTS.md`).
- Do not add skills, hooks, or subagents unless a concrete need is shown and approved. Use a fresh read-only subagent for the independent reviews required by `AGENTS.md`, giving it the brief, diff and SHA but not your own conclusions.
- Product architecture is frozen: `DROPSCOPE_FINAL_PROJECT_PLAN.md`, `docs/architecture/`, `docs/adr/`, and `docs/policies/` change only via a superseding ADR and user approval.
- "Terra", "Luna" and "Active Commander" in older development docs (for example `docs/design/DROPSCOPE_FRONTEND_DIRECTION.md`) mean the lead agent and workers; the gates they describe still apply.
- Record progress in `docs/development/PROGRESS.md`, not in `USAGE_LOG.md`.

## Environment

- Windows with the repo under OneDrive: avoid long-lived file locks (stop dev servers and Playwright runs when done).
- Playwright and Vite may need to run outside the default sandbox; ask the user before running outside the sandbox. If a test fails for an environmental reason (missing browser, sandbox, network), report that separately from a real regression.
- Project permissions live in `.claude/settings.json` (a minimal allow-list; push, PR, workflow and release commands are set to ask so each needs your approval; destructive commands are denied). Put personal overrides in `.claude/settings.local.json` (gitignored).
