# Review brief: ADR-028, round 2 (delta only)

Plain summary: round 1 rejected the draft ADR-028 (2 major, 1 minor). The author repaired the draft text only; no code and no settings changed. Please check the repair, not the whole topic again.

## Commit under review
Run `git rev-parse HEAD` first and report it; it must equal the SHA the user gives you, otherwise stop.

## Rules for you
Read-only. Do not edit, commit, push or change settings. Do not run `npm run forensics`. Do not open the saved-run locations. Do not trust the author's conclusions; check them.

## What changed since round 1 (commit `25cb543`)
Only `docs/adr/ADR-028-real-trace-admission-needs-a-real-boundary.md`, plus the PROGRESS entry for this round.

1. Round 1 major 1 (copies and indirect access): decision 2 now lists original trace inputs, the saved files at their actual resolved location (packaged-app redirection and per-account `%LOCALAPPDATA%`), every copy (sync, backups, downloads, exports, temporary files) and loaded replay content in a browser no agent can connect to. Decision 3 requires that the agents' side has no administrator rights, no backup or restore privilege and no shared folder, mount or sync exposing the data.
2. Round 1 major 2 (a failed read is not proof): decision 6 now requires a synthetic file at the real location, proof the data-side account can read it, each agent's real identity and every access route tried, the operating-system error recorded with evidence the boundary caused it, container configuration evidence for absent paths, and a repeat after changes.
3. Round 1 minor (overstated evidence): the summary now says the command we ran only printed a built path and that no read was tested.

## Questions
1. Is each of the three round 1 findings closed? Did the repair introduce a new gap or contradiction (for example between decisions 2, 3 and 6, or with ADR-027 and spec section 11 item 2)?
2. Is anything still overstated or hidden? Decision 4 says the current data is synthetic "as far as the author knows".
3. Is it still plain enough for a beginner?
4. Is the supersession still limited to the admission condition?

## Report format
Verdict (APPROVE or REJECT), findings as severity, what, how to reproduce, suggested fix; then what you could not check.
