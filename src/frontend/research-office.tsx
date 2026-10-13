import { useMemo, useState, type ComponentType } from "react";
import { CaretDown } from "@phosphor-icons/react/dist/csr/CaretDown";
import { Check } from "@phosphor-icons/react/dist/csr/Check";
import { Factory } from "@phosphor-icons/react/dist/csr/Factory";
import { MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { Scales } from "@phosphor-icons/react/dist/csr/Scales";
import { Target } from "@phosphor-icons/react/dist/csr/Target";
import { Warning } from "@phosphor-icons/react/dist/csr/Warning";
import type { MissionEvent } from "../contracts.js";
import type { OfficeView } from "./editorial-views.js";
import type { AgentDeskRecord, AgentState, OfficeProjection } from "./office-projection.js";
import { displayResearchCopy, summarizeResearchEvent } from "./research-presentation.js";

type Task = OfficeProjection["tasks"][number];
type Icon = ComponentType<{ size?: number; weight?: "regular" | "bold" | "fill"; "aria-hidden"?: boolean }>;

const stateText: Record<AgentState, string> = { COMPLETED: "Completed", WORKING: "Working", WAITING: "Waiting", BLOCKED: "Blocked" };
const stageNames = ["Researching", "Debating", "Reviewing", "Report"] as const;

function roleIcon(role: string | null): Icon {
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

function nodeTitle(task: Task): string {
  if (task.role) return task.role.replace(/ Researcher$/, "");
  const copy = displayResearchCopy(task.label);
  return copy.length > 26 ? `${copy.slice(0, 25)}…` : copy;
}

/** Layer tasks by dependency depth so prerequisites sit left of the work that needs them. */
export function layoutTasks(tasks: Task[]): Array<{ task: Task; level: number; x: number; y: number }> {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const levels = new Map<string, number>();
  const levelOf = (task: Task, trail: Set<string>): number => {
    const known = levels.get(task.id);
    if (known !== undefined) return known;
    if (trail.has(task.id)) return 0;
    trail.add(task.id);
    const parents = task.dependencyIds.map((id) => byId.get(id)).filter((parent): parent is Task => Boolean(parent));
    const level = parents.length ? Math.max(...parents.map((parent) => levelOf(parent, trail))) + 1 : 0;
    trail.delete(task.id);
    levels.set(task.id, level);
    return level;
  };
  tasks.forEach((task) => levelOf(task, new Set()));
  const columns = Math.max(0, ...tasks.map((task) => levels.get(task.id) ?? 0)) + 1;
  const perLevel = new Map<number, Task[]>();
  tasks.forEach((task) => { const level = levels.get(task.id) ?? 0; perLevel.set(level, [...(perLevel.get(level) ?? []), task]); });
  return tasks.map((task) => {
    const level = levels.get(task.id) ?? 0;
    const siblings = perLevel.get(level)!;
    const index = siblings.indexOf(task);
    const step = columns === 1 ? 0 : Math.min(30, 74 / (columns - 1));
    const x = 50 + (level - (columns - 1) / 2) * step;
    const y = siblings.length === 1 ? 46 : 22 + (50 * index) / (siblings.length - 1);
    return { task, level, x, y };
  });
}

function defaultSelection(tasks: Task[]): string | undefined {
  return (tasks.find((task) => task.state === "BLOCKED") ?? tasks.find((task) => task.state === "WORKING") ?? [...tasks].reverse().find((task) => task.state === "COMPLETED") ?? tasks[0])?.id;
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

function Constellation({ tasks, selected, onSelect, working, status }: { tasks: Task[]; selected?: string; onSelect: (id: string) => void; working: number; status: OfficeProjection["mission"]["status"] }) {
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
  return <div className="constellation-body">
    <div className="stage-head">
      <div><div className="eyebrow">Research constellation</div><h2 className="stage-title">Task dependencies</h2></div>
      <div className="big" aria-live="polite">{status === "COMPLETED" ? <Check size={44} weight="bold" aria-hidden /> : working}<small>{status === "COMPLETED" ? "mission complete" : status === "BLOCKED" ? "policy block" : working === 1 ? "researcher working" : "researchers working in parallel"}</small></div>
    </div>
    {laid.length === 0 ? <p className="stage-empty">No tasks are recorded in this replay yet.</p> : <>
      <div className="map" role="group" aria-label="Task dependency map">
        <svg viewBox="0 0 1000 520" preserveAspectRatio="none" aria-hidden="true"><circle cx="500" cy="260" r="190" className="ring dotted" /><circle cx="500" cy="260" r="330" className="ring" />{edges.map((edge) => <path key={edge.key} className={`edge ${edge.kind}`} d={edge.d} vectorEffect="non-scaling-stroke" />)}</svg>
        {laid.map(({ task, x, y }) => { const Mark = roleIcon(task.role); return <button type="button" key={task.id} className={`cnode ${task.state.toLowerCase()} ${selected === task.id ? "selected" : ""}`} style={{ left: `${x}%`, top: `${y}%` }} aria-pressed={selected === task.id} aria-label={`${nodeTitle(task)}: ${stateText[task.state]}`} onClick={() => onSelect(task.id)}>
          <span className="cnode-mark">{task.state === "COMPLETED" ? <Check size={26} weight="bold" aria-hidden /> : task.state === "BLOCKED" ? <Warning size={24} weight="bold" aria-hidden /> : <Mark size={24} weight="bold" aria-hidden />}</span>
          <span className="cnode-copy"><small>{task.role ? "Research" : "Next checkpoint"}</small><strong>{nodeTitle(task)}</strong><em>{stateText[task.state]}{task.state === "WORKING" ? ` · ${task.cost} units` : ""}</em></span>
        </button>; })}
      </div>
      <ol className="mnodes" aria-label="Task dependencies">{ordered.map(({ task }) => <li key={task.id}><button type="button" className={`mnode ${task.state.toLowerCase()} ${selected === task.id ? "selected" : ""}`} aria-pressed={selected === task.id} onClick={() => onSelect(task.id)}><b aria-hidden="true" /><span><small>{task.role ? "Research" : "Next checkpoint"}{task.dependencyIds.length ? " · depends on earlier tasks" : ""}</small><strong>{nodeTitle(task)}</strong><em>{stateText[task.state]}{task.state === "WORKING" ? ` · ${task.cost} units` : ""}</em></span></button></li>)}</ol>
      <div className="map-legend"><span>Select a node to inspect its task.</span><span><span className="key"><i /> Active dependency</span><span className="key"><i className="dashed" /> Pending dependency</span></span></div>
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
  const segments = [{ key: "spent", value: ledger.spent, color: "#1e3a8a" }, { key: "committed", value: ledger.committed, color: "#3b6fe0" }, { key: "reserved", value: ledger.reserved, color: "#93b4f5" }];
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

export function ResearchOffice({ projection, agents, onApproval, onEvidence, onNavigate, synthetic, history }: { projection: OfficeProjection; agents: OfficeProjection["agents"]; onApproval: () => void; onEvidence: () => void; onNavigate: (view: OfficeView) => void; synthetic: boolean; history: MissionEvent[] }) {
  const [picked, setPicked] = useState<string>();
  const taskIds = projection.tasks.map((task) => task.id);
  const selectedId = picked && taskIds.includes(picked) ? picked : defaultSelection(projection.tasks);
  const selected = projection.tasks.find((task) => task.id === selectedId);
  const records = projection.decisionViews.agentDesk.filter((record) => record.state === "COMPLETED");
  const latest = records.at(-1);
  const earlier = records.slice(0, -1);
  const working = agents.filter((agent) => agent.state === "WORKING").length;
  const completedTasks = projection.tasks.filter((task) => task.state === "COMPLETED").length;
  const selectedRecord = selected ? projection.decisionViews.agentDesk.find((record) => record.task === selected.label && record.state === "COMPLETED") : undefined;
  return <section className="command-center" aria-label="Research Office floor">
    <aside className="rail left-rail" aria-label="Mission status">
      <section className="rail-card mission-card" aria-labelledby="mission-title">
        <div className="eyebrow">Mission</div>
        <h1 id="mission-title">{projection.mission.name}</h1>
        <span className={`chip ${projection.mission.status.toLowerCase()}`}>{projection.mission.phase}</span>
        <Stepper projection={projection} />
        <p className="research-completion">{completedTasks} of {projection.tasks.length} recorded tasks completed</p>
      </section>
      <Roster agents={agents} onApproval={onApproval} />
      <p className="rail-card note read-only"><strong>Read-only.</strong> This view replays recorded engine events. It cannot change mission data or policy.</p>
    </aside>
    <main className="center">
      <section className="stage panel-card work-graph" aria-label="Research constellation">
        <Constellation tasks={projection.tasks} selected={selectedId} onSelect={setPicked} working={working} status={projection.mission.status} />
        <Inspector task={selected} record={selectedRecord} onApproval={onApproval} />
      </section>
      <div className="below">
        <section className="finding-slot findings-panel"><FindingCard record={latest} synthetic={synthetic} onEvidence={onEvidence} /></section>
        <Decisions projection={projection} onNavigate={onNavigate} />
      </div>
      <EarlierFindings records={earlier} />
    </main>
    <aside className="rail right-rail" aria-label="Budget and activity">
      <BudgetGauge ledger={projection.ledger} />
      <Activity history={history} onReplay={() => onNavigate("replay")} />
    </aside>
  </section>;
}
