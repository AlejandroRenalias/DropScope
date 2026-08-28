import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { MissionEvent } from "../src/contracts.js";
import { handleProposedEvent } from "../src/command-handler.js";
import { runWalkingSkeletonMission } from "../src/run-mission.js";

describe("stale completion handling", () => {
  it("records a duplicate completion without changing the finished attempt or budget", async () => {
    const completedMission = await runWalkingSkeletonMission({
      missionId: "stale-completion-demo",
      totalBudget: 120,
      historyPath: join(await mkdtemp(join(tmpdir(), "dropscope-")), "mission.jsonl"),
    });
    const duplicateCompletion: MissionEvent = {
      ...completedMission.events[3],
      sequenceNumber: 6,
      eventId: "stale-completion-demo-6",
    };

    const result = handleProposedEvent(completedMission.events, duplicateCompletion);

    expect(result.events.at(-1)?.type).toBe("StaleCompletionIgnored");
    expect(result.state.budget.spent).toBe(10);
    expect(result.state.attempts["system-check:a1"].finding).toBe("System check completed.");
    expect(result.state.staleCompletionAttemptIds).toEqual(["system-check:a1"]);
  });
});
