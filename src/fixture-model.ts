import { z } from "zod";

const fixtureIdSchema = z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, "Fixture IDs must be lowercase kebab-case.");
const taskIdSchema = z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, "Task IDs must be lowercase kebab-case.");

export const fixtureTaskSchema = z.object({
  id: taskIdSchema,
  objective: z.string().min(1),
  cost: z.number().int().positive(),
  workClass: z.enum(["MANDATORY", "OPTIONAL"]),
  researchKey: z.string().min(1),
  dependencies: z.array(taskIdSchema),
  workerRole: z.string().min(1),
}).strict();

const fixtureShape = z.object({
  fixtureId: fixtureIdSchema,
  seed: z.number().int(),
  budget: z.number().int().positive(),
  tasks: z.array(fixtureTaskSchema).min(1),
}).strict();

export const fixtureSchema = fixtureShape.superRefine((fixture, context) => {
  const taskIds = new Set<string>();
  for (const [index, task] of fixture.tasks.entries()) {
    if (taskIds.has(task.id)) {
      context.addIssue({ code: "custom", path: ["tasks", index, "id"], message: `Duplicate task ID: ${task.id}` });
    }
    taskIds.add(task.id);
  }

  const knownIds = new Set(fixture.tasks.map((task) => task.id));
  fixture.tasks.forEach((task, index) => task.dependencies.forEach((dependency, dependencyIndex) => {
    if (!knownIds.has(dependency)) {
      context.addIssue({ code: "custom", path: ["tasks", index, "dependencies", dependencyIndex], message: `Unknown task dependency: ${dependency}` });
    }
  }));

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(fixture.tasks.map((task) => [task.id, task]));
  const visit = (taskId: string) => {
    if (visiting.has(taskId)) return true;
    if (visited.has(taskId)) return false;
    visiting.add(taskId);
    const task = byId.get(taskId);
    const cycle = task?.dependencies.some(visit) ?? false;
    visiting.delete(taskId);
    visited.add(taskId);
    return cycle;
  };
  for (const task of fixture.tasks) {
    if (visit(task.id)) {
      context.addIssue({ code: "custom", path: ["tasks"], message: "Task dependencies must form an acyclic graph." });
      break;
    }
  }
});

export type FixtureTask = z.infer<typeof fixtureTaskSchema>;
export type Fixture = z.infer<typeof fixtureSchema>;

const definitions: readonly Fixture[] = [
  {
    fixtureId: "mixed-opportunity-market",
    seed: 1101,
    budget: 90,
    tasks: [
      { id: "market-scan", objective: "Map the opportunity space.", cost: 20, workClass: "MANDATORY", researchKey: "market-scope", dependencies: [], workerRole: "MARKET_RESEARCHER" },
      { id: "demand-check", objective: "Test demand signals.", cost: 25, workClass: "MANDATORY", researchKey: "demand", dependencies: ["market-scan"], workerRole: "EVIDENCE_RESEARCHER" },
      { id: "risk-check", objective: "Check material risks.", cost: 15, workClass: "OPTIONAL", researchKey: "risk", dependencies: ["market-scan"], workerRole: "RISK_RESEARCHER" },
    ],
  },
  {
    fixtureId: "evidence-drought",
    seed: 2202,
    budget: 70,
    tasks: [
      { id: "source-scan", objective: "Locate available sources.", cost: 20, workClass: "MANDATORY", researchKey: "source-coverage", dependencies: [], workerRole: "SOURCE_RESEARCHER" },
      { id: "coverage-check", objective: "Measure evidence coverage.", cost: 25, workClass: "MANDATORY", researchKey: "coverage", dependencies: ["source-scan"], workerRole: "EVIDENCE_RESEARCHER" },
    ],
  },
  {
    fixtureId: "safety-ambiguity",
    seed: 3303,
    budget: 80,
    tasks: [
      { id: "safety-scan", objective: "Identify safety considerations.", cost: 25, workClass: "MANDATORY", researchKey: "safety", dependencies: [], workerRole: "SAFETY_RESEARCHER" },
      { id: "ambiguity-check", objective: "Resolve ambiguous signals.", cost: 30, workClass: "MANDATORY", researchKey: "ambiguity", dependencies: ["safety-scan"], workerRole: "EVIDENCE_RESEARCHER" },
    ],
  },
];

const fixtureRegistry = new Map(definitions.map((fixture) => [fixture.fixtureId, fixture]));

export function loadFixture(fixtureId: string): Fixture {
  const fixture = fixtureRegistry.get(fixtureId);
  if (!fixture) throw new Error(`Unknown fixture ID: ${fixtureId}`);
  return fixtureSchema.parse(fixture);
}

export const fixtureIds = definitions.map((fixture) => fixture.fixtureId) as readonly string[];
