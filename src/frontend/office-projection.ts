export type OfficeScenario = "RUNNING" | "BLOCKED" | "COMPLETED";
export type AgentState = "WORKING" | "WAITING" | "BLOCKED" | "COMPLETED";

export interface OfficeProjection {
  sourceLabel: string;
  mission: { name: string; phase: string; status: OfficeScenario };
  ledger: { total: number; reserved: number; committed: number; spent: number; available: number };
  agents: Array<{ id: string; role: string; state: AgentState; task: string; detail: string }>;
  tasks: Array<{ label: string; state: AgentState; dependencies: string }>;
  events: Array<{ sequence: number; type: string; detail: string }>;
}

const sourceLabel = "Representative projection shaped from mission, task, budget, and event contracts. It is not live engine data yet.";
const agents = (states: AgentState[]): OfficeProjection["agents"] => [
  { id: "commander", role: "Commander", state: states[0]!, task: "Coordinating the research graph", detail: "Two specialists can work in parallel." },
  { id: "evidence", role: "Evidence researcher", state: states[1]!, task: "Workflow interviews", detail: "Evidence work is visible." },
  { id: "operations", role: "Operations researcher", state: states[2]!, task: "Supplier feasibility", detail: "Operational research is visible." },
  { id: "risk", role: "Safety reviewer", state: states[3]!, task: "Crosscurrent risk review", detail: "Depends on the previous findings." },
];

export const officeScenarios: Record<OfficeScenario, OfficeProjection> = {
  RUNNING: { sourceLabel, mission: { name: "Crosscurrent Workspace Market", phase: "Research in progress", status: "RUNNING" }, ledger: { total: 140, reserved: 25, committed: 50, spent: 25, available: 40 }, agents: agents(["WORKING", "WORKING", "WORKING", "WAITING"]), tasks: [{ label: "Workspace market scan", state: "COMPLETED", dependencies: "Starting task" }, { label: "Workflow interviews", state: "WORKING", dependencies: "After market scan" }, { label: "Supplier feasibility", state: "WORKING", dependencies: "After market scan" }, { label: "Crosscurrent risk review", state: "WAITING", dependencies: "After both active tasks" }], events: [{ sequence: 7, type: "TaskStarted", detail: "Workflow interviews started." }, { sequence: 8, type: "TaskStarted", detail: "Supplier feasibility started." }, { sequence: 9, type: "BudgetCommitted", detail: "In-flight work is accounted for." }] },
  BLOCKED: { sourceLabel, mission: { name: "Crosscurrent Workspace Market", phase: "Research needs attention", status: "BLOCKED" }, ledger: { total: 140, reserved: 0, committed: 25, spent: 75, available: 40 }, agents: agents(["WORKING", "WORKING", "COMPLETED", "BLOCKED"]), tasks: [{ label: "Workspace market scan", state: "COMPLETED", dependencies: "Starting task" }, { label: "Workflow interviews", state: "WORKING", dependencies: "Unrelated work continues" }, { label: "Supplier feasibility", state: "COMPLETED", dependencies: "Finding submitted" }, { label: "Crosscurrent risk review", state: "BLOCKED", dependencies: "Needs resolution" }], events: [{ sequence: 11, type: "TaskInterrupted", detail: "Risk review requires recovery." }, { sequence: 12, type: "GapOpened", detail: "Safety evidence remains unresolved." }, { sequence: 13, type: "TaskStarted", detail: "Workflow interviews continue." }] },
  COMPLETED: { sourceLabel, mission: { name: "Crosscurrent Workspace Market", phase: "Report ready", status: "COMPLETED" }, ledger: { total: 140, reserved: 0, committed: 0, spent: 100, available: 40 }, agents: agents(["COMPLETED", "COMPLETED", "COMPLETED", "COMPLETED"]), tasks: [{ label: "Workspace market scan", state: "COMPLETED", dependencies: "Complete" }, { label: "Workflow interviews", state: "COMPLETED", dependencies: "Complete" }, { label: "Supplier feasibility", state: "COMPLETED", dependencies: "Complete" }, { label: "Crosscurrent risk review", state: "COMPLETED", dependencies: "Held-out outcomes recorded" }], events: [{ sequence: 18, type: "RiskGateDecided", detail: "Held-out candidates remain visible." }, { sequence: 19, type: "ReportPublished", detail: "Three allowed candidates ranked." }, { sequence: 20, type: "MissionCompleted", detail: "Replay remains available." }] },
};
