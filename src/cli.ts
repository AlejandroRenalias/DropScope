import { join } from "node:path";

import { runWalkingSkeletonMission } from "./run-mission.js";
import { formatMissionSummary } from "./mission-summary.js";

const missionId = `walking-skeleton-demo-${Date.now()}`;
const result = await runWalkingSkeletonMission({
  missionId,
  totalBudget: 120,
  historyPath: join(".dropscope-data", `${missionId}.jsonl`),
});

console.log(formatMissionSummary(result.state, result.events));
