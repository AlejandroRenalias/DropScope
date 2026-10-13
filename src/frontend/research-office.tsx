import { useMemo, useState, type ComponentType, type ReactNode } from "react";
import { CaretDown } from "@phosphor-icons/react/dist/csr/CaretDown";
import { Check } from "@phosphor-icons/react/dist/csr/Check";
import { Factory } from "@phosphor-icons/react/dist/csr/Factory";
import { MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { Scales } from "@phosphor-icons/react/dist/csr/Scales";
import { Target } from "@phosphor-icons/react/dist/csr/Target";
import { Warning } from "@phosphor-icons/react/dist/csr/Warning";
import type { MissionEvent } from "../contracts.js";
import type { OfficeView } from "./editorial-views.js";
import type { AgentDeskRecord, OfficeProjection } from "./office-projection.js";
import { displayResearchCopy, summarizeResearchEvent } from "./research-presentation.js";
import { defaultSelection, layoutTasks, nodeTitle, stateText, uniqueAgents, type Task } from "./research-model.js";

type Icon = ComponentType<{ size?: number; weight?: "regular" | "bold" | "fill"; "aria-hidden"?: boolean }>;

const stageNames = ["Researching", "Debating", "Reviewing", "Report"] as const;

export function roleIcon(role: string | null): Icon {
  const value = (role ?? "").toLowerCase();
  if (value.includes("evidence")) return MagnifyingGlass;
  if (value.includes("operations")) return Factory;
  if (value.includes("risk")) return Scales;
  return Target;
}

function sentence(value: string): string {
  const text = value.replaceAll("_", " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function Stepper({ projection }: { projection: OfficeProjection }) {
  const status = projection.mission.status;
  const current = status === "COMPLETED" ? stageNames.length : 0;
  return <ol className="stages" aria-label="Mission stage">
    {stageNames.map((name, index) => {
      const done = index < current;
      const on = index === current || (status === "COMPLETED" && index === stageNames.length - 1);
      const blocked = status === "BLOCKED" && index === 0;
      return <li key={name} className={`${done ? "done" : ""} ${on ? "on" : ""} ${blocked ? "blocked" : ""}`} aria-current={on ? "step" : undefined}><b>{done ? <Check size={14} weight="bold" aria-hidden /> : blocked ? <Warning size={14} weight="bold" aria-hidden /> : index + 1}</b><span>{name}{blocked ? " · policy block" : ""}</span></li>;
    })}
  </ol>;
}

export function Constellation({ tasks, selected, onSelect, working, status, snapshot = false, eyebrow = "Research constellation", title = "Task dependencies", changed }: { tasks: Task[]; selected?: string; onSelect: (id: string) => void; working: number; status: OfficeProjection["mission"]["status"]; snapshot?: boolean; eyebrow?: string; title?: string; changed?: ReadonlySet<string> }) {
  const laid = useMemo(() => layoutTasks(tasks), [tasks]);
  const positions = new Map(laid.map((item) => [item.task.id, item]));
  const edges = laid.flatMap(({ task, x, y }) => task.dependencyIds.flatMap((id) => {
    const source = positions.get(id);
    if (!source) return [];
    const x1 = source.x * 10; const y1 = source.y * 5.2; const x2 = x * 10; const y2 = y * 5.2; const mid = (x1 + x2) / 2;
    const kind = task.state === "WORKING" ? "active" : task.state === "COMPLETED" ? "done" : task.state === "BLOCKED" ? "blocked" : "pending";
    return [{ key: `${id}->${task.id}`, kind, d: `M${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}` }];
  }));
  const ordered = [...laid].sort((a, b) => a.level - b.level);
  return <div className={`constellation-body ${snapshot ? "snapshot" : ""}`}>
    <div className="stage-head">
      <div><div className="eyebrow">{eyebrow}</div><h2 className="stage-title">{title}</h2></div>
      {!snapshot && <div className="big" aria-live="polite">{status === "COMPLETED" ? <Check size={44} weight="bold" aria-hidden /> : working}<small>{status === "COMPLETED" ? "mission complete" : status === "BLOCKED" ? "policy block" : working === 1 ? "researcher working" : "researchers working in parallel"}</small></div>}
    </div>
    {laid.length === 0 ? <p className="stage-empty">No tasks are recorded in this replay yet.</p> : <>
      <div className="map" role="group" aria-label="Task dependency map">
        <svg viewBox="0 0 1000 520" preserveAspectRatio="none" aria-hidden="true"><circle cx="500" cy="260" r="190" className="ring dotted" /><circle cx="500" cy="260" r="330" className="ring" />{edges.map((edge) => <path key={edge.key} className={`edge ${edge.kind}`} d={edge.d} vectorEffect="non-scaling-stroke" />)}</svg>
        {laid.map(({ task, x, y }) => { const Mark = roleIcon(task.role); return <button type="button" key={task.id} className={`cnode ${task.state.toLowerCase()} ${selected === task.id ? "selected" : ""}`} style={{ left: `${x}%`, top: `${y}%` }} aria-pressed={selected === task.id} aria-label={`${nodeTitle(task)}: ${stateText[task.state]}${changed?.has(task.id) ? ", just changed" : ""}`} onClick={() => onSelect(task.id)}>
          <span className="cnode-mark">{task.state === "COMPLETED" ? <Check size={26} weight="bold" aria-hidden /> : task.state === "BLOCKED" ? <Warning size={24} weight="bold" aria-hidden /> : <Mark size={24} weight="bold" aria-hidden />}{changed?.has(task.id) && <span className="just-changed">just changed</span>}</span>
          <span className="cnode-copy"><small>{task.role ? "Research" : "Next checkpoint"}</small><strong>{nodeTitle(task)}</strong><em>{stateText[task.state]}{task.state === "WORKING" ? ` · ${task.cost} units` : ""}</em></span>
        </button>; })}
      </div>
      <ol className="mnodes" aria-label="Task dependencies">{ordered.map(({ task }) => <li key={task.id}><button type="button" className={`mnode ${task.state.toLowerCase()} ${selected === task.id ? "selected" : ""}`} aria-pressed={selected === task.id} onClick={() => onSelect(task.id)}><b aria-hidden="true" /><span><small>{task.role ? "Research" : "Next checkpoint"}{task.dependencyIds.length ? " · depends on earlier tasks" : ""}</small><strong>{nodeTitle(task)}</strong><em>{stateText[task.state]}{task.state === "WORKING" ? ` · ${task.cost} units` : ""}</em></span></button></li>)}</ol>
      {!snapshot && <div className="map-legend"><span>Select a node to inspect its task.</span><span><span className="key"><i /> Active dependency</span><span className="key"><i className="dashed" /> Pending dependency</span></span></div>}
    </>}
  </div>;
}

function Inspector({ task, record, onApproval }: { task?: Task; record?: AgentDeskRecord; onApproval: () => void }) {
  if (!task) return null;
  return <section className={`inspector ${task.state.toLowerCase()}`} aria-label="Selected task">
    <div className="inspector-main"><strong>{displayResearchCopy(task.label)}</strong><small>{task.role ?? "Not yet assigned"} · {stateText[task.state]}</small>{task.state === "BLOCKED" && <button className="approval-button" onClick={onApproval}>Open required approval</button>}</div>
    <dl><dt>Task ID</dt><dd className="mono">{task.id}</dd></dl>
    <dl><dt>Budget</dt><dd>{task.cost} units</dd></dl>
    <dl><dt>Depends on</dt><dd className="mono">{task.dependencyIds.length ? task.dependencyIds.join(", ") : "Starting task"}</dd></dl>
    {record && record.state === "COMPLETED" && <p className="inspector-finding"><span>Recorded finding</span>{displayResearchCopy(record.evidence)}</p>}
  </section>;
}

function Roster({ agents, onApproval }: { agents: OfficeProjection["agents"]; onApproval: () => void }) {
  return <section className="rail-card roster-card" aria-labelledby="roster-title">
    <div className="eyebrow" id="roster-title">Researchers</div>
    <ul className="roster">{agents.map((agent) => { const Mark = roleIcon(agent.role); return <li key={agent.attemptId} className={`team-member ${agent.state.toLowerCase()}`} aria-label={`${agent.role} workstation`}>
      <span className="hex"><Mark size={18} weight="bold" aria-hidden /></span>
      <div><strong>{agent.role}</strong><small>{agent.usage.units} units</small></div>
      <span className={`st ${agent.state.toLowerCase()}`}>{stateText[agent.state]}</span>
      {agent.state === "BLOCKED" && <button className="approval-button" onClick={onApproval}>Open required approval</button>}
    </li>; })}</ul>
  </section>;
}

function BudgetGauge({ ledger }: { ledger: OfficeProjection["ledger"] }) {
  const radius = 78; const circumference = 2 * Math.PI * radius;
  const total = Math.max(ledger.total, 1);
  const segments = [{ key: "spent", value: ledger.spent, color: "#1d4ed8" }, { key: "committed", value: ledger.committed, color: "#8fb0f7" }, { key: "reserved", value: ledger.reserved, color: "#cbd9fb" }];
  let offset = 0;
  return <section className="rail-card budget-card ledger-panel" aria-labelledby="budget-title">
    <div className="eyebrow" id="budget-title">Mission budget · units</div>
    <div className="gauge">
      <svg viewBox="0 0 200 200" role="img" aria-label={`${ledger.spent} spent, ${ledger.committed} committed, ${ledger.reserved} reserved, ${ledger.available} available of ${ledger.total}`}>
        <circle cx="100" cy="100" r={radius} className="gauge-track" />
        {segments.map((segment) => { const length = (segment.value / total) * circumference; const node = length > 0 ? <circle key={segment.key} cx="100" cy="100" r={radius} fill="none" stroke={segment.color} strokeWidth="18" strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-offset} /> : null; offset += length; return node; })}
      </svg>
      <div className="gauge-center"><strong>{ledger.available}</strong><span>free of {ledger.total}</span></div>
    </div>
    <div className="split"><div className="spent"><b>{ledger.spent}</b><span>Spent</span></div><div className="committed"><b>{ledger.committed}</b><span>Committed</span></div><div className="reserved"><b>{ledger.reserved}</b><span>Reserved</span></div></div>
  </section>;
}

function eventMarker(type: MissionEvent["type"]): string {
  if (type === "FindingSubmitted" || type === "MissionCompleted") return "done";
  if (type === "TaskStarted" || type === "MissionCreated") return "milestone";
  if (type.includes("Interrupt") || type.includes("Terminat") || type.includes("Fail") || type.includes("Gap")) return "alert";
  return "";
}

function Activity({ history, onReplay }: { history: MissionEvent[]; onReplay: () => void }) {
  const recent = history.slice(-5).reverse();
  return <section className="rail-card activity-card event-panel" aria-labelledby="activity-title">
    <div className="eyebrow" id="activity-title">Mission activity · recorded order</div>
    {recent.length === 0 ? <p className="rail-empty">No events recorded yet.</p> : <ul className="timeline">{recent.map((event) => <li key={event.eventId} className={`tl-item ${eventMarker(event.type)}`}><details><summary><span className="mono">Event {event.sequenceNumber} · {event.timestamp.slice(11, 16)} UTC</span><strong>{summarizeResearchEvent(event)}</strong></summary><div className="event-raw"><strong>{event.type} · {event.sequenceNumber}</strong><pre>{JSON.stringify(event.payload, null, 2)}</pre></div></details></li>)}</ul>}
    <button type="button" className="text-link" onClick={onReplay}>All events (1–{history.length}) →</button>
  </section>;
}

function FindingCard({ record, synthetic, onEvidence }: { record?: AgentDeskRecord; synthetic: boolean; onEvidence: () => void }) {
  if (!record) return <section className="finding-card empty" aria-label="Latest finding"><h3>No completed findings yet</h3><p>There are no completed research attempts in this replay.</p></section>;
  const paragraphs = (record.evidence || "No finding was recorded for this completed attempt.").split(/\n\s*\n/);
  return <article className="finding-card" aria-label="Latest finding">
    <div className="finding-top"><span>Latest finding / {record.role}</span><span className="done"><Check size={13} weight="bold" aria-hidden /> Completed</span></div>
    <div className="finding-text">{paragraphs.map((paragraph, index) => <span key={index} className={index === 0 ? (paragraph.length > 90 ? "lead long" : "lead") : undefined}>{displayResearchCopy(paragraph)}</span>)}</div>
    <p className="finding-task">{displayResearchCopy(record.task)}</p>
    <dl className="facts"><div><dt>Attempt</dt><dd className="mono">{record.attemptId}</dd></div><div><dt>Usage</dt><dd>{record.usage.units} replay units · {record.usage.status}</dd></div><div><dt>Provenance</dt><dd>{record.provenance ?? "Not recorded"}</dd></div></dl>
    <div className="finding-foot"><span className="finding-source">{synthetic ? "Synthetic demo · recorded replay" : "Recorded replay · inspect provenance"}</span><button type="button" onClick={onEvidence}>Inspect evidence →</button></div>
  </article>;
}

function Decisions({ projection, onNavigate }: { projection: OfficeProjection; onNavigate: (view: OfficeView) => void }) {
  const tribunal = projection.decisionViews.tribunalRoom;
  const review = projection.decisionViews.reviewOffice;
  return <section className="panel-card decisions" aria-labelledby="decisions-title">
    <div className="eyebrow" id="decisions-title">Recorded decisions</div>
    <ul>
      <li><div><strong>Tribunal</strong><small>{tribunal ? `Recorded at event ${tribunal.recordedAtSequence}` : "No tribunal result in this replay."}</small>{tribunal && <b>{sentence(tribunal.result.recommendation)}</b>}</div><button type="button" onClick={() => onNavigate("tribunal")}>Open</button></li>
      <li><div><strong>Blind review</strong><small>{review ? `${review.blockingFeedback.length} blocking item${review.blockingFeedback.length === 1 ? "" : "s"} · ${review.divergences.length} divergence${review.divergences.length === 1 ? "" : "s"}` : "No blind review in this replay."}</small>{review && <b>{sentence(review.result.verdict)}</b>}</div><button type="button" onClick={() => onNavigate("review")}>Open</button></li>
    </ul>
    <p className="note">These are read from recorded events. They do not change mission data or policy.</p>
  </section>;
}

function EarlierFindings({ records }: { records: AgentDeskRecord[] }) {
  if (records.length === 0) return null;
  return <section className="panel-card earlier" aria-labelledby="earlier-title">
    <div className="eyebrow" id="earlier-title">Earlier findings</div>
    {records.map((record) => <details className="finding-record" key={record.attemptId}><summary><span className="finding-copy"><strong>{displayResearchCopy(record.task)}</strong><span className="finding-text">{record.evidence.split(/\n\s*\n/).map((paragraph, index) => <span key={index}>{displayResearchCopy(paragraph)}</span>)}</span><small>{record.role}</small></span><CaretDown className="finding-caret" size={15} aria-hidden="true" /></summary><div className="finding-provenance"><dl><div><dt>Attempt</dt><dd>{record.attemptId}</dd></div><div><dt>Provenance</dt><dd>{record.provenance ?? "Not recorded"}</dd></div><div><dt>Usage</dt><dd>{record.usage.units} replay units · {record.usage.status}</dd></div></dl></div></details>)}
  </section>;
}

export function PageHead({ eyebrow, title, description, aside }: { eyebrow: string; title: string; description: string; aside?: ReactNode }) {
  return <div className="pg-head"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{aside}</div>;
}

/** Persistent cockpit: every screen keeps the mission rail, researcher roster, budget and activity visible. */
export function CommandFrame({ label, projection, history, onApproval, onNavigate, floor = false, children }: { label?: string; projection: OfficeProjection; history: MissionEvent[]; onApproval: () => void; onNavigate: (view: OfficeView) => void; floor?: boolean; children: ReactNode }) {
  const agents = uniqueAgents(projection);
  const completedTasks = projection.tasks.filter((task) => task.state === "COMPLETED").length;
  const Heading = floor ? "h1" : "h2";
  const inner = <>
    <aside className="rail left-rail" aria-label="Mission status">
      <section className="rail-card mission-card" aria-labelledby="mission-title">
        <div className="eyebrow">Mission</div>
        <Heading id="mission-title" className="mission-name">{projection.mission.name}</Heading>
        <span className={`chip ${projection.mission.status.toLowerCase()}`}>{projection.mission.phase}</span>
        <Stepper projection={projection} />
        <p className="research-completion">{completedTasks} of {projection.tasks.length} recorded tasks completed</p>
      </section>
      <Roster agents={agents} onApproval={onApproval} />
      <p className="rail-card note read-only"><strong>Read-only.</strong> This view replays recorded engine events. It cannot change mission data or policy.</p>
    </aside>
    <div className="center">{children}</div>
    <aside className="rail right-rail" aria-label="Budget and activity">
      <BudgetGauge ledger={projection.ledger} />
      <Activity history={history} onReplay={() => onNavigate("replay")} />
    </aside>
  </>;
  return label ? <section className="command-center" aria-label={label}>{inner}</section> : <div className="command-center">{inner}</div>;
}

export function ResearchOfficeCenter({ projection, agents, onApproval, onEvidence, onNavigate, synthetic }: { projection: OfficeProjection; agents: OfficeProjection["agents"]; onApproval: () => void; onEvidence: () => void; onNavigate: (view: OfficeView) => void; synthetic: boolean }) {
  const [picked, setPicked] = useState<string>();
  const taskIds = projection.tasks.map((task) => task.id);
  const selectedId = picked && taskIds.includes(picked) ? picked : defaultSelection(projection.tasks);
  const selected = projection.tasks.find((task) => task.id === selectedId);
  const records = projection.decisionViews.agentDesk.filter((record) => record.state === "COMPLETED");
  const latest = records.at(-1);
  const earlier = records.slice(0, -1);
  const working = agents.filter((agent) => agent.state === "WORKING").length;
  const selectedRecord = selected ? projection.decisionViews.agentDesk.find((record) => record.task === selected.label && record.state === "COMPLETED") : undefined;
  return <>
    <section className="stage panel-card work-graph" aria-label="Research constellation">
      <Constellation tasks={projection.tasks} selected={selectedId} onSelect={setPicked} working={working} status={projection.mission.status} />
      <Inspector task={selected} record={selectedRecord} onApproval={onApproval} />
    </section>
    <div className="below">
      <section className="finding-slot findings-panel"><FindingCard record={latest} synthetic={synthetic} onEvidence={onEvidence} /></section>
      <Decisions projection={projection} onNavigate={onNavigate} />
    </div>
    <EarlierFindings records={earlier} />
  </>;
}