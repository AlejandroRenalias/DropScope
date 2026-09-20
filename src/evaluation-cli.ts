import { recommendDefaultTaskCapacity, runEvaluationBaseline, summarizeCapacityExperiment } from "./evaluation-baseline.js";

const summaries = await runEvaluationBaseline();
const comparison = summarizeCapacityExperiment(summaries);
console.table(summaries);
console.log("Task-capacity experiment (capacity means simultaneous scheduler slots, not real specialist count):");
console.table(comparison);
console.log("Quality-versus-usage recommendation for this fixed local evaluation suite:");
console.table([recommendDefaultTaskCapacity(comparison)]);
