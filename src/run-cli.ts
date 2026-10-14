// Command line for agent run forensics.
//   import <spans.json> [--logs <logs.json>] [--trace <traceId>] [--full]
//   state <run.runlog.jsonl> [--at <N>]
//   budget <run.runlog.jsonl> [limits...] [--json]   (counterfactual: re-applies a budget to a recorded run)
// Output never echoes input text: only fixed words, counts, ids and escaped paths (spec 11.6).
import { pathToFileURL } from "node:url";
import { parseBudgetPolicy, replayBudget, type BudgetPolicyInput } from "./budget-replay.js";
import { budgetReportLines } from "./budget-report.js";
import { buildRunModel } from "./frontend/run-replay-model.js";
import { defaultChecks, readInputFile, type PlatformChecks } from "./run-files.js";
import { ImportError } from "./run-import-error.js";
import { importTraceBytes } from "./run-import.js";
import { createReplay } from "./run-reducer.js";
import { publishRun, readRunLog } from "./run-store.js";

const MAX_INPUT_FILE = 32 * 1024 * 1024;
const MAX_INPUT_TOTAL = 64 * 1024 * 1024;

export type CliIo = { out: (text: string) => void; err: (text: string) => void };
export type CliOptions = { runsDirectory?: string; checks?: PlatformChecks };

// Replaces control characters and bidirectional overrides so output cannot rewrite the terminal.
export function escapeForTerminal(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f؜‎‏‪-‮⁦-⁩]/gu,
    (c) => `\\u{${(c.codePointAt(0) as number).toString(16)}}`);
}

const USAGE = [
  "Usage:",
  "  import <spans.json> [--logs <logs.json>] [--trace <traceId>] [--full]",
  "  state <run.runlog.jsonl> [--at <step number>]",
  "  budget <run.runlog.jsonl> [--max-total-tokens N] [--max-input-tokens N] [--max-output-tokens N]",
  "         [--max-model-calls N] [--max-tool-calls N] [--max-steps N] [--max-seconds S]",
  "         [--max-cost X --input-price P --output-price Q [--currency USD]] [--json]",
  "         (what-if: where a guard with these limits would have stopped a recorded run)",
  "",
  "Run files are local-only: do not share or commit them. --full keeps content in the file.",
].join("\n");

class UsageError extends Error {}

function parseFlags(args: string[], valued: string[], boolean: string[]): { positional: string[]; values: Map<string, string>; flags: Set<string> } {
  const positional: string[] = [];
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (valued.includes(arg)) {
      const value = args[i + 1];
      if (value === undefined || values.has(arg)) throw new UsageError();
      values.set(arg, value);
      i += 1;
    } else if (boolean.includes(arg)) {
      flags.add(arg);
    } else if (arg.startsWith("--")) {
      throw new UsageError();
    } else {
      positional.push(arg);
    }
  }
  return { positional, values, flags };
}

