import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MissionEvent } from "./contracts.js";
import { evaluationFixtureIds } from "./evaluation-baseline.js";
import { runFixtureMission } from "./fixture-runner.js";

export interface VirtualStaffingAgent {
  agentId: string;
  supportedRoles: readonly string[];
}

export interface VirtualStaffingPlan {
  planId: string;
  label: string;
  agents: readonly VirtualStaffingAgent[];
}

export const virtualStaffingRoles = ["EVIDENCE_RESEARCHER", "MARKET_RESEARCHER", "OPERATIONS_RESEARCHER", "RISK_RESEARCHER"] as const;

export const virtualStaffingPlans = [
  {
    planId: "generalist",
    label: "One generalist",
    agents: [{ agentId: "generalist-1", supportedRoles: virtualStaffingRoles }],
  },
  {
    planId: "research-operations-pair",
    label: "Research and operations-risk pair",
    agents: [
      { agentId: "research-1", supportedRoles: ["EVIDENCE_RESEARCHER", "MARKET_RESEARCHER"] },
      { agentId: "operations-risk-1", supportedRoles: ["OPERATIONS_RESEARCHER", "RISK_RESEARCHER"] },
    ],
  },
  {
    planId: "specialist-team",
    label: "Four-role specialist team",
    agents: [
      { agentId: "evidence-1", supportedRoles: ["EVIDENCE_RESEARCHER"] },
      { agentId: "market-1", supportedRoles: ["MARKET_RESEARCHER"] },
      { agentId: "operations-1", supportedRoles: ["OPERATIONS_RESEARCHER"] },
      { agentId: "risk-1", supportedRoles: ["RISK_RESEARCHER"] },
    ],
  },
] as const satisfies readonly VirtualStaffingPlan[];

export interface VirtualStaffingSummary {
  fixtureId: typeof evaluationFixtureIds[number];
  planId: typeof virtualStaffingPlans[number]["planId"];
  planLabel: string;
  virtualAgentCount: number;
  simulatedLatencyMs: number;
  terminalStatus: string;
  spent: number;
  eventCount: number;
  ranking: string[];
  reviewerVerdict: string | null;
}

interface RecordedAttempt {
  attemptId: string;
  taskId: string;
  workerRole: string;
  dependencies: string[];
  simulatedDelayMs: number;
}

function recordedAttempts(events: MissionEvent[]): RecordedAttempt[] {
  const scheduled = new Map<string, Omit<RecordedAttempt, "simulatedDelayMs">>();
  const attempts: RecordedAttempt[] = [];
  for (const event of events) {
    if (event.type === "TaskScheduled") {
      scheduled.set(event.payload.attemptId, {
        attemptId: event.payload.attemptId,
        taskId: event.payload.taskId,
        workerRole: event.payload.workerRole ?? "SIMULATED_WORKER",
        dependencies: event.payload.dependencies,
      });
    }
    if (event.type === "TaskStarted") {
      const attempt = scheduled.get(event.payload.attemptId);
      if (!attempt) throw new Error(`Virtual staffing requires a scheduled attempt for ${event.payload.attemptId}.`);
      attempts.push({ ...attempt, simulatedDelayMs: event.payload.simulatedDelayMs });
    }
  }
  return attempts;
}

export function replayVirtualStaffingLatency(events: MissionEvent[], plan: VirtualStaffingPlan): number {
  if (plan.agents.length === 0) throw new Error(`Virtual staffing plan ${plan.planId} requires at least one agent.`);
  const availability = new Map(plan.agents.map((agent) => [agent.agentId, 0]));
  const taskFinishes = new Map<string, number>();
  let lastFinish = 0;
  for (const attempt of recordedAttempts(events)) {
    const eligibleAgents = plan.agents.filter((agent) => agent.supportedRoles.includes(attempt.workerRole));
    if (eligibleAgents.length === 0) throw new Error(`Virtual staffing plan ${plan.planId} has no agent for ${attempt.workerRole}.`);
    const agent = [...eligibleAgents].sort((left, right) => (availability.get(left.agentId)! - availability.get(right.agentId)!) || left.agentId.localeCompare(right.agentId))[0]!;
    const start = Math.max(taskFinishes.get(attempt.taskId) ?? 0, availability.get(agent.agentId)!, ...(attempt.dependencies.map((dependency) => taskFinishes.get(dependency) ?? 0)));
    const finish = start + attempt.simulatedDelayMs;
    availability.set(agent.agentId, finish);
    taskFinishes.set(attempt.taskId, finish);
    lastFinish = Math.max(lastFinish, finish);
  }
  return lastFinish;
}

export async function runVirtualStaffingExperiment(): Promise<VirtualStaffingSummary[]> {
  const root = await mkdtemp(join(tmpdir(), "dropscope-staffing-evaluation-"));
  const summaries: VirtualStaffingSummary[] = [];
  for (const fixtureId of evaluationFixtureIds) {
    const result = await runFixtureMission({ fixtureId, missionId: `${fixtureId}-staffing`, historyPath: join(root, `${fixtureId}.jsonl`), maxConcurrency: 3 });
    const review = result.events.find((event) => event.type === "BlindReviewCompleted");
    for (const plan of virtualStaffingPlans) {
      summaries.push({
        fixtureId,
        planId: plan.planId,
        planLabel: plan.label,
        virtualAgentCount: plan.agents.length,
        simulatedLatencyMs: replayVirtualStaffingLatency(result.events, plan),
        terminalStatus: result.state.status,
        spent: result.state.budget.spent,
        eventCount: result.events.length,
        ranking: result.report.ranking.map(({ candidateId }) => candidateId),
        reviewerVerdict: review?.type === "BlindReviewCompleted" ? review.payload.verdict : null,
      });
    }
  }
  return summaries;
}
