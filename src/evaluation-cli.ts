import { runEvaluationBaseline } from "./evaluation-baseline.js";

const summaries = await runEvaluationBaseline();
console.table(summaries);
