# DropScope

DropScope is a local, offline tool for looking back at a recorded AI agent run. You give it a trace that an agent run left behind, and it can show you what the run had recorded at any step, whether a spending limit would have stopped it, whether a claim is backed by what the run captured, and where two runs first differ.

None of these features makes a model call or a network request. Everything is computed from a file on your computer, in the same way every time, so someone else can check your answer.

> **Status.** DropScope is a software-engineering **learning project**, not a product. It runs on Windows only for now (the importer refuses other systems). Every run shown in this repository is invented demo data. Real traces are deliberately kept out until a real access boundary exists: see [ADR-028](docs/adr/ADR-028-real-trace-admission-needs-a-real-boundary.md). There is no release, package or hosted service.

## A small example

A support agent is asked to refund order 1042. It looks up the order, reads the refund policy, writes a draft, tries to issue the refund (the first attempt times out), tries again (it works), has a second agent review the draft, and writes the final answer. The run is saved as a trace.

With DropScope you can ask:

- **What did the run have recorded at step 24?** Two steps were still running, and one earlier step had failed.
- **Would a 4,000-token limit have stopped it?** Yes: a guard checking after each call would have fired at event 31, before the last model call.
- **Is "the refund was accepted" backed by the recording?** Yes: the text "accepted" appears in the recorded result of the second refund attempt.
- **Is "the order had been delivered" backed by the recording?** No: the recorded order result does not contain that text.
- **How does this run differ from a second run?** In the second run the refund fails both times, so the runs first differ at the second refund attempt.

## What it does

| Feature | The question it answers | Command line | On screen |
| --- | --- | --- | --- |
| **Import** | Turn an OpenTelemetry GenAI trace (OTLP/JSON) into a saved, validated run file. | `import` | (command only) |
| **State at a step** | What had the run recorded by step N? | `state --at N` | Scrub the timeline |
| **Budget replay** | Where would a spending limit you choose have stopped this run? | `budget` | Budget replay card |
| **Claim check** | Is each claim you wrote backed by what the run recorded? | `claims` | Claim check card |
| **Run diff** | Where do two runs first differ? | `diff` | Compare with another run card |

The screens are on the **Replay** page: open it, then choose **Imported agent run**.

## Try it in five minutes

You need Node.js 24 and npm. From the repository root:

```bash
npm install
npm run dev
```

Open the address Vite prints (normally `http://localhost:5173`), choose **Mission Replay** in the top bar, then **Imported agent run**. A demo run loads at once. For a step-by-step walkthrough with exact buttons and commands, see the [guided tour](docs/GUIDED_TOUR.md).

You can also use the command line on the demo files that come with the repository:

```bash
npm run forensics -- state src/frontend/assets/demo-run.runlog.jsonl --at 24
npm run forensics -- budget src/frontend/assets/demo-run.runlog.jsonl --max-total-tokens 4000
npm run forensics -- diff src/frontend/assets/demo-run-full.runlog.jsonl src/frontend/assets/demo-run-variant.runlog.jsonl
```

On Windows PowerShell, `npm.cmd` works in place of `npm` if script policies get in the way.

## What the answers do and do not mean

DropScope is careful about what it claims. These limits are part of the design, not fine print.

- **It shows what was recorded, not what the model knew.** The state at a step is rebuilt from the trace. It is never the model's hidden context. If the trace has no prompts or tool results, DropScope says so instead of guessing.
- **"Supported" means "appears in the recording", never "true".** The same words can mean something else in context ("accepted" also appears in "not accepted"). The claim check only looks for the exact texts you list, in the content one step recorded. It never uses a model to judge.
- **Budget replay is a what-if.** DropScope never controls an agent. It re-applies the limits you typed to numbers the trace recorded. A real guard cannot know a call's cost before the call runs, so the replay says "would have stopped" and lists what was already running.
- **A difference means the recordings differ, not that either run is right.** Steps are matched by what they are (kind, operation, model, tool or agent name) in order, not by their ids. How long each step took is not treated as a difference, because two honest runs never take exactly as long.
- **By default a run file keeps no prompts or answers.** It keeps sizes and fingerprints (SHA-256) only. The claim check needs a run imported with `--full`, which keeps the content. Run files stay on your computer: do not share or commit them.
- **The demos are invented.** The demo order, customer text and numbers are made up. They show how the tool behaves, not how any real agent behaves.

## Where files go, and what runs on your computer

- Run files are saved to `%LOCALAPPDATA%\DropScope\runs`, outside the repository. The importer creates that folder so that only your account can open it, and it stops if it cannot check that.
- To do that on Windows, the importer calls two built-in Windows tools (PowerShell and `icacls`) to read file properties and set folder permissions. Nothing else is started and nothing touches the network.
- The browser screen reads a run file with a file picker, inside the browser. Nothing is uploaded.
- Please keep real agent traces out until the boundary in [ADR-028](docs/adr/ADR-028-real-trace-admission-needs-a-real-boundary.md) exists. The repository's Claude Code settings deny reading the runs folder, but that is only a precaution: it can be bypassed and it does not cover other tools, so it cannot be a real boundary on its own.

## The original mission replay

Before it turned to agent run forensics, DropScope was a replayable research-workflow simulator with a dropshipping research demo. That part still works (the **Research Office**, **Tribunal Room**, **Review Office**, **Final Report** and **Mission Replay** screens, with its **Mission history** source). It uses fixed synthetic missions. Its normal flow starts no worker and makes no network request; two guarded pilots exist that act only when you ask them to (see the install guide). Its older guides are [Install and run](docs/INSTALLATION.md), [First mission replay](docs/FIRST_MISSION_REPLAY.md), [Architecture overview](docs/ARCHITECTURE_OVERVIEW.md) and [Synthetic fixtures](docs/SYNTHETIC_FIXTURES.md).

## Checking the project

```bash
npm run typecheck   # types
npm test            # unit tests
npm run build       # production build
npm run test:e2e    # browser tests (needs Chrome; Windows picture baselines)
```

Risky changes in this project (saved files, budget arithmetic, state rebuilding, anything reading untrusted input) are reviewed by an independent reviewer before they are merged. The review reports and the build log are in [docs/development](docs/development): start with [PROGRESS.md](docs/development/PROGRESS.md).

## Where to read more

- [Guided tour](docs/GUIDED_TOUR.md): ten minutes with the demos.
- [Proposal for agent run forensics](docs/development/PROPOSAL_AGENT_RUN_FORENSICS.md) and the [roadmap](docs/development/ROADMAP.md): what it is for and how it was planned.
- [Run event contract](docs/schemas/run-event-contract-v1.md) and [ADR-027](docs/adr/ADR-027-run-event-contract-and-trace-import-boundary.md): how a run file is built and checked.
- [Limitations and responsible use](docs/LIMITATIONS_AND_RESPONSIBLE_USE.md).

## License

MIT. See [LICENSE](LICENSE).
