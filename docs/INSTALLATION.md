# Install and Run DropScope Locally

> **Note.** This page describes the original mission replay. DropScope now centers on agent run forensics: start with the [README](../README.md) and the [guided tour](GUIDED_TOUR.md).

DropScope is a local-first learning project. These steps run the browser interface and its loopback mission runtime on your own computer; they do not deploy a service, contact Google, or start a worker.

## Prerequisites

- Node.js. The current local verification environment uses Node.js 24.13.1; the project does not yet declare a broader supported-version range.
- npm, installed with Node.js.

On Windows PowerShell, use `npm.cmd` as shown below.

## Install

From the repository root:

```powershell
npm.cmd install
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

The browser end-to-end suite is optional for a first look, but is the full local acceptance check:

```powershell
npm.cmd run test:e2e
```

## Start DropScope

Use two PowerShell windows from the repository root.

In the first window, start the browser interface:

```powershell
npm.cmd run dev
```

Open the local URL that Vite prints in that window (normally `http://localhost:5173`). In the second window, set `DROPSCOPE_TRUSTED_UI_ORIGIN` to that origin without its trailing slash if Vite selected a different port (for example, `$env:DROPSCOPE_TRUSTED_UI_ORIGIN = "http://localhost:5174"`), then start the local mission runtime:

```powershell
npm.cmd run runtime:dev
```

It listens only at `http://127.0.0.1:8787` and writes local mission histories under `.dropscope-data/`, which Git ignores. Choose a fixed fixture in the **Local runtime** control strip and select **Launch local mission**. The browser stores the active mission ID locally so **Reload saved mission** can restore it after a refresh.

The initial synthetic fallback is expected if you have not launched a local mission yet.

## Run the Evaluation Tables

The evaluator is separate from the browser runtime and uses temporary local histories only:

```powershell
npm.cmd run evaluate
```

It prints the fixed-mission baseline, task-capacity comparison, quality-versus-usage recommendation, and virtual role-based staffing experiment. The staffing rows are simulations, not real worker runs.

## Safety Boundaries

- The normal installation and startup flow starts no worker and makes no Google request.
- The browser runtime accepts only loopback requests at `127.0.0.1`.
- The normal fixed fixtures are deterministic local simulations. The separate live-worker pilot is deliberately guarded and is not needed for installation or evaluation.
- `.dropscope-data/` contains local mission histories. Do not delete it unless you intentionally want to discard those histories.

## Troubleshooting

- **“Local runtime is unavailable”** — start `npm.cmd run runtime:dev` in the second terminal and keep it running.
- **The page opens but shows synthetic fallback** — launch one of the fixed local fixtures from the runtime control strip.
- **“Reload saved mission” cannot restore a mission** — verify the runtime is still running and that browser local storage is available.
- **Vite chose a different browser port** — use Vite's **Local URL** (not its Network URL), set `DROPSCOPE_TRUSTED_UI_ORIGIN` to that slash-free origin, then restart `npm.cmd run runtime:dev`. The mission runtime remains on `127.0.0.1:8787`.
