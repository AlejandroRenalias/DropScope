# Review brief: ADR-028 (real traces need a real access boundary)

Plain summary: round 1 of the runs-folder rule was rejected because a settings rule cannot stop an agent reading a folder (a script can build the path) and does not cover Codex. ADR-028 is a draft that keeps the rule as a precaution and keeps real traces out until an operating-system boundary exists. Please review the draft.

## Commit under review
Run `git rev-parse HEAD` first and report it; it must equal the SHA the user gives you, otherwise stop.

## Rules for you
Read-only. Do not edit, commit, push or change settings. Do not run `npm run forensics`. Do not open anything under `%LOCALAPPDATA%\DropScope`. Do not trust the author's conclusions; check them.

## Scope
`docs/adr/ADR-028-real-trace-admission-needs-a-real-boundary.md`, the PROGRESS entries "Runs folder read rule" and "Review record: runs folder read rule, round 1", and consistency with ADR-027 decision 9 and `docs/schemas/run-event-contract-v1.md` section 11 item 2. The settings rule itself was reviewed in round 1 and is unchanged.

## Questions
1. Does ADR-028 close the gap your round 1 found, or does it still allow real traces in by accident? Is "separate Windows account or isolated environment" a sufficient boundary, and is anything missing (for example the OneDrive sync, backups, the packaged-app path redirection, the browser replay screen reading files)?
2. Is the acceptance test (synthetic file, file tool and shell with a computed path, every agent) adequate?
3. Does ADR-028 supersede only what it says, with no hidden change to other ADR-027 decisions?
4. Is any claim overstated or any limit hidden? Is the wording plain enough for a beginner?
5. Does the PROGRESS record state your round 1 findings honestly?

## Report format
Verdict (APPROVE or REJECT), findings as severity, what, how to reproduce, suggested fix; then what you could not check.
