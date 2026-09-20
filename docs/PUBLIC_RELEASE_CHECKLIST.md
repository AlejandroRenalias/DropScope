# Public Release Readiness Checklist

This is a planning and verification checklist. It does not publish DropScope, change Git history, grant a license, or authorize a remote action.

## Completed Local Foundations

- [x] Secret and privacy audit completed; common local credential and key files are ignored.
- [x] Local installation instructions are available in [INSTALLATION.md](INSTALLATION.md).
- [x] The event-history architecture is described in [ARCHITECTURE_OVERVIEW.md](ARCHITECTURE_OVERVIEW.md).
- [x] Synthetic and guarded fixtures are cataloged in [SYNTHETIC_FIXTURES.md](SYNTHETIC_FIXTURES.md).
- [x] A safe first replay is documented in [FIRST_MISSION_REPLAY.md](FIRST_MISSION_REPLAY.md).

## Work Still Needed Before a Public Release

- [ ] Add a holdout-result document that clearly separates fixed evaluation output from real-world evidence.
- [ ] Add limitations and responsible-use guidance: DropScope is a local learning project, not commercial advice, an ecommerce automation system, or an unattended research bot.
- [ ] Choose and add an open-source license. Until then, do not imply that the repository is licensed for reuse.
- [ ] Decide whether the reachable Git author identity is acceptable to make public. The privacy audit found a non-placeholder author identity in reachable history. Leave history unchanged unless the repository owner explicitly chooses a separate, carefully reviewed rewrite plan.

## Final User-Controlled Release Gate

Before any remote publication, the repository owner should explicitly approve:

1. The intended public repository and visibility.
2. The license and responsible-use wording.
3. The author-identity decision above.
4. The exact commit SHA to share.

Do not use `git add -A` in this currently dirty working tree. Stage only named, intended release files after reviewing `git status --short` and the exact diff.

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

Describe DropScope as a local event-sourced research-command-center learning project with deterministic fixtures and replayable reports. State clearly that fixtures are not market findings, no profitability is promised, and separately guarded external boundaries require explicit user action and approval.
