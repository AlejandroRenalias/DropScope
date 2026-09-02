import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runFixtureMission } from "../src/fixture-runner.js";

describe("fixture-driven simulated missions", () => {
  it.each(["mixed-opportunity-market", "evidence-drought", "safety-ambiguity"])("runs %s through the shared scheduler", async (fixtureId) => {
    const result = await runFixtureMission({
      fixtureId,
      missionId: `${fixtureId}-mission`,
      historyPath: join(await mkdtemp(join(tmpdir(), "dropscope-")), "mission.jsonl"),
    });

    expect(result.state.status).toBe("COMPLETED");
    expect(result.events[0]?.type).toBe("MissionCreated");
    expect(result.events.at(-1)?.type).toBe("MissionCompleted");
    expect(new Set(Object.values(result.schedule.taskOutcomes))).toEqual(new Set(["COMPLETED"]));
  });

  it("changes mission data without changing the runner", async () => {
    const root = await mkdtemp(join(tmpdir(), "dropscope-"));
    const first = await runFixtureMission({ fixtureId: "evidence-drought", missionId: "fixture-one", historyPath: join(root, "one.jsonl") });
    const second = await runFixtureMission({ fixtureId: "safety-ambiguity", missionId: "fixture-two", historyPath: join(root, "two.jsonl") });

    expect(first.events[0]?.payload).not.toEqual(second.events[0]?.payload);
    expect(Object.keys(first.state.tasks)).not.toEqual(Object.keys(second.state.tasks));
  });
});
