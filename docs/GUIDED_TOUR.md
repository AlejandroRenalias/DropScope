# Guided tour: ten minutes with the demo runs

This tour uses only the demo files that come with the repository. Every run in it is invented: the order, the customer text and the numbers are made up, so nothing here is private and nothing here says anything about a real agent.

Every command below was run to write this page, and the output shown is what it printed. Output can differ slightly if the code changes; if it does, trust the program, not this page.

## The story behind the demo

A support agent is asked to refund order 1042. It plans, looks up the order, searches the refund policy, drafts a reply, tries to issue the refund (the first attempt times out), tries again (it works), asks a second agent to review the draft, and writes a final answer. That is 10 steps and 42 recorded events.

## Before you start

You need Node.js 24 and npm. From the repository root:

```bash
npm install
npm run dev
```

Open the address Vite prints (normally `http://localhost:5173`). In the top bar choose **Mission Replay**, then **Imported agent run**. The built-in demo run loads. Leave this page open; each step below says where to click.

The commands use these demo files:

| File | What it is |
| --- | --- |
| `src/frontend/assets/demo-run.runlog.jsonl` | The demo run, kept the default way: sizes and fingerprints only, no content. |
| `src/frontend/assets/demo-run-full.runlog.jsonl` | The same run with its content stored. |
| `src/frontend/assets/demo-run-variant.runlog.jsonl` | A different run: the second refund attempt also times out. Content stored. |
| `test/fixtures/demo-run-trace.json` | The source trace the first two were made from. |

## Step 1: import a trace (command only)

A trace is what an agent run leaves behind (OTLP/JSON, the OpenTelemetry GenAI format). Importing turns it into a saved run file that DropScope can trust.

```bash
npm run forensics -- import test/fixtures/demo-run-trace.json
```

```text
Imported run 5b8efff798038103d269b633813fc60c
  file: C:\Users\<you>\AppData\Local\DropScope\runs\5b8efff798038103d269b633813fc60c-2de3b8969172f5ad.runlog.jsonl
  content mode: HASH_ONLY
  events: 42  steps: 10  logs: 0  errors: 1
  tokens: input 5530, output 785
  notes: SECRET_PATTERN_COUNT x1
```

What to notice:

- **content mode: HASH_ONLY** means the saved file keeps only the size and a fingerprint of every prompt and answer, not the text.
- **notes: SECRET_PATTERN_COUNT x1** means the importer spotted one secret-like piece of text (an invented email address in a prompt) and did not keep it. The importer itemizes most things it drops or cannot map in notes. One known gap: a resource or scope group in the trace that holds no spans (and no logs) is left out without a note.
- Run the same command again and it says `Already imported run ...`: the same trace always gives the same file, and the file is never overwritten.
- Add `--full` to keep the content. You need that for the claim check in step 4.
- The file is saved outside the repository. Run files stay on your computer: do not share them and do not commit them.

## Step 2: the state at any step

**On screen.** On the **Imported agent run** view, drag the timeline to event 22 (or use the arrow keys on it). The event card says **Step failed**: the first refund attempt ended with an error after 500 ms. The "Steps at this event" tree shows which steps are running, finished or failed at that moment, and the token counts so far.

**On the command line.**

```bash
npm run forensics -- state src/frontend/assets/demo-run.runlog.jsonl --at 24
```

It prints the recorded state at event 24 of 42 as JSON. The parts that matter:

```text
"event": "StepStarted"
"openStepIds":   2 steps still running (the support agent and the second refund attempt)
"closedStepIds": 5 steps finished
"errorStepIds":  1 step failed (the first refund attempt)
"inputTokens": "1800", "outputTokens": "395"
```

Remember what this is. It is the state **as recorded in the trace**, in a derived order (steps are ordered by their recorded times). It is never what the model knew.

## Step 3: would a spending limit have stopped it?

**On screen.** Scroll to the **Budget replay** card and press **Try an example (4,000 tokens)**.

**On the command line.**

```bash
npm run forensics -- budget src/frontend/assets/demo-run.runlog.jsonl --max-total-tokens 4000
```

