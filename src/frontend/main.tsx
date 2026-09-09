import { StrictMode, useState, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { Theme } from "@radix-ui/themes";
import { Archive } from "@phosphor-icons/react/dist/csr/Archive";
import { ChartLineUp } from "@phosphor-icons/react/dist/csr/ChartLineUp";
import { CheckCircle } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { GitBranch } from "@phosphor-icons/react/dist/csr/GitBranch";
import { List } from "@phosphor-icons/react/dist/csr/List";
import { MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { Play } from "@phosphor-icons/react/dist/csr/Play";
import { ShieldCheck } from "@phosphor-icons/react/dist/csr/ShieldCheck";
import { Target } from "@phosphor-icons/react/dist/csr/Target";
import { Warning } from "@phosphor-icons/react/dist/csr/Warning";
import { Wrench } from "@phosphor-icons/react/dist/csr/Wrench";
import "@radix-ui/themes/styles.css";
import "./styles.css";
import robotRoles from "./assets/robot-roles.svg";
import { officeHistories, projectOffice, type AgentState, type OfficeScenario, type OfficeProjection } from "./office-projection.js";

type Icon = ComponentType<{ size?: number; weight?: "regular" | "bold" | "fill" }>;
const roleIcons: Record<string, Icon> = { commander: Target, evidence: MagnifyingGlass, operations: Wrench, risk: ShieldCheck };

function Robot({ id, state }: { id: string; state: AgentState }) {
  return <div className={`robot ${id} ${state.toLowerCase()}`} aria-label={`${id} robot is ${state.toLowerCase()}`}><div className="sprite"><img className="sprite-image" src={robotRoles} alt="" /></div></div>;
}

function NavItem({ icon: Icon, children, active = false }: { icon: Icon; children: string; active?: boolean }) {
  return <button className={`nav-item ${active ? "active" : ""}`} aria-current={active ? "page" : undefined}><Icon size={18} weight={active ? "fill" : "regular"} /><span>{children}</span></button>;
}

function AgentStation({ agent, onApproval }: { agent: OfficeProjection["agents"][number]; onApproval: () => void }) {
  const RoleIcon = roleIcons[agent.id] ?? Target;
  const equipment = agent.id === "commander" ? "Dispatch console · mission board" : agent.id === "evidence" ? "Scanner · evidence board" : agent.id === "operations" ? "Supplier terminal · logistics bay" : "Inspection console · safety hold";
  const isBlocked = agent.state === "BLOCKED";
  return <article className={`station ${agent.id} ${agent.state.toLowerCase()}`} aria-label={`${agent.role} workstation`}>
    <div className="station-heading"><span className="station-role"><RoleIcon size={16} />{agent.role}</span><span className="station-state"><i />{agent.state}</span></div>
    <div className="station-main"><Robot id={agent.id} state={agent.state} /><div className="station-copy"><p>{agent.task}</p>{!["Evidence work is visible.", "Operational research is visible."].includes(agent.detail) && <small>{agent.detail}</small>}{isBlocked && <button className="approval-button" onClick={onApproval}><Warning size={14} />Open required approval</button>}</div></div>
    <div className="station-equipment"><span className="equipment-visual" aria-hidden="true"><i /><i /><i /></span><span>{equipment}</span></div>
  </article>;
}

function OfficeScene({ agents, onApproval }: { agents: OfficeProjection["agents"]; onApproval: () => void }) {
  return <section className="office-scene" aria-label="Research Office floor">
    <div className="scene-caption"><span>Mission floor</span><span className="scene-rule">Workstations reflect the selected event-history replay.</span></div>
    <div className="scene-stage">
      {agents.map((agent) => <div className={`station-wrap ${agent.id}-wrap`} key={agent.id}><AgentStation agent={agent} onApproval={onApproval} /></div>)}
    </div>
  </section>;
}

function WorkGraph({ tasks }: { tasks: OfficeProjection["tasks"] }) {
  return <article className="work-graph"><div className="panel-heading"><div><span className="eyebrow"><GitBranch size={14} />Work graph</span><h2>Dependencies &amp; concurrency</h2></div><span className="legend"><i className="working" />active <i className="blocked" />blocked</span></div><div className="graph-list">{tasks.map((task, index) => <div className={`graph-row ${task.state.toLowerCase()}`} key={task.label}><span className="graph-rail"><i /></span><div className="graph-task"><strong>{task.label}</strong><small>{task.dependencies}</small></div><span className="graph-status">{task.state}</span>{index < tasks.length - 1 && <span className="graph-connector" aria-hidden="true" />}</div>)}</div></article>;
}

function MissionLedger({ projection }: { projection: OfficeProjection }) {
  return <article className="context-panel ledger-panel"><div className="panel-heading"><div><span className="eyebrow">Mission ledger</span><h2>{projection.ledger.available} units available</h2></div><span className="ledger-total">of {projection.ledger.total}</span></div><div className="ledger-bar"><i className="spent" style={{ width: `${(projection.ledger.spent / projection.ledger.total) * 100}%` }} /><i className="committed" style={{ width: `${(projection.ledger.committed / projection.ledger.total) * 100}%` }} /><i className="reserved" style={{ width: `${(projection.ledger.reserved / projection.ledger.total) * 100}%` }} /></div><div className="ledger-key"><span><i className="spent" />spent {projection.ledger.spent}</span><span><i className="committed" />committed {projection.ledger.committed}</span><span><i className="reserved" />reserved {projection.ledger.reserved}</span></div><dl className="ledger-list">{Object.entries(projection.ledger).filter(([key]) => key !== "total").map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl></article>;
}

function EventTrail({ projection, reduced, setReduced }: { projection: OfficeProjection; reduced: boolean; setReduced: (value: boolean) => void }) {
  return <article className="context-panel event-panel"><div className="panel-heading"><div><span className="eyebrow"><List size={14} />Event trail</span><h2>Recent activity</h2></div><button className="motion-button" onClick={() => setReduced(!reduced)}>{reduced ? "Motion off" : "Reduce motion"}</button></div><div className="event-list">{projection.events.map((event) => <div className="event" key={event.sequence}><b>{String(event.sequence).padStart(2, "0")}</b><span><strong>{event.type}</strong><small>{event.detail}</small></span></div>)}</div></article>;
}

function Office() {
  const [scenario, setScenario] = useState<OfficeScenario>("RUNNING");
  const [reduced, setReduced] = useState(false);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const projection = projectOffice(officeHistories[scenario]);
  const status = projection.mission.status;
  const StatusIcon = status === "BLOCKED" ? Warning : status === "COMPLETED" ? CheckCircle : Play;
  const workingAgents = projection.agents.filter((agent) => agent.state === "WORKING").length;
  const floorStatus = status === "BLOCKED" ? "Policy block" : status === "COMPLETED" ? "Mission complete" : "Replay running";

  return <div className={`app ${reduced ? "reduced" : ""}`}>
    <header className="topbar"><div className="brand"><b>D</b><span>DropScope</span><em>RESEARCH OS</em></div><div className="topbar-mission"><span>MISSION</span><strong>{projection.mission.name}</strong></div></header>
    <div className="shell">
      <aside className="sidebar"><div className="sidebar-label">Workspace</div><nav aria-label="Primary navigation"><NavItem icon={Play} active>Research Office</NavItem><NavItem icon={Archive}>Mission Replay</NavItem><NavItem icon={ShieldCheck}>Review Office</NavItem><NavItem icon={ChartLineUp}>Reports</NavItem></nav><div className="sidebar-foot"><span className="online-dot" />Static event replay<small>Read-only projection</small></div></aside>
      <main className="content">
        <section className="page-heading"><div><div className="heading-kicker"><span>Mission</span><strong>{projection.mission.name}</strong><span className={`mission-status ${status.toLowerCase()}`}><StatusIcon size={14} />{projection.mission.phase}</span></div><p className="source-note" title={projection.sourceLabel}>{projection.sourceLabel}</p></div><div className="scenario-switcher" role="group" aria-label="Replay state"><span>Replay state</span>{(Object.keys(officeHistories) as OfficeScenario[]).map((name) => <button className={scenario === name ? "selected" : ""} onClick={() => { setScenario(name); setApprovalOpen(false); }} key={name}>{name}</button>)}</div></section>
        <div className="floor-status"><span className="eyebrow"><span className="live-dot" />{floorStatus}</span><span>{projection.agents.length} assigned workers · {workingAgents} active</span></div>
        <OfficeScene agents={projection.agents} onApproval={() => setApprovalOpen((value) => !value)} />
        {approvalOpen && status === "BLOCKED" && <div className="approval-note" role="status"><Warning size={16} /><span><strong>Policy block</strong> This replay stopped with unresolved safety evidence. This local disclosure does not change mission data or policy.</span></div>}
        <section className="lower-layout"><WorkGraph tasks={projection.tasks} /><div className="context-stack"><MissionLedger projection={projection} /><EventTrail projection={projection} reduced={reduced} setReduced={setReduced} /></div></section>
      </main>
    </div>
  </div>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><Theme appearance="dark" accentColor="cyan" grayColor="slate" radius="small"><Office /></Theme></StrictMode>);
