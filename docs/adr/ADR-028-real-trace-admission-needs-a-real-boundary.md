# ADR-028: Real traces need a real access boundary, not only a settings rule

**Status:** Accepted by the user on 2026-10-14, after independent read-only review (Codex, two rounds; the second approved commit `43a6f0c`). The pointer edits in ADR-027 and the spec are one-sentence cross-references.  
**Date:** 2026-10-14  
**Supersedes:** the admission condition in ADR-027 decision 9 (and `docs/schemas/run-event-contract-v1.md` section 11, item 2) only. Everything else in ADR-027 stands.

## Plain-language summary

DropScope saves imported agent runs in a folder on this computer. Real runs may contain private text. ADR-027 said real runs may be admitted once a rule stops development agents (Claude Code, Codex) from reading that folder. We wrote that rule in `.claude/settings.json`, and an independent review (Codex, 2026-10-14) showed it cannot be enough by itself:

- The rule is a list of words and paths that the agent tool checks. A command can build the folder name from pieces (for example `'Drop'+'Scope'`) and the check never sees the words. Evidence: the reviewer's documented example, and one command we ran that built the folder path from pieces and was not blocked. That command only printed the path. No folder or file read was tested, so this shows a gap in the check, not an actual leak.
- The rule only configures Claude Code. Codex and any other agent have their own settings.

So the decision: keep the rule, but call it what it is: it prevents some accidental reads, nothing more. Real traces stay out until a real boundary exists, meaning something the operating system enforces, not something an agent tool chooses to honor.

## Decision

1. **Keep** the `.claude/settings.json` rule (file-read denies for the saved folder, shell-text denies, and an approval prompt for `npm run forensics`). It prevents some accidental reads. It is documented as best effort, never as isolation.
2. **Real traces are not admitted** until a boundary is in place, independently reviewed, tested (decision 6) and approved by the user. The boundary must protect **every place the trace data can exist**, not only the saved folder:
   - the original trace inputs (OTLP/JSON span and log files) before import;
   - the saved run files, at their **actual resolved location**. The packaged Claude app redirects `%LOCALAPPDATA%` to a private copy under `Packages`, and each Windows account has its own `%LOCALAPPDATA%`; the setup record must name the real path;
   - every copy: OneDrive or other sync copies, backups, downloads, exports, temporary files;
   - loaded content: the replay screen reads the chosen file into browser memory, so it must run in a browser and session that no development agent can connect to (no browser extension, remote debugging, helper or preview tool shared with an agent).
3. **The boundary must be one the agents cannot override.** Accepted forms: a **separate Windows user account** that owns the data, or an **isolated environment** (virtual machine or container) that does not contain it. In both, the account or environment that runs development agents has **no administrator rights and no backup or restore privilege** (these can bypass file permissions), and no shared folder, mount or sync that exposes the data (a read-only share still allows reads).
4. **Until then, only synthetic and demo traces** are used (the two built-in demo runs, test fixtures, spike data). This is the situation today, as far as the author knows; the reviewers could not check it.
5. **Every agent counts**, including shell and child processes: Claude Code, Codex and any other. The boundary must hold for each of them.
6. **Acceptance test, and why a failure counts.** A failed read proves nothing by itself (a wrong path, a missing file, a refusal by the tool or a declined approval prompt all fail too). So:
   1. Put a synthetic file with known contents at the actual resolved storage location, and at every other location from decision 2 that applies.
   2. First show that the data-side account reads it successfully.
   3. Then, from each agent's real execution identity, try every access route it has (file tools, shell, a computed path, a browser or helper connection) and record the operating-system error for each (for example access denied), with evidence that the boundary caused it, not a typo or a prompt. An absent or unreachable container path needs the container configuration as evidence, not just a failed read.
   4. Repeat after any change to accounts, tools, shared folders, sync, backups or storage locations.

## Consequences

The product keeps working with synthetic data. Real-trace use waits for a one-time setup (a second Windows account is the cheapest option) and a written setup record. The settings rule is cheap to keep and sometimes prevents accidents, but the project must never rely on it for privacy. If the user decides real traces are never needed (DropScope is a learning project), the gate simply stays closed and nothing else is needed.

## Alternatives considered

- **Treat the settings rule as sufficient:** rejected. The check can be bypassed by building the path, and it ignores Codex.
- **Claude Code's sandbox setting:** the review found native Windows has no built-in shell sandbox, so it does not give this boundary.
- **Drop the rule:** rejected, it is cheap and blocks some accidental cases.
- **Per-agent rules for each tool:** useful extra layers but each can be bypassed the same way; not a boundary.

## Follow-ups if approved

- Correct ADR-027 decision 9 and spec section 11 item 2 to point here.
- Note in `HANDOFF_NEXT_SESSION.md` that the open item is now the real boundary, not the settings rule.
