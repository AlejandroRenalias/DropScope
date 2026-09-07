import { z } from "zod";
import { riskGateInputSchema } from "./risk-policy.js";

const fixtureIdSchema = z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, "Fixture IDs must be lowercase kebab-case.");
const taskIdSchema = z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, "Task IDs must be lowercase kebab-case.");

export const fixtureTaskSchema = z.object({
  id: taskIdSchema,
  objective: z.string().min(1),
  cost: z.number().int().positive(),
  durationMs: z.number().int().positive(),
  workClass: z.enum(["MANDATORY", "OPTIONAL"]),
  researchKey: z.string().min(1),
  dependencies: z.array(taskIdSchema),
  workerRole: z.string().min(1),
}).strict();

export const fixtureCandidateEvaluationSchema = z.object({
  candidateId: z.string().min(1),
  riskInput: riskGateInputSchema,
  customerProblemEvidenceScore: z.number().int().min(0).max(100),
  evidenceQualityScore: z.number().int().min(0).max(100),
  trendDurabilityScore: z.number().int().min(0).max(100),
  advertisingSaturationScore: z.number().int().min(0).max(100),
  operationalRiskScore: z.number().int().min(0).max(100),
  failureRiskScore: z.number().int().min(0).max(100),
  hasUnresolvedBlockingContradiction: z.boolean(),
  hasBlockingDecisionCriticalMissingEvidence: z.boolean(),
}).strict().superRefine((candidate, context) => {
  if (candidate.riskInput.candidateId !== candidate.candidateId) context.addIssue({ code: "custom", path: ["riskInput", "candidateId"], message: "Risk input must belong to the fixture candidate." });
});

