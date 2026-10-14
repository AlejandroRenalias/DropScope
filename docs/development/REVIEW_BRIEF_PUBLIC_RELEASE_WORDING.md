# Independent review brief: public release wording

**For the user (plain words).** Before the repository goes public, two publication documents were rewritten for the agent run forensics direction. `AGENTS.md` requires an independent read-only review for changes to publication rules. This brief asks a fresh reviewer one thing: is anything in these documents false, overstated or risky to say in public?

## 1. Target

- Repository `AlejandroRenalias/DropScope` (the new private repository), branch `docs/public-release-wording`.
- Review `git diff main docs/public-release-wording`, which touches `docs/LIMITATIONS_AND_RESPONSIBLE_USE.md`, `docs/PUBLIC_RELEASE_CHECKLIST.md` and this brief. Run `git log --oneline -3` first.
- **Read-only.** Do not edit, commit or push in the repository. Do not run `import` or open `%LOCALAPPDATA%\DropScope`.
- Treat the documents as claims to verify against the code, the tests and the other documents. Demo data only (ADR-028).

## 2. Questions

1. **Is every statement true?** Check each factual sentence in the two documents against `README.md`, `docs/GUIDED_TOUR.md`, ADR-027, ADR-028, the code and `docs/development/PROGRESS.md`. Examples: where run files are saved; what the default mode keeps; what `--full` keeps; Windows only; "no network and no model calls" and who enforces it; the tools the importer starts; what "supported", "budget replay" and "differ" mean; what has and has not been tested; the history scan and what it covers.
2. **Is anything overstated or missing?** Anything a public reader could rely on wrongly (audit, compliance, security, "safe", "private", "tamper-proof", "deterministic" without limits), or a risk or limit that the README states but these documents leave out.
3. **Is anything risky to publish?** Names, emails, paths, internal process details, or claims about people or organizations that should not be public. The author identity is deliberately the owner's name and GitHub noreply address.
4. **Do links resolve?** Every relative link in the two documents.

Out of scope: the code, the ADR text and the mission replay documents.

## 3. Report format

1. **Verdict:** `APPROVE`, `APPROVE WITH CHANGES` or `REJECT`, one paragraph.
2. **Findings**, most severe first, at most 10: severity (`high`, `medium`, `low`), file and line, the statement, what is actually true or risky, **verified** or **suspected**, suggested wording.
3. **What you could not check.**

No praise, no summary, no style changes.

## 4. Prompt

> You are an independent read-only reviewer. In this repository, first run `git log --oneline -3` and confirm the branch is `docs/public-release-wording`. Then read `docs/development/REVIEW_BRIEF_PUBLIC_RELEASE_WORDING.md` and review the change as it describes. Do not edit the repository (a temporary copy outside it is allowed), commit or push anything, and do not run import or open `%LOCALAPPDATA%\DropScope`. Answer in the report format of section 3.
