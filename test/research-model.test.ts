import { describe, expect, it } from "vitest";
import { officeHistories, projectOffice } from "../src/frontend/office-projection.js";
import { attemptChain, defaultSelection, describeChange, humanizeType, layoutTasks, nodeTitle, uniqueAgents } from "../src/frontend/research-model.js";

const prefix = (scenario: keyof typeof officeHistories, length: number) => projectOffice(officeHistories[scenario].slice(0, length));

describe("research constellation layout", () => {
  it("places prerequisites to the left of the work that depends on them", () => {
    const tasks = projectOffice(officeHistories.COMPLETED).tasks;
    const laid = layoutTasks(tasks);
    const byId = new Map(laid.map((item) => [item.task.id, item]));
    expect(laid).toHaveLength(4);
    for (const { task, x } of laid) for (const dependency of task.dependencyIds) expect(byId.get(dependency)!.x).toBeLessThan(x);
    expect(new Set(laid.map((item) => `${item.x}:${item.y}`)).size).toBe(4);
  });

  it("centres a single task and survives dependency cycles and unknown parents", () => {
    const base = projectOffice(officeHistories.RUNNING).tasks[0]!;
    expect(layoutTasks([base])[0]).toMatchObject({ x: 50, y: 46, level: 0 });
    const cyclic = [{ ...base, id: "a", dependencyIds: ["b"] }, { ...base, id: "b", dependencyIds: ["a"] }, { ...base, id: "c", dependencyIds: ["missing"] }];
    expect(layoutTasks(cyclic)).toHaveLength(3);
  });

  it("selects blocked work first, then working work, then the latest completed task", () => {
    expect(defaultSelection(projectOffice(officeHistories.BLOCKED).tasks)).toBe("crosscurrent-risk-review");
    expect(defaultSelection(projectOffice(officeHistories.RUNNING).tasks)).toBe("workflow-interviews");
    expect(defaultSelection(projectOffice(officeHistories.COMPLETED).tasks)).toBe("crosscurrent-risk-review");
    expect(defaultSelection([])).toBeUndefined();
  });

  it("titles nodes by role and falls back to a trimmed objective", () => {
    const tasks = projectOffice(officeHistories.RUNNING).tasks;
    expect(nodeTitle(tasks[0]!)).toBe("Market");
    expect(nodeTitle({ ...tasks[0]!, role: null, label: "A very long objective that must be trimmed for the node" })).toBe("A very long objective tha…");
  });

  it("collapses repeated workstations into one researcher per role", () => {
    const projection = projectOffice(officeHistories.COMPLETED);
    expect(uniqueAgents(projection).length).toBeLessThanOrEqual(projection.agents.length);
    expect(new Set(uniqueAgents(projection).map((agent) => agent.id)).size).toBe(uniqueAgents(projection).length);
  });
});

describe("replay change description", () => {
  const history = officeHistories.RUNNING;
  const at = (sequence: number) => ({ before: sequence > 1 ? prefix("RUNNING", sequence - 1) : null, after: prefix("RUNNING", sequence) });

  it("reports a finished task, the budget movement and the researcher count", () => {
    const finding = history.findIndex((event) => event.type === "FindingSubmitted") + 1;
    const { before, after } = at(finding);
    const change = describeChange(before, after);
    expect(change.lines).toContain("Market: Working → Completed");
    expect(change.lines.some((line) => line.startsWith("Budget spent:"))).toBe(true);
    expect(change.lines).toContain("Researchers working: 1 → 0");
    expect(change.taskIds.size).toBe(1);
  });

  it("reports newly authorized and newly scheduled tasks", () => {
    const authorized = history.findIndex((event, index) => event.type === "TaskAuthorized" && index > 5) + 1;
    expect(describeChange(prefix("RUNNING", authorized - 1), prefix("RUNNING", authorized)).lines.some((line) => line.endsWith("authorized"))).toBe(true);
    const scheduled = history.findIndex((event, index) => event.type === "TaskScheduled" && index > 8) + 1;
    expect(describeChange(prefix("RUNNING", scheduled - 1), prefix("RUNNING", scheduled)).lines.some((line) => line.endsWith("scheduled"))).toBe(true);
  });

  it("returns no changes for the very first event and for events that do not alter research state", () => {
    expect(describeChange(null, prefix("RUNNING", 1)).lines).toEqual([]);
    const review = history.findIndex((event) => event.type === "BlindReviewCompleted") + 1;
    expect(describeChange(prefix("RUNNING", review - 1), prefix("RUNNING", review)).lines).toEqual([]);
  });

  it("reports the mission status change when a replay terminates", () => {
    const last = officeHistories.BLOCKED.length;
    const change = describeChange(prefix("BLOCKED", last - 1), prefix("BLOCKED", last));
    expect(change.lines.some((line) => line.startsWith("Mission status:"))).toBe(true);
  });
});

describe("worker provenance chain", () => {
  it("lists the task authorization and every event of one attempt in recorded order", () => {
    const chain = attemptChain(officeHistories.RUNNING, "workspace:a1");
    expect(chain.map((step) => step.type)).toEqual(["TaskAuthorized", "TaskScheduled", "BudgetReserved", "TaskStarted", "FindingSubmitted"]);
    expect(chain.map((step) => step.sequence)).toEqual([...chain.map((step) => step.sequence)].sort((a, b) => a - b));
    expect(chain.filter((step) => step.final).map((step) => step.type)).toEqual(["FindingSubmitted"]);
    expect(chain.at(-1)!.summary).toContain("Workspace demand mapped.");
  });

  it("does not leak events from other attempts and handles unknown attempts", () => {
    const evidence = attemptChain(officeHistories.RUNNING, "workflow:a1");
    expect(evidence.every((step) => step.sequence > 1)).toBe(true);
    expect(evidence.some((step) => step.type === "FindingSubmitted")).toBe(false);
    expect(attemptChain(officeHistories.RUNNING, "missing:a1")).toEqual([]);
  });

  it("humanizes event type names", () => {
    expect(humanizeType("TaskStarted")).toBe("Task started");
    expect(humanizeType("SubscriptionWorkerExecutionOutcomeRecorded")).toBe("Subscription worker execution outcome recorded");
  });
});