import { describe, expect, it } from "vitest";
import { fixtureSchema, loadFixture } from "../src/fixture-model.js";

describe("synthetic fixture model", () => {
  it("loads all named fixtures with deterministic task data", () => {
    for (const id of ["mixed-opportunity-market", "evidence-drought", "safety-ambiguity"]) {
      const first = loadFixture(id);
      const second = loadFixture(id);
      expect(first).toEqual(second);
      expect(first.fixtureId).toBe(id);
      expect(first.tasks.length).toBeGreaterThan(0);
    }
  });

  it("rejects duplicate IDs, unknown dependencies, and cycles", () => {
    const base = loadFixture("evidence-drought");
    expect(() => fixtureSchema.parse({ ...base, tasks: [...base.tasks, { ...base.tasks[0] }] })).toThrow(/Duplicate task ID/);
    expect(() => fixtureSchema.parse({ ...base, tasks: [{ ...base.tasks[0], dependencies: ["missing"] }, base.tasks[1]] })).toThrow(/Unknown task dependency/);
    expect(() => fixtureSchema.parse({ ...base, tasks: [
      { ...base.tasks[0], id: "first", dependencies: ["second"] },
      { ...base.tasks[1], id: "second", dependencies: ["first"] },
    ] })).toThrow(/acyclic/);
  });

  it("rejects unknown fixture IDs", () => {
    expect(() => loadFixture("not-a-fixture")).toThrow(/Unknown fixture ID/);
  });
});
