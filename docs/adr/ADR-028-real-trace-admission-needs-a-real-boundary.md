# ADR-028: Real traces need a real access boundary, not only a settings rule

**Status:** DRAFT, not accepted. Needs the user's approval and an independent read-only review (`AGENTS.md`: frozen architecture, security, agent permissions).  
**Date:** 2026-10-14  
**Supersedes:** the admission condition in ADR-027 decision 9 (and `docs/schemas/run-event-contract-v1.md` section 11, item 2) only. Everything else in ADR-027 stands.

## Plain-language summary

DropScope saves imported agent runs in a folder on this computer. Real runs may contain private text. ADR-027 said real runs may be admitted once a rule stops development agents (Claude Code, Codex) from reading that folder. We wrote that rule in `.claude/settings.json`, and an independent review (Codex, 2026-10-14) showed it cannot be enough by itself:

- The rule is a list of words and paths the agent tool checks. A script can build the folder name from pieces (for example `'Drop'+'Scope'`) and the check never sees the words. Example: asking the agent to run a short Node script that joins `Drop` and `Scope` reads the folder without matching any rule. We reproduced this.
- The rule only configures Claude Code. Codex and any other agent have their own settings.

So the decision: keep the rule as an extra precaution, but do not call it protection. Real traces stay out until a real boundary exists, meaning something the operating system enforces, not something an agent tool chooses to honor.

## Decision

1. **Keep** the `.claude/settings.json` rule (file-read denies for the runs folder, shell-text denies, and an approval prompt for `npm run forensics`). It stops accidental reads and ordinary tool use. It is documented as best effort, never as isolation.
2. **Real traces are not admitted** into the default runs folder, or anywhere a development agent works, until one of these boundaries is in place, independently reviewed, tested with a harmless synthetic file, and approved by the user:
   - a **separate Windows user account** (or equivalent operating-system access control) that owns the runs folder, with the account that runs development agents given no access; or
   - development agents running inside an **isolated environment** (virtual machine or container) that does not contain the folder.
   Import and replay of real traces then happen in the restricted account or environment only.
3. **Until then, only synthetic and demo traces** are used (the two built-in demo runs, test fixtures, spike data). This is the situation today.
4. **Every agent counts.** The boundary must hold for Claude Code, Codex and any other development agent, including their shell and child processes. A rule that configures one agent does not satisfy this.
5. **Acceptance test for the boundary:** from each development agent, ask for a read of a harmless synthetic file placed in the protected folder, by file tool and by shell command including a computed path. All attempts must fail.

## Consequences

The product keeps working with synthetic data. Real-trace use waits for a one-time setup (a second Windows account is the cheapest option). The settings rule is cheap to keep and sometimes prevents accidents, but the project must never rely on it for privacy. If the user decides real traces are never needed (DropScope is a learning project), the gate simply stays closed and nothing else is needed.

## Alternatives considered

- **Treat the settings rule as sufficient:** rejected, reproduced bypass, and it ignores Codex.
- **Claude Code's sandbox setting:** the review found native Windows has no built-in shell sandbox, so it does not give this boundary.
- **Drop the rule:** rejected, it is cheap and blocks the accidental cases.
- **Per-agent rules for each tool:** useful extra layers but each can be bypassed the same way; not a boundary.

## Follow-ups if approved

- Correct ADR-027 decision 9 and spec section 11 item 2 to point here.
- Note in `HANDOFF_NEXT_SESSION.md` that the open item is now the real boundary, not the settings rule.