export function runCli(argv: string[], io: CliIo, options: CliOptions = {}): number {
  const checks = options.checks ?? defaultChecks();
  try {
    const [command, ...rest] = argv;
    if (command === "import") {
      const { positional, values, flags } = parseFlags(rest, ["--logs", "--trace"], ["--full"]);
      if (positional.length !== 1) throw new UsageError();
      const spans = readInputFile(positional[0], MAX_INPUT_FILE, checks);
      const logsPath = values.get("--logs");
      const logs = logsPath === undefined ? undefined : readInputFile(logsPath, MAX_INPUT_FILE, checks);
      if (spans.length + (logs?.length ?? 0) > MAX_INPUT_TOTAL) throw new ImportError("E_LIMIT", "cli", null, "INPUT_TOTAL");
      const events = importTraceBytes({
        spans, logs, selectTrace: values.get("--trace"), contentMode: flags.has("--full") ? "FULL" : "HASH_ONLY",
      });
      const published = publishRun(events, { runsDirectory: options.runsDirectory, checks });
      const replay = createReplay(events);
      const state = replay.stateAt(replay.length);
      const header = events[0];
      io.out([
        `${published.status === "CREATED" ? "Imported" : "Already imported"} run ${header.runId}`,
        `  file: ${escapeForTerminal(published.path)}`,
        `  content mode: ${header.type === "RunStarted" ? header.payload.contentMode : ""}`,
        `  events: ${events.length}  steps: ${state.closedStepIds.length}  logs: ${state.logCount}  errors: ${state.errorStepIds.length}`,
        `  tokens: input ${state.inputTokens}, output ${state.outputTokens}`,
        `  notes: ${Object.entries(state.notes).map(([code, n]) => `${code} x${n}`).join(", ") || "none"}`,
        ...published.warnings.map((w) => `  warning: ${w} (run files would be uploaded by the sync service)`),
        "",
      ].join("\n"));
      return 0;
    }
    if (command === "state") {
      const { positional, values } = parseFlags(rest, ["--at"], []);
      if (positional.length !== 1) throw new UsageError();
      const atText = values.get("--at");
      if (atText !== undefined && !/^[0-9]{1,9}$/.test(atText)) throw new UsageError();
      const replay = createReplay(readRunLog(positional[0], checks));
      const at = atText === undefined ? replay.length : Number(atText);
      const event = replay.events[at - 1];
      io.out(`${JSON.stringify({ at, of: replay.length, event: event?.type ?? null, state: replay.stateAt(at) }, null, 2)}\n`);
      return 0;
    }
    if (command === "budget") {
      const flagNames = ["--max-total-tokens", "--max-input-tokens", "--max-output-tokens", "--max-model-calls", "--max-tool-calls",
        "--max-steps", "--max-seconds", "--max-cost", "--input-price", "--output-price", "--currency"];
      const { positional, values, flags } = parseFlags(rest, flagNames, ["--json"]);
      if (positional.length !== 1) throw new UsageError();
      const input: BudgetPolicyInput = {
        maxTotalTokens: values.get("--max-total-tokens"), maxInputTokens: values.get("--max-input-tokens"), maxOutputTokens: values.get("--max-output-tokens"),
        maxModelCalls: values.get("--max-model-calls"), maxToolCalls: values.get("--max-tool-calls"), maxSteps: values.get("--max-steps"),
        maxSeconds: values.get("--max-seconds"), maxCost: values.get("--max-cost"), inputPrice: values.get("--input-price"),
        outputPrice: values.get("--output-price"), currency: values.get("--currency"),
      };
      const parsed = parseBudgetPolicy(input);
      if (!parsed.policy) {
        io.err(`${parsed.errors.map((message) => `error: ${message}`).join("\n")}\n`);
        return 2;
      }
      const model = buildRunModel(readRunLog(positional[0], checks));
      const result = replayBudget(model.events, parsed.policy);
      const titleOf = (stepId: string): string => model.stepsById.get(stepId)?.title ?? "a step";
      if (flags.has("--json")) {
        const text = JSON.stringify({
          counterfactual: true, runId: model.runId, policy: parsed.policy, firstBreach: result.first, breaches: result.breaches,
          alsoAtSameStop: result.alsoAtSameStop,
          remainder: result.remainder === null ? null : {
            notStarted: result.remainder.notStarted.map((s) => s.stepId), inFlight: result.remainder.inFlight.map((s) => s.stepId),
            tokensNotStarted: result.remainder.tokensNotStarted, tokensInFlight: result.remainder.tokensInFlight,
          },
          recorded: result.recorded, usageGaps: result.usageGaps,
        }, (_key, value) => (typeof value === "bigint" ? value.toString() : value), 2);
        io.out(`${text}\n`);
      } else {
        io.out(`${budgetReportLines(result, model.events, titleOf).join("\n")}\n`);
      }
      return 0;
    }
    throw new UsageError();
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(`${USAGE}\n`);
      return 2;
    }
    if (error instanceof ImportError) {
      io.err(`error: ${escapeForTerminal(error.message)}\n`);
      return 1;
    }
    io.err("error: unexpected failure\n");
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runCli(process.argv.slice(2), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  });
}
