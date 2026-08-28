import { join } from "node:path";

import { runWalkingSkeletonMission } from "./run-mission.js";

const missionId = `walking-skeleton-demo-${Date.now()}`;
const result = await runWalkingSkeletonMission({
  missionId,
  totalBudget: 120,
  historyPath: join(".dropscope-data", `${missionId}.jsonl`),
});

console.log(`Mission: ${result.state.status}`);
console.log(`Budget: ${result.state.budget.total} total, ${result.state.budget.spent} spent, ${result.state.budget.available} available`);
console.log(`History: ${result.events.length} saved events`);
