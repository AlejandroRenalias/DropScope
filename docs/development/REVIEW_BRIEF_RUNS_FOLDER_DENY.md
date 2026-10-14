# Review brief: deny development-agent reads of the saved runs folder

Plain summary: DropScope saves imported agent runs in a folder (`%LOCALAPPDATA%\DropScope\runs`). Those files may hold real, private traces. ADR-027 decision 9 says real traces are admitted only after a rule stops development agents (Claude Code, Codex) from reading that folder. This change adds that rule to `.claude/settings.json`. It is an agent-permission change, so `AGENTS.md` requires an independent read-only review.

## Commit under review

Run `git rev-parse HEAD` first and report it. It must equal the SHA the user gives you. If it differs, stop.

## Rules for you

- Read-only: do not edit files, commit, push or change settings. Do not run `npm run forensics`. Do not open anything under `%LOCALAPPDATA%\DropScope`.
- Do not trust the author's conclusions below; check each claim.

## What changed (one file, `.claude/settings.json`)

Added to `deny`:

- `Read(~/AppData/Local/DropScope/**)`
- `Read(~/AppData/Local/Packages/*/LocalCache/Local/DropScope/**)` (the Claude desktop app is packaged and redirects `%LOCALAPPDATA%` to this private copy; on this machine the real folder is `...\Packages\Claude_<id>\LocalCache\Local\DropScope`)
- `Bash(*DropScope*runs*)` and `PowerShell(*DropScope*runs*)` (text patterns: any shell command naming the folder)

Added to `ask`: `Bash(npm run forensics*)` and `PowerShell(npm run forensics*)`, because the command-line tool reads the default runs folder and prints its contents.

## Questions to answer

1. Does each pattern use correct Claude Code permission syntax (`~`, `*` and `**`, case, Windows slashes)? Check against the official documentation, not memory.
2. Gaps: ways a development agent could still read the folder or its files. Think of: another path spelling (8.3 short names, `%LOCALAPPDATA%`, `$env:LOCALAPPDATA`, a drive-letter path, a UNC or `\\?\` path), a symbolic link or junction into the folder, `cd` into the folder then a relative path, commands that do not contain the words `DropScope` and `runs` (for example `Get-ChildItem Env:`-built paths, wildcards like `Drop*`), the Grep and Glob tools, `git` commands, and the `npm run forensics` command with a run file argument.
3. Over-blocking: does any rule block normal development (tests, docs, source files, branch names containing the words)? A command line that merely mentions "DropScope" and "runs" (for example a commit message or a docs search) would be denied; judge whether this is acceptable.
4. Limits that the documentation should state honestly: deny rules for the file tools are not an operating-system sandbox, and text patterns for shell commands are best effort.
5. Does `ask` for `npm run forensics*` conflict with the existing allow list?
6. Does the rule satisfy ADR-027 decision 9 and `docs/schemas/run-event-contract-v1.md` section 11, item 2? What would you still require before real traces are admitted?

## Evidence from the author

After the edit, in the same Claude Code session, a Read of a file under the Packages path and a Glob of `%LOCALAPPDATA%\DropScope\runs` were both refused, and a `ls` of the Packages folder through Bash was refused. Nothing was tested for Codex (this file is Claude Code configuration only).

## Report format

Verdict (APPROVE or REJECT), then findings as: severity (major or minor), what, how to reproduce, suggested fix. Then anything you could not check.
