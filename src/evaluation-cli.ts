import { recommendDefaultTaskCapacity, runEvaluationBaseline, summarizeCapacityExperiment } from "./evaluation-baseline.js";
import { runVirtualStaffingExperiment } from "./virtual-staffing-evaluation.js";

const summaries = await runEvaluationBaseline();
const comparison = summarizeCapacityExperiment(summaries);
console.table(summaries);
console.log("Task-capacity experiment (capacity means simultaneous scheduler slots, not real specialist count):");
console.table(comparison);
console.log("Quality-versus-usage recommendation for this fixed local evaluation suite:");
console.table([recommendDefaultTaskCapacity(comparison)]);
console.log("Virtual role-based staffing experiment (simulation only; it does not alter the product scheduler):");
console.table(await runVirtualStaffingExperiment());
