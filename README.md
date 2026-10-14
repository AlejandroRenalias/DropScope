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

DropScope reports what a recording says. It cannot see inside the agent, and it never guesses. Five things to keep in mind:

1. **It shows the recording, not the agent's mind.** "State at step 24" means "what the trace had written down by step 24". If the trace never recorded the prompts, DropScope says "not recorded" instead of filling the gap.
2. **"Supported" means the words are in the recording. It does not mean the claim is true.** Example: the claim "the refund was accepted" is supported if the recording contains the word "accepted". But "not accepted" contains it too.
3. **Budget replay is a "what if".** DropScope does not control any agent. It takes the limit you type and checks it against the numbers the run recorded. A real guard cannot know what a model call will cost until the call has finished, so the answer says "would have stopped here" and lists what was already running.
4. **"Differ" means the two recordings are not the same. It does not say which one is right.** How long each step took is ignored, because two honest runs never take exactly the same time.
5. **By default a saved run keeps no prompts or answers.** It keeps only their size and a fingerprint (a short code worked out from the text, so two texts can be compared without keeping either). The claim check needs the text, so import with `--full` for it. Run files stay on your computer: do not share or commit them. The demo runs here are invented.

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