const fixtureShape = z.object({
  fixtureId: fixtureIdSchema,
  seed: z.number().int(),
  budget: z.number().int().positive(),
  tasks: z.array(fixtureTaskSchema).min(1),
  candidateEvaluations: z.array(fixtureCandidateEvaluationSchema),
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

  const candidateIds = new Set<string>();
  fixture.candidateEvaluations.forEach((candidate, index) => {
    if (candidateIds.has(candidate.candidateId)) context.addIssue({ code: "custom", path: ["candidateEvaluations", index, "candidateId"], message: `Duplicate fixture candidate ID: ${candidate.candidateId}` });
    candidateIds.add(candidate.candidateId);
  });

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
export type FixtureCandidateEvaluation = z.infer<typeof fixtureCandidateEvaluationSchema>;
export type Fixture = z.infer<typeof fixtureSchema>;

const defaultRiskAttributes: z.infer<typeof riskGateInputSchema>["attributes"] = { intendedUser: "GENERAL", foodOrIngestion: "NO", bodyContact: "NONE", healthPositioning: "NONE", electricalPower: "NONE", thermalOrFireHazard: "NONE", physicalHazard: "NONE", protectiveFunction: "NONE", chemicalExposure: "NONE_DECLARED", regulatedCategorySignal: "NONE", brandOrCreativeSimilaritySignal: "NONE_OBSERVED", evidenceCompleteness: "SUFFICIENT" };
const riskInput = (candidateId: string, attributes: Partial<z.infer<typeof riskGateInputSchema>["attributes"]> = {}): z.infer<typeof riskGateInputSchema> => ({
  decisionId: `${candidateId}-risk`, candidateId, decidedByPolicyVersion: "risk-v1",
  attributes: { ...defaultRiskAttributes, ...attributes },
  attributeEvidenceIds: { intendedUser: [], foodOrIngestion: [], bodyContact: [], healthPositioning: [], electricalPower: [], thermalOrFireHazard: [], physicalHazard: [], protectiveFunction: [], chemicalExposure: [], regulatedCategorySignal: [], brandOrCreativeSimilaritySignal: [], evidenceCompleteness: [] },
});

const definitions: readonly Fixture[] = [
  {
    fixtureId: "mixed-opportunity-market",
    seed: 3,
    budget: 90,
    candidateEvaluations: [
      { candidateId: "market-candidate", riskInput: riskInput("market-candidate"), customerProblemEvidenceScore: 82, evidenceQualityScore: 78, trendDurabilityScore: 75, advertisingSaturationScore: 35, operationalRiskScore: 25, failureRiskScore: 20, hasUnresolvedBlockingContradiction: false, hasBlockingDecisionCriticalMissingEvidence: false },
    ],
    tasks: [
      { id: "market-scan", objective: "Map the opportunity space.", cost: 20, durationMs: 20, workClass: "MANDATORY", researchKey: "market-scope", dependencies: [], workerRole: "MARKET_RESEARCHER" },
      { id: "demand-check", objective: "Test demand signals.", cost: 25, durationMs: 15, workClass: "MANDATORY", researchKey: "demand", dependencies: ["market-scan"], workerRole: "EVIDENCE_RESEARCHER" },
      { id: "risk-check", objective: "Check material risks.", cost: 15, durationMs: 10, workClass: "MANDATORY", researchKey: "risk", dependencies: ["market-scan"], workerRole: "RISK_RESEARCHER" },
    ],
  },
  {
    fixtureId: "evidence-drought",
    seed: 1,
    budget: 70,
    candidateEvaluations: [
      { candidateId: "drought-candidate", riskInput: riskInput("drought-candidate"), customerProblemEvidenceScore: 40, evidenceQualityScore: 45, trendDurabilityScore: 50, advertisingSaturationScore: 50, operationalRiskScore: 50, failureRiskScore: 50, hasUnresolvedBlockingContradiction: false, hasBlockingDecisionCriticalMissingEvidence: false },
    ],
    tasks: [
      { id: "source-scan", objective: "Locate available sources.", cost: 20, durationMs: 20, workClass: "MANDATORY", researchKey: "source-coverage", dependencies: [], workerRole: "SOURCE_RESEARCHER" },
      { id: "coverage-check", objective: "Measure evidence coverage.", cost: 25, durationMs: 15, workClass: "MANDATORY", researchKey: "coverage", dependencies: ["source-scan"], workerRole: "EVIDENCE_RESEARCHER" },
    ],
  },
  {
    fixtureId: "safety-ambiguity",
    seed: 1,
    budget: 80,
    candidateEvaluations: [
      { candidateId: "food-risk", riskInput: riskInput("food-risk", { foodOrIngestion: "FOOD_OR_SUPPLEMENT" }), customerProblemEvidenceScore: 90, evidenceQualityScore: 90, trendDurabilityScore: 80, advertisingSaturationScore: 20, operationalRiskScore: 20, failureRiskScore: 20, hasUnresolvedBlockingContradiction: false, hasBlockingDecisionCriticalMissingEvidence: false },
      { candidateId: "medical-risk", riskInput: riskInput("medical-risk", { healthPositioning: "MEDICAL_CLAIM_OR_DEVICE" }), customerProblemEvidenceScore: 90, evidenceQualityScore: 90, trendDurabilityScore: 80, advertisingSaturationScore: 20, operationalRiskScore: 20, failureRiskScore: 20, hasUnresolvedBlockingContradiction: false, hasBlockingDecisionCriticalMissingEvidence: false },
      { candidateId: "ambiguous-risk", riskInput: riskInput("ambiguous-risk", { evidenceCompleteness: "MATERIAL_ATTRIBUTE_MISSING" }), customerProblemEvidenceScore: 90, evidenceQualityScore: 90, trendDurabilityScore: 80, advertisingSaturationScore: 20, operationalRiskScore: 20, failureRiskScore: 20, hasUnresolvedBlockingContradiction: false, hasBlockingDecisionCriticalMissingEvidence: false },
      { candidateId: "restricted-risk", riskInput: riskInput("restricted-risk", { electricalPower: "BATTERY" }), customerProblemEvidenceScore: 90, evidenceQualityScore: 90, trendDurabilityScore: 80, advertisingSaturationScore: 20, operationalRiskScore: 20, failureRiskScore: 20, hasUnresolvedBlockingContradiction: false, hasBlockingDecisionCriticalMissingEvidence: false },
      { candidateId: "safe-alpha", riskInput: riskInput("safe-alpha"), customerProblemEvidenceScore: 85, evidenceQualityScore: 85, trendDurabilityScore: 80, advertisingSaturationScore: 20, operationalRiskScore: 20, failureRiskScore: 20, hasUnresolvedBlockingContradiction: false, hasBlockingDecisionCriticalMissingEvidence: false },
      { candidateId: "safe-beta", riskInput: riskInput("safe-beta"), customerProblemEvidenceScore: 80, evidenceQualityScore: 80, trendDurabilityScore: 75, advertisingSaturationScore: 25, operationalRiskScore: 25, failureRiskScore: 25, hasUnresolvedBlockingContradiction: false, hasBlockingDecisionCriticalMissingEvidence: false },
    ],
    tasks: [
      { id: "safety-scan", objective: "Identify safety considerations.", cost: 25, durationMs: 20, workClass: "MANDATORY", researchKey: "safety", dependencies: [], workerRole: "SAFETY_RESEARCHER" },
      { id: "ambiguity-check", objective: "Resolve ambiguous signals.", cost: 30, durationMs: 15, workClass: "MANDATORY", researchKey: "ambiguity", dependencies: ["safety-scan"], workerRole: "EVIDENCE_RESEARCHER" },
    ],
  },
  {
    fixtureId: "crosscurrent-workspace-market",
    seed: 47,
    budget: 140,
    candidateEvaluations: [
      { candidateId: "food-power-crosscurrent", riskInput: riskInput("food-power-crosscurrent", { foodOrIngestion: "FOOD_OR_SUPPLEMENT", electricalPower: "MAINS_OR_HIGH_POWER", brandOrCreativeSimilaritySignal: "OBVIOUS_BRAND_OR_CHARACTER_REFERENCE" }), customerProblemEvidenceScore: 94, evidenceQualityScore: 91, trendDurabilityScore: 88, advertisingSaturationScore: 30, operationalRiskScore: 20, failureRiskScore: 18, hasUnresolvedBlockingContradiction: false, hasBlockingDecisionCriticalMissingEvidence: false },
      { candidateId: "medical-workspace", riskInput: riskInput("medical-workspace", { healthPositioning: "MEDICAL_CLAIM_OR_DEVICE" }), customerProblemEvidenceScore: 90, evidenceQualityScore: 87, trendDurabilityScore: 82, advertisingSaturationScore: 35, operationalRiskScore: 28, failureRiskScore: 24, hasUnresolvedBlockingContradiction: false, hasBlockingDecisionCriticalMissingEvidence: false },
      { candidateId: "child-workspace", riskInput: riskInput("child-workspace", { intendedUser: "CHILD_UNDER_14", regulatedCategorySignal: "TOY_OR_CHILDCARE" }), customerProblemEvidenceScore: 86, evidenceQualityScore: 84, trendDurabilityScore: 80, advertisingSaturationScore: 32, operationalRiskScore: 26, failureRiskScore: 22, hasUnresolvedBlockingContradiction: false, hasBlockingDecisionCriticalMissingEvidence: false },
      { candidateId: "uncertain-workspace", riskInput: riskInput("uncertain-workspace", { evidenceCompleteness: "CONFLICTING_MATERIAL_ATTRIBUTE" }), customerProblemEvidenceScore: 88, evidenceQualityScore: 72, trendDurabilityScore: 79, advertisingSaturationScore: 40, operationalRiskScore: 30, failureRiskScore: 26, hasUnresolvedBlockingContradiction: true, hasBlockingDecisionCriticalMissingEvidence: true },
      { candidateId: "deskflow-alpha", riskInput: riskInput("deskflow-alpha"), customerProblemEvidenceScore: 91, evidenceQualityScore: 89, trendDurabilityScore: 86, advertisingSaturationScore: 24, operationalRiskScore: 18, failureRiskScore: 16, hasUnresolvedBlockingContradiction: false, hasBlockingDecisionCriticalMissingEvidence: false },
      { candidateId: "deskflow-beta", riskInput: riskInput("deskflow-beta"), customerProblemEvidenceScore: 84, evidenceQualityScore: 82, trendDurabilityScore: 78, advertisingSaturationScore: 29, operationalRiskScore: 23, failureRiskScore: 21, hasUnresolvedBlockingContradiction: false, hasBlockingDecisionCriticalMissingEvidence: false },
      { candidateId: "deskflow-gamma", riskInput: riskInput("deskflow-gamma"), customerProblemEvidenceScore: 79, evidenceQualityScore: 80, trendDurabilityScore: 74, advertisingSaturationScore: 34, operationalRiskScore: 27, failureRiskScore: 25, hasUnresolvedBlockingContradiction: false, hasBlockingDecisionCriticalMissingEvidence: false },
    ],
    tasks: [
      { id: "workspace-scan", objective: "Map cross-current workspace demand.", cost: 25, durationMs: 20, workClass: "MANDATORY", researchKey: "workspace-market", dependencies: [], workerRole: "MARKET_RESEARCHER" },
      { id: "workflow-interviews", objective: "Compare recurring workflow problems.", cost: 30, durationMs: 15, workClass: "MANDATORY", researchKey: "workflow-evidence", dependencies: ["workspace-scan"], workerRole: "EVIDENCE_RESEARCHER" },
      { id: "supplier-check", objective: "Check operational feasibility.", cost: 20, durationMs: 12, workClass: "MANDATORY", researchKey: "supplier-feasibility", dependencies: ["workspace-scan"], workerRole: "OPERATIONS_RESEARCHER" },
      { id: "crosscurrent-risk-review", objective: "Review conflicting risk signals.", cost: 25, durationMs: 10, workClass: "MANDATORY", researchKey: "crosscurrent-risk", dependencies: ["workflow-interviews", "supplier-check"], workerRole: "RISK_RESEARCHER" },
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
