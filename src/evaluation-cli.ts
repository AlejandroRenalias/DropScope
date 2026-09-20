import { runEvaluationBaseline, summarizeCapacityExperiment } from "./evaluation-baseline.js";

const summaries = await runEvaluationBaseline();
console.table(summaries);
console.log("Task-capacity experiment (capacity means simultaneous scheduler slots, not real specialist count):");
console.table(summarizeCapacityExperiment(summaries));
