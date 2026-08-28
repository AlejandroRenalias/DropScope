import { join } from "node:path";

import { beginWalkingSkeletonMission, recoverWalkingSkeletonMission } from "./run-mission.js";

const missionId = `recovery-demo-${Date.now()}`;
const historyPath = join(".dropscope-data", `${missionId}.jsonl`);

await beginWalkingSkeletonMission({ missionId, totalBudget: 120, historyPath });
console.log("Process stopped while system-check was running.");

const result = await recoverWalkingSkeletonMission({ missionId, historyPath });
console.log(`Mission: ${result.state.status}`);
console.log(`Budget: ${result.state.budget.total} total, ${result.state.budget.spent} spent, ${result.state.budget.available} available`);
console.log(`History: ${result.events.length} append-only events`);