```text
Result: a guard with these limits would have fired at event 31 of 42.
  After Model call: chat sim-model-1 finished, the run had used 4,065 tokens, over your limit of 4,000 tokens. A guard that checks after each call would have stopped the agent here.
Would not have happened:
  1 step would never have started (1 model call, 0 tool calls):
  Model call: chat sim-model-1 (started at event 35)
  2 steps were already running and could not have been recalled:
  Agent: support-agent (started at event 2)
  Agent: qa-reviewer (started at event 28)
```

This is a what-if. DropScope never controls an agent; it re-applies your limits to the numbers the trace recorded. A real guard cannot know a call's cost before the call runs, so the replay checks after each call and tells you which steps were already running and could not have been recalled. Try other limits: `--max-seconds 5`, `--max-model-calls 3`, `--max-steps 6`, or several at once.

## Step 4: is a claim backed by the recording?

This needs a run that kept its content. **On screen:** above the replay press **Demo run with content stored**, then in the **Claim check** card press **Try an example (3 claims)**.

**On the command line.** Save this as `claims.json` anywhere:

```json
{
  "claims": [
    { "id": "order-total", "text": "The order total was 59.00", "tool": "lookup_order", "mustContain": ["59.0"] },
    { "id": "refund-accepted", "text": "The refund was accepted", "tool": "issue_refund", "mustContain": ["accepted"] },
    { "id": "order-delivered", "text": "The order had been delivered", "tool": "lookup_order", "mustContain": ["\"delivered\":true"] }
  ]
}
```

```bash
npm run forensics -- claims src/frontend/assets/demo-run-full.runlog.jsonl --claims claims.json
```

```text
Result: 2 supported, 1 not supported, 0 cannot be checked (of 3).

[Supported] order-total: The order total was 59.00
[Supported] refund-accepted: The refund was accepted
  The text you listed appears in the recorded result of Tool call: issue_refund (2 steps matched; this is the first that supports it), recorded at event 27.
[Not supported] order-delivered: The order had been delivered
  The recorded result of Tool call: lookup_order was read, but this text does not appear in it: "\"delivered\":true".
```

Two things to notice:

- **"Supported" only means the words appear in what was recorded.** It does not prove the claim is true. The same words can appear in "not accepted".
- Run the same command on `demo-run.runlog.jsonl` (the run that kept no content) and all three claims say **Cannot check**: the file only has sizes and fingerprints. DropScope says so instead of guessing.

## Step 5: where do two runs first differ?

**On screen.** Back on the Replay view, find the **Compare with another run** card (run A is the run open above). Press **Compare with the demo variant**. You get a verdict, a side-by-side list of steps with the first difference marked, a "Go to event" button that moves the replay above to that moment, and a totals table.

**On the command line.**

```bash
npm run forensics -- diff src/frontend/assets/demo-run-full.runlog.jsonl src/frontend/assets/demo-run-variant.runlog.jsonl
```

```text
Result: the runs first differ at step 7 of the aligned list.
  Look at: run A event 24, run B event 24 (use the state command with --at to see each run there).
  Steps in both and unchanged: 8; changed: 2; only in A: 0; only in B: 0.
Differences:
  "Tool call: issue_refund" is in both runs, but it succeeded in run A but failed in run B; ...
  "Model call: chat sim-model-1" is in both runs, but input tokens: 2010 in run A, 2190 in run B; ...
Totals:
  Failed steps: 1 in run A, 2 in run B
  Input tokens: 5,530 in run A, 5,710 in run B
```

Now press **Compare with the demo run kept with content** instead: it says the runs match step for step, even though one file kept its content and the other kept only fingerprints. That works because both are compared by fingerprint.

Steps are matched by what they are (kind, operation, model, tool or agent name) in order, never by id, because ids differ between runs. A difference means the recordings differ in what is compared (not the span names, ok-versus-unset status, links or time; the command lists these under "Not compared"). It does not mean either run is right.

## Where to go from here

- Change the claims, the limits, or the demo trace (copy `test/fixtures/demo-run-trace.json`) and import your edit with `--full`. This is a safe way to see what each feature does with a run you shaped yourself.
- Read [what each answer does and does not mean](../README.md#what-the-answers-do-and-do-not-mean).
- Read how a run file is built and checked: the [run event contract](schemas/run-event-contract-v1.md).
- Real agent traces are on hold until the boundary in [ADR-028](adr/ADR-028-real-trace-admission-needs-a-real-boundary.md) exists. Until then use demo data like this.
