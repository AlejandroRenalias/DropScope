# Contributing

Thank you for looking at DropScope. Small, focused changes are the easiest to review.

## Set up

You need Node.js 22.12 or newer (CI uses 24) and npm.

```bash
npm install          # also builds the dropscope command
npm test             # unit tests
npm run typecheck
npm run lint         # Biome
npm run format       # Biome, rewrites files; `npm run format:check` only reports
npm run build        # production build of the web app
npm run test:e2e     # browser tests, needs Chrome installed
```

Before you open a pull request, run `npm test`, `npm run typecheck`, `npm run lint` and `npm run format:check`. CI runs the tests, the type check and the build on Windows, macOS and Linux. It runs the browser tests and the lint and format checks on Linux.

## Browser tests and pictures

`npm run test:e2e` drives Chrome. A few tests compare screenshots with baselines stored in `e2e/*-snapshots`. The baselines were recorded on Windows, so those comparisons run only there. On Linux, CI sets `DROPSCOPE_SKIP_PICTURES=1` and `DROPSCOPE_BUNDLED_BROWSER=1` to run every other check with the browser that Playwright installs. You can use the same two variables locally.

If you change how the screen looks, say so in the pull request and include before and after screenshots. Updating a baseline needs a Windows machine; mention it if you cannot.

## Where things are

- `src/` has the importer, the run file reader, the checks and the web app. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains the path from a trace file to the screens.
- `test/` has unit tests. `test/fixtures/` has synthetic data only.
- `docs/schemas/run-event-contract-v1.md` is the contract for run files. A change to what a valid run file is needs a new contract version, a note in `docs/adr/`, and a version bump in the importer.

## Rules for code and data

- Keep behavior and formatting changes in separate commits. Formatting is done by Biome; do not reformat by hand.
- Never put real traces, prompts, keys or personal data in a test, a fixture or an issue. Write a small synthetic file instead. Look at `test/fixtures/exporters/` for examples.
- The default import keeps no prompt or answer text. A change must not weaken that, and a test should show it.
- Output of the command line never repeats input text. It prints fixed words, counts, ids and escaped paths.
- Add or change a test with every behavior change. Tests name the rule they pin.

## Pull requests

- One topic per pull request, based on the latest `main`.
- Explain what changed and why in plain words, and what a reviewer should look at.
- Add a line to the Unreleased section of [CHANGELOG.md](CHANGELOG.md) when a user would notice the change.

## Reporting problems

Use the issue forms. For a trace that does not import, describe the emitter and its version and share only a synthetic or fully redacted example. For a security problem, do not open a public issue: use GitHub's private vulnerability reporting if it is enabled for this repository, or contact the maintainer through their GitHub profile.
