# Public Release Readiness Checklist

This is a planning and verification checklist. It does not publish DropScope, change Git history, grant a license, or authorize a remote action.

## Completed Local Foundations

- [x] Secret and privacy audit completed; common local credential and key files are ignored.
- [x] Local installation instructions are available in [INSTALLATION.md](INSTALLATION.md).
- [x] The event-history architecture is described in [ARCHITECTURE_OVERVIEW.md](ARCHITECTURE_OVERVIEW.md).
- [x] Synthetic and guarded fixtures are cataloged in [SYNTHETIC_FIXTURES.md](SYNTHETIC_FIXTURES.md).
- [x] A safe first replay is documented in [FIRST_MISSION_REPLAY.md](FIRST_MISSION_REPLAY.md).
- [x] The [README](../README.md) and the [guided tour](GUIDED_TOUR.md) describe the agent run forensics direction, with its limits stated.
- [x] Independent reviews: two whole-project reviews of the run forensics part (Claude Opus 5.5 and Codex Sol 6.1, 2026-10-15) and two delta reviews of their fixes. The remaining known gaps are listed in `docs/development/PROGRESS.md` ("Open items").
- [x] Git history scanned on 2026-10-15 by pattern search over the added text lines of every commit (cloud and service keys, private keys, tokens, password assignments, emails, phone numbers, IP addresses, local user paths, risky file names, large files): no real secret or personal data found; every hit is an invented test value. Commit messages were checked separately for the same patterns and are clean, with one known item: six early documentation commits keep a `Claude-Session:` link to a private claude.ai development session in their message, and the owner decided to keep them. This was a pattern search, not an entropy-based scanner; GitHub's secret scanning is the second check once the repository is public.
- [x] The public repository contains the `main` history only. Its history was written fresh from the private archive with the author name and email of the owner's older commits replaced by the owner's name and GitHub noreply address. Six early documentation commits keep `Claude <noreply@anthropic.com>` as author and committer. The old repository (with its pull requests and branches) is kept private as an archive.

## Work Still Needed Before a Public Release

- [x] Add a [holdout-result document](HOLDOUT_RESULT.md) that clearly separates fixed evaluation output from real-world evidence.
- [x] Add [limitations and responsible-use guidance](LIMITATIONS_AND_RESPONSIBLE_USE.md): DropScope is a local learning project, not commercial advice, an ecommerce automation system, or an unattended research bot.
- [x] Add the [MIT License](../LICENSE) with the owner-approved copyright-holder line.
- [x] Owner approved the author identity for the public repository: "Alejandro Renalias" with the GitHub noreply address, as in the rewritten history.

## Final User-Controlled Release Gate

Before any remote publication, the repository owner should explicitly approve:

1. The intended public repository and visibility.
2. The license and responsible-use wording.
3. The author-identity decision above.
4. The exact commit SHA to share.

Do not use `git add -A` or `git add .`. Stage only named, intended files after reviewing `git status --short` and the exact diff.

## Local Pre-Share Verification

Run these commands only after the intended release commit is prepared. They remain local checks and do not start a worker or make a Google request.

```powershell
git status --short
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run test:e2e
git diff --check
```

Review the changed-file list and test output on the exact candidate SHA. A passing local check is evidence for that SHA only; it is not permission to push, create a pull request, merge, or publish.

## Safe Scope for a Public Description

Describe DropScope as a local, offline learning project for auditing recorded AI agent runs: it imports a trace, rebuilds the recorded state at any step, re-applies a budget, checks claims against recorded content and compares two runs, and it also contains an older replayable research-workflow simulator built on deterministic fixtures. State clearly that: it is a learning project and not a product; it runs on Windows only; all demo data is invented and no real production trace has been analyzed; "supported" means "appears in the recording", not "true"; fixtures are not market findings and no profitability is promised; real traces are deliberately excluded ([ADR-028](adr/ADR-028-real-trace-admission-needs-a-real-boundary.md)); and separately guarded external boundaries require explicit user action and approval.
