import { useEffect, useRef, useState, type ComponentType } from "react";
import { Archive } from "@phosphor-icons/react/dist/csr/Archive";
import { CaretDown } from "@phosphor-icons/react/dist/csr/CaretDown";
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
import robotRoles from "./assets/robot-roles.svg";
import { GoogleTrendsComparisonTimeline } from "./google-trends-comparison-timeline.js";
import {
  officeHistories,
  projectFinalReport,
  projectOffice,
  replayEvents,
  type AgentState,
  type OfficeProjection,
  type OfficeScenario,
  type ReplayEventCategory,
} from "./office-projection.js";
import type { LocalMissionDto, SubscriptionConfirmationDto } from "./runtime-client.js";
import { displayResearchCopy, summarizeResearchEvent } from "./research-presentation.js";
import type { MissionEvent } from "../contracts.js";

export type OfficeView = "floor" | "agent" | "tribunal" | "review" | "report" | "replay";
type Icon = ComponentType<{ size?: number; weight?: "regular" | "bold" | "fill" }>;

const navigation: Array<{ view: OfficeView; label: string; icon: Icon }> = [
  { view: "floor", label: "Research Office", icon: Play },
  { view: "agent", label: "Agent Desk", icon: Target },
  { view: "tribunal", label: "Tribunal Room", icon: ShieldCheck },
  { view: "review", label: "Review Office", icon: Archive },
  { view: "report", label: "Final Report", icon: ChartLineUp },
  { view: "replay", label: "Mission Replay", icon: List },
];

const roleIcons: Record<string, Icon> = {
  commander: Target,
  evidence: MagnifyingGlass,
  operations: Wrench,
  risk: ShieldCheck,
};

export function WorkspaceNavigation({ view, onChange }: { view: OfficeView; onChange: (view: OfficeView) => void }) {
  return <nav className="workspace-nav" aria-label="Primary navigation">
    {navigation.map(({ view: target, label, icon: Icon }) => <button aria-label={label} className={view === target ? "active" : ""} onClick={() => onChange(target)} aria-current={view === target ? "page" : undefined} key={target}><span className="nav-icon" aria-hidden="true"><Icon size={17} weight={view === target ? "fill" : "regular"} /></span><span className="nav-label">{label}</span></button>)}
  </nav>;
}

function Robot({ id, state }: { id: string; state: AgentState }) {
  return <div className={`robot ${id} ${state.toLowerCase()}`} aria-label={`${id} robot is ${state.toLowerCase()}`}><div className="sprite"><img className="sprite-image" src={robotRoles} alt="" /></div></div>;
}

function StateLabel({ state }: { state: AgentState | OfficeProjection["mission"]["status"] }) {
  return <span className={`state-label ${state.toLowerCase()}`}>{state}</span>;
}

function WorkGraph({ tasks }: { tasks: OfficeProjection["tasks"] }) {
  return <section className="work-graph" aria-labelledby="work-graph-title">
    <div className="surface-heading"><div><GitBranch size={16} /><h2 id="work-graph-title">Dependencies and concurrency</h2></div><span>{tasks.length} recorded tasks</span></div>
    <div className="graph-list">{tasks.map((task, index) => <div className={`graph-row ${task.state.toLowerCase()}`} key={task.label}><span className="graph-index">{String(index + 1).padStart(2, "0")}</span><div className="graph-task"><strong>{displayResearchCopy(task.label)}</strong><small>{task.dependencies}</small></div><StateLabel state={task.state} /></div>)}</div>
  </section>;
}

function MissionLedger({ projection }: { projection: OfficeProjection }) {
  const entries = Object.entries(projection.ledger).filter(([key]) => key !== "total");
  return <section className="context-panel ledger-panel" aria-labelledby="ledger-title">
    <div className="surface-heading"><div><h2 id="ledger-title">Mission ledger</h2></div><span>{projection.ledger.total} total</span></div>
    <strong className="ledger-available">{projection.ledger.available}<small> units available</small></strong>
    <div className="ledger-measure" aria-label={`${projection.ledger.spent} spent, ${projection.ledger.committed} committed, ${projection.ledger.reserved} reserved`}><i className="spent" style={{ width: `${(projection.ledger.spent / projection.ledger.total) * 100}%` }} /><i className="committed" style={{ width: `${(projection.ledger.committed / projection.ledger.total) * 100}%` }} /><i className="reserved" style={{ width: `${(projection.ledger.reserved / projection.ledger.total) * 100}%` }} /></div>
    <dl className="ledger-list">{entries.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
  </section>;
}

function EventTrail({ history }: { history: MissionEvent[] }) {
  const events = history.slice(-3).reverse();
  return <section className="context-panel event-panel" aria-labelledby="event-trail-title">
    <div className="surface-heading"><div><h2 id="event-trail-title">Recent activity</h2></div><span>Newest first</span></div>
    <div className="event-list">{events.map((event) => <details className="event" key={event.eventId}><summary><span><strong>{summarizeResearchEvent(event)}</strong></span><CaretDown size={14} aria-hidden="true" /></summary><div className="event-raw"><strong>{event.type} · {event.sequenceNumber}</strong><pre>{JSON.stringify(event.payload, null, 2)}</pre></div></details>)}</div>
  </section>;
}

export function ResearchOffice({ projection, agents, onApproval, onEvidence, synthetic, history }: { projection: OfficeProjection; agents: OfficeProjection["agents"]; onApproval: () => void; onEvidence: () => void; reduced: boolean; setReduced: (value: boolean) => void; synthetic: boolean; history: MissionEvent[] }) {
  const [activeTab, setActiveTab] = useState<"findings" | "dependencies">("findings");
  const completed = projection.decisionViews.agentDesk.filter((record) => record.state === "COMPLETED");
  const pending = agents.filter((agent) => agent.state === "WORKING" || agent.state === "WAITING" || agent.state === "BLOCKED");
  const completedTasks = projection.tasks.filter((task) => task.state === "COMPLETED").length;
  const tabs = ["findings", "dependencies"] as const;
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectTab = (tab: typeof tabs[number]) => setActiveTab(tab);
  const onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const current = tabs.indexOf(activeTab);
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const next = (current + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
      selectTab(tabs[next]);
      tabRefs.current[next]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const next = event.key === "Home" ? 0 : tabs.length - 1;
      selectTab(tabs[next]);
      tabRefs.current[next]?.focus();
    }
  };
  return <section className="office-layout research-workspace" aria-label="Research Office floor">
    <div className="dossier">
      <div className="dossier-tabs" role="tablist" aria-label="Research dossier views">
        {tabs.map((tab, index) => <button ref={(node) => { tabRefs.current[index] = node; }} className="dossier-tab" key={tab} id={`dossier-tab-${tab}`} role="tab" aria-selected={activeTab === tab} aria-controls={`dossier-panel-${tab}`} tabIndex={activeTab === tab ? 0 : -1} onClick={() => selectTab(tab)} onKeyDown={onTabKeyDown}>{tab === "findings" ? "Findings" : "Dependencies"}</button>)}
        <button className="inspect-evidence" onClick={onEvidence}>Inspect evidence</button>
      </div>
      <section id="dossier-panel-findings" className="findings-panel" role="tabpanel" aria-labelledby="dossier-tab-findings" hidden={activeTab !== "findings"}>
        {completed.length ? completed.map((record) => <details className="finding-record" key={record.attemptId}><summary><CheckCircle size={18} aria-hidden="true" /><span className="finding-copy"><strong>{displayResearchCopy(record.task)}</strong><span className="finding-text">{(record.evidence || "No finding was recorded for this completed attempt.").split(/\n\s*\n/).map((paragraph, index) => <span key={index}>{displayResearchCopy(paragraph)}</span>)}</span><small>{record.role}</small><small className="finding-source">{synthetic ? "Synthetic demo · recorded replay" : "Recorded replay · inspect provenance"}</small></span><CaretDown className="finding-caret" size={15} aria-hidden="true" /></summary><div className="finding-provenance"><dl><div><dt>Attempt</dt><dd>{record.attemptId}</dd></div><div><dt>Provenance</dt><dd>{record.provenance ?? "Not recorded"}</dd></div><div><dt>Usage</dt><dd>{record.usage.units} replay units · {record.usage.status}</dd></div></dl></div></details>) : <div className="research-empty"><h3>No completed findings yet</h3><p>There are no completed research attempts in this replay.</p></div>}
        {pending.length > 0 && <section className="pending-research"><h3>Still being researched</h3>{pending.map((agent) => <article className={`pending-row ${agent.state.toLowerCase()}`} key={agent.attemptId}><div className="pending-task"><strong>{displayResearchCopy(agent.task)}</strong>{agent.detail !== "Assigned through replay." && agent.detail && <small>{displayResearchCopy(agent.detail)}</small>}</div><StateLabel state={agent.state} />{agent.state === "BLOCKED" && <button className="approval-button" onClick={onApproval}>Open required approval</button>}</article>)}</section>}
      </section>
      <section id="dossier-panel-dependencies" className="dependency-panel" role="tabpanel" aria-labelledby="dossier-tab-dependencies" hidden={activeTab !== "dependencies"}><WorkGraph tasks={projection.tasks} /></section>
    </div>
    <aside className="office-context activity-rail" aria-label="Mission context">
      <section className="team-panel"><header className="surface-heading"><div><h2>Team activity</h2></div><span>{agents.length} researchers</span></header>{agents.map((agent) => <details className={`team-member ${agent.state.toLowerCase()}`} key={agent.attemptId} aria-label={`${agent.role} workstation`}><summary><span>{agent.role}</span><StateLabel state={agent.state} /><CaretDown className="team-caret" size={14} aria-hidden="true" /></summary><div className="team-member-detail"><Robot id={agent.id} state={agent.state} /><strong>{displayResearchCopy(agent.task)}</strong>{agent.detail !== "Assigned through replay." && agent.detail && <p>{displayResearchCopy(agent.detail)}</p>}{agent.state === "BLOCKED" && <button className="approval-button" onClick={onApproval}>Open required approval</button>}</div></details>)}</section>
      <div className="research-completion">{completedTasks} of {projection.tasks.length} recorded tasks completed</div>
      <details className="office-detail"><summary>Mission ledger <span>{projection.ledger.available} units available</span></summary><MissionLedger projection={projection} /></details>
      <EventTrail history={history} />
    </aside>
  </section>;
}

function subscriptionAccessCopy(runtime: NonNullable<OfficeProjection["decisionViews"]["subscriptionRuntime"]>): string {
  const { access, diagnosticCode } = runtime;
  if (access === "LOCAL_CHATGPT_AUTHENTICATED") return "Local ChatGPT authentication detected. This does not authorize a worker run.";
  if (access === "LOCAL_AUTHENTICATION_REQUIRED") return "Local ChatGPT authentication is required. No login was started.";
  if (access === "LOCAL_UNSUPPORTED_AUTH_MODE") return "Local runtime authentication is not a ChatGPT subscription. No worker was started.";
  if (diagnosticCode === "APP_SERVER_START_FAILED") return "Codex app-server could not start locally. Check that codex --version works in this terminal, then launch a new pilot. No worker was started.";
  if (diagnosticCode === "APP_SERVER_EXITED_DURING_INITIALIZATION") return "Codex app-server exited before replying to DropScope's setup request. No worker was started.";
  if (diagnosticCode === "INITIALIZATION_REJECTED") return "Codex app-server rejected DropScope's setup request. No worker was started.";
  if (diagnosticCode === "INITIALIZATION_RESPONSE_INVALID") return "Codex app-server returned a setup response DropScope could not safely recognize. No worker was started.";
  if (diagnosticCode === "INITIALIZATION_TIMED_OUT") return "Codex app-server did not finish setup within 10 seconds. No worker was started.";
  if (diagnosticCode === "INITIALIZATION_FAILED") return "Codex app-server ended during setup. No worker was started.";
  if (diagnosticCode === "ACCOUNT_READ_TIMED_OUT") return "Codex app-server started, but did not return account status within 10 seconds. No worker was started.";
  if (diagnosticCode === "ACCOUNT_READ_FAILED") return "Codex app-server could not complete the read-only account-status check. No worker was started.";
  if (diagnosticCode === "ACCOUNT_RESPONSE_INVALID") return "Codex app-server returned account status that DropScope could not safely recognize. No worker was started.";
  if (access === "LOCAL_RUNTIME_UNAVAILABLE") return "Local subscription runtime is unavailable. No worker was started.";
  return "Local subscription access not checked.";
}

export interface DecisionViewProps {
  projection: OfficeProjection;
  view: OfficeView;
  onSubscriptionPreflight?: () => void;
  subscriptionPreflightLoading: boolean;
  onSubscriptionConfirmation?: () => void;
  subscriptionConfirmationLoading: boolean;
  onSubscriptionRun?: () => void;
  subscriptionRunLoading: boolean;
  subscriptionConfirmation?: SubscriptionConfirmationDto;
  subscriptionConfirmationEligible: boolean;
  onGoogleTrendsCapture?: () => void;
  googleTrendsCaptureLoading: boolean;
  googleTrendsCaptureEligible: boolean;
  onGoogleTrendsComparisonImport?: (file: File) => void;
  googleTrendsComparisonImportLoading: boolean;
  googleTrendsComparisonImportEligible: boolean;
}

function SectionHeader({ title, description, aside }: { title: string; description: string; aside?: React.ReactNode }) {
  return <header className="view-header"><div><h1>{title}</h1><p>{description}</p></div>{aside}</header>;
}

export function DecisionView(props: DecisionViewProps) {
  const { projection, view } = props;
  if (view === "floor") return null;
  if (view === "agent") {
    const runtime = projection.decisionViews.subscriptionRuntime;
    const hasActions = Boolean(props.googleTrendsCaptureEligible || projection.decisionViews.googleTrendsEvidence || props.googleTrendsComparisonImportEligible || projection.decisionViews.googleTrendsComparisonEvidence || runtime);
    return <section className="decision-view agent-view" aria-label="Agent Desk">
      <SectionHeader title="Worker evidence and usage" description="Inspect source provenance, guarded actions, and recorded worker outcomes." />
      <div className={`agent-workspace ${hasActions ? "" : "evidence-only"}`}>
        <section className="action-column" aria-labelledby="action-column-title">
          <header className="surface-heading"><div><span>Available operations</span><h2 id="action-column-title">Action rail</h2></div><small>Explicit, bounded, local</small></header>
          {(props.googleTrendsCaptureEligible || projection.decisionViews.googleTrendsEvidence) && <article className="action-block"><span className="action-type">Public source</span><strong>Google Trends · read-only public-source pilot</strong><p>One fixed US Trending Now RSS request. No login, worker, retry, or subscription usage.</p><small>Results are a sampled, normalized signal, not demand or a sales estimate. The captured labels and traffic buckets become local event history.</small>{projection.decisionViews.googleTrendsEvidence && <small>Captured source: {projection.decisionViews.googleTrendsEvidence.sourceUrl} · {projection.decisionViews.googleTrendsEvidence.geo} · retrieved {new Date(projection.decisionViews.googleTrendsEvidence.retrievedAt).toLocaleString()} · attribution: {projection.decisionViews.googleTrendsEvidence.attribution}.</small>}{props.onGoogleTrendsCapture && <button onClick={props.onGoogleTrendsCapture} disabled={props.googleTrendsCaptureLoading || !props.googleTrendsCaptureEligible}>{props.googleTrendsCaptureLoading ? "Capturing Google Trends…" : props.googleTrendsCaptureEligible ? "Capture Google Trends US now" : "Google Trends capture recorded"}</button>}</article>}
          {(props.googleTrendsComparisonImportEligible || projection.decisionViews.googleTrendsComparisonEvidence) && <article className="action-block"><span className="action-type">Manual context</span><strong>Google Trends · manual comparison context</strong><p>Import only the approved US / Web Search / past-12-month Interest over time CSV for desk cable organizer, under-desk cable tray, and cable management box.</p><small>DropScope never contacts Google, stores the raw CSV, runs a worker, retries, polls, or uses a subscription. The validated timeline is local context only: it changes no score, ranking, gate, or recommendation.</small>{projection.decisionViews.googleTrendsComparisonEvidence && <small>Imported {projection.decisionViews.googleTrendsComparisonEvidence.granularity.toLowerCase()} timeline: {projection.decisionViews.googleTrendsComparisonEvidence.periods.length} periods · {projection.decisionViews.googleTrendsComparisonEvidence.geo} · {projection.decisionViews.googleTrendsComparisonEvidence.attribution} · {new Date(projection.decisionViews.googleTrendsComparisonEvidence.importedAt).toLocaleString()}.</small>}<GoogleTrendsComparisonTimeline evidence={projection.decisionViews.googleTrendsComparisonEvidence} />{props.onGoogleTrendsComparisonImport && <label className="file-control">Choose exported CSV<input aria-label="Choose Google Trends comparison CSV" type="file" accept=".csv,text/csv" disabled={props.googleTrendsComparisonImportLoading || !props.googleTrendsComparisonImportEligible} onChange={(event) => { const file = event.currentTarget.files?.item(0); event.currentTarget.value = ""; if (file) props.onGoogleTrendsComparisonImport?.(file); }} /></label>}</article>}
          {runtime && <article className="action-block guarded-action"><span className="action-type">Guarded runtime</span><strong>Subscription runtime · guarded pilot</strong><p>{subscriptionAccessCopy(runtime)}</p><small>Subscription usage not itemized.</small>{props.onSubscriptionPreflight && <button onClick={props.onSubscriptionPreflight} disabled={props.subscriptionPreflightLoading || runtime.access !== "LOCAL_SUBSCRIPTION_NOT_CHECKED"}>{props.subscriptionPreflightLoading ? "Checking subscription runtime…" : "Check subscription runtime"}</button>}<div className="action-divider" /><strong>First live worker · approval required</strong><p>One fresh thread · {runtime.firstLiveWorker.maximumTurns === 1 ? "one" : runtime.firstLiveWorker.maximumTurns} turn · {runtime.firstLiveWorker.timeoutMs / 1_000}-second maximum · inline fixed pilot evidence · read-only mode · network denied · no retry.</p><small>Confirmation is one-use, stays only in local runtime memory, and expires after {runtime.firstLiveWorker.confirmationTtlMs / 1_000} seconds.</small><small>Any command, file-change, or permission request is automatically declined and ends the run. No request is accepted automatically.</small>{props.subscriptionConfirmationEligible && props.onSubscriptionConfirmation && <button onClick={props.onSubscriptionConfirmation} disabled={props.subscriptionConfirmationLoading || props.subscriptionRunLoading || runtime.access !== "LOCAL_CHATGPT_AUTHENTICATED"}>{props.subscriptionConfirmationLoading ? "Confirming locally…" : "Confirm one live worker"}</button>}{props.subscriptionConfirmation && <small role="status">Confirmation status: confirmed locally · expires at {new Date(props.subscriptionConfirmation.expiresAtMs).toLocaleTimeString()}.</small>}{props.subscriptionConfirmationEligible && props.onSubscriptionRun && <button onClick={props.onSubscriptionRun} disabled={props.subscriptionRunLoading || !props.subscriptionConfirmation || props.subscriptionConfirmation.expiresAtMs <= Date.now() || runtime.access !== "LOCAL_CHATGPT_AUTHENTICATED"}>{props.subscriptionRunLoading ? "Running one live worker…" : "Run one live worker now"}</button>}{runtime.lastWorkerOutcome && <small>Last subscription worker outcome: {runtime.lastWorkerOutcome.outcome} · provider usage unknown · {runtime.lastWorkerOutcome.elapsedMs} ms.</small>}</article>}
        </section>
        <section className="evidence-ledger" aria-labelledby="evidence-ledger-title"><header className="surface-heading"><div><span>Event-derived record</span><h2 id="evidence-ledger-title">Recorded evidence</h2></div><small>{projection.decisionViews.agentDesk.length} worker attempts</small></header>{projection.decisionViews.missionUsageSummary && <article className="usage-summary"><strong>Mission usage summary · recorded dry-run provenance</strong><p>Recorded dry-run count: {projection.decisionViews.missionUsageSummary.dryRunCount}</p><small>Recorded dry-run provider usage: not applicable · other attempt provenance: {projection.decisionViews.missionUsageSummary.unrecordedAttemptCount} not recorded</small><small>Mission ledger: {projection.decisionViews.missionUsageSummary.total} total · {projection.decisionViews.missionUsageSummary.reserved} reserved · {projection.decisionViews.missionUsageSummary.committed} committed · {projection.decisionViews.missionUsageSummary.spent} spent · {projection.decisionViews.missionUsageSummary.available} available</small></article>}<div className="agent-records">{projection.decisionViews.agentDesk.map((agent) => <article className="agent-record" key={agent.attemptId}><div><strong>{agent.role}</strong><StateLabel state={agent.state} /></div><span>{agent.task}</span><p>{agent.evidence}</p>{agent.provenance === "RECORDED_DRY_RUN" && <small>Recorded dry-run · no live worker or credits used</small>}<small>Replay usage: {agent.usage.units} units · {agent.usage.status}</small></article>)}</div></section>
      </div>
    </section>;
  }
  if (view === "tribunal") {
    const room = projection.decisionViews.tribunalRoom;
    return <section className="decision-view tribunal-view" aria-label="Tribunal Room"><SectionHeader title="Recorded policy result" description="Compare the venture case, ruin case, and deterministic recommendation." />{room ? <><div className="verdict-banner"><span>Recorded recommendation</span><strong>{room.result.recommendation}</strong><small>Candidate {room.result.candidateId} · sequence {room.recordedAtSequence}</small></div><div className="tribunal-columns"><article className="claim-column venture-claim"><span>Argument 01</span><h2>Venture case</h2><p>{room.result.ventureClaimIds.join(", ") || "No venture claims recorded."}</p></article><article className="claim-column ruin-claim"><span>Argument 02</span><h2>Ruin case</h2><p>{room.result.ruinClaimIds.join(", ") || "No ruin claims recorded."}</p></article></div><section className="reason-record"><span>Decision basis</span><h2>Recorded reasoning</h2><p>{room.result.reasons.map((reason) => reason.explanation).join(" ")}</p></section></> : <EmptyState title="No tribunal result" copy="No TribunalCompleted event in this replay." />}</section>;
  }
  const office = projection.decisionViews.reviewOffice;
  return <section className="decision-view review-view" aria-label="Review Office"><SectionHeader title="Blind review record" description="Reviewer ranking, blocking feedback, divergence, and revision response." aside={office && <span className="review-verdict"><small>Recorded verdict</small>{office.result.verdict}</span>} />{office ? <><div className="review-sheet-heading"><span>Rank</span><span>Candidate assessment</span><span>Score</span></div><div className="assessment-list">{office.result.candidateAssessments.map((assessment) => <article className="assessment-row" key={assessment.anonymizedCandidateId}><span className="assessment-rank">{String(office.result.ranking.indexOf(assessment.anonymizedCandidateId) + 1).padStart(2, "0")}</span><div className="assessment-main"><h2>{assessment.anonymizedCandidateId}</h2><dl className="dimension-list">{Object.entries(assessment.dimensionScores).map(([dimension, score]) => <div key={dimension}><dt>{dimension}</dt><dd>{score}</dd></div>)}</dl><p>Blocking feedback: {[...assessment.blockingDefects, ...assessment.missingResearchKeys].join(", ") || "none"}</p>{office.divergences.length > 0 ? <small>Divergences: {office.divergences.join(" · ")}</small> : <small>Divergences: none recorded in this replay.</small>}{office.revisionResponse && <small>{office.revisionResponse}</small>}</div><strong className="assessment-score">{assessment.reviewerScore}<small>score</small></strong></article>)}</div></> : <EmptyState title="No blind review" copy="No BlindReviewCompleted event in this replay." />}</section>;
}

function EmptyState({ title, copy }: { title: string; copy: string }) {
  return <section className="empty-state"><strong>{title}</strong><p>{copy}</p></section>;
}

export function FinalReport({ events, fixtureId }: { events?: LocalMissionDto["events"]; fixtureId?: string }) {
  const report = projectFinalReport(events, fixtureId);
  const title = report.autopsy ? "Failure Autopsy" : report.investigation ? "Product Investigation" : "Recorded opportunity priorities";
  return <section className="decision-view report-view" aria-label="Final Report">
    <header className="report-masthead"><div><span>Final report</span><h1>{title}</h1><p>{report.sourceLabel}</p></div><strong className={`report-outcome ${report.outcome.toLowerCase()}`}>{report.outcome.replaceAll("_", " ")}</strong></header>
    <div className="report-metrics"><div><span>Customer problem</span><strong>{report.customerProblemEvidence}<small>/100</small></strong></div><div><span>Evidence quality</span><strong>{report.evidenceQuality}<small>/100</small></strong></div><div><span>Ad saturation</span><strong>{report.advertisingSaturation}<small>/100</small></strong></div><div><span>Operational risk</span><strong>{report.operationalRisk}<small>/100</small></strong></div><div><span>Failure risk</span><strong>{report.failureRisk}<small>/100</small></strong></div><div><span>Safety / gate</span><strong>{report.safetyGate}</strong></div></div>
    <div className="report-lead"><article className="priority-sheet"><span className="report-section-index">01 / Priority order</span><h2>Top priorities</h2>{report.priorities.length ? <ol>{report.priorities.slice(0, 5).map((candidate) => <li key={candidate.candidateId}><span>{candidate.candidateId}</span><b>{candidate.researchPriorityScore}</b></li>)}</ol> : <p>None cleared the recorded evidence gates.</p>}</article><article className="held-out-sheet"><span className="report-section-index">02 / Exclusions</span><h2>Held-out reasons</h2>{report.heldOut.length ? <ul>{report.heldOut.map((candidate) => <li key={candidate.candidateId}><span>{candidate.candidateId}</span><small>{candidate.reasonCodes.join(", ")}</small></li>)}</ul> : <p>No held-out candidates in this report.</p>}</article><aside className="review-stamp"><span className="report-section-index">Recorded review</span><strong>{report.reviewerVerdict}</strong><p>The verdict is read from the existing replay review event.</p></aside></div>
    {report.autopsy && <ReportContext title="What would change this conclusion" copy={report.autopsy.conclusion} items={report.autopsy.evidenceThatCouldChangeConclusion} />}
    {report.investigation && <ReportContext title="Automatic failure-autopsy pressure" copy={report.investigation.autopsyConclusion} items={report.investigation.opposingEvidence} />}
    {report.externalSignalContext && <ReportContext title="External signal context · not scored" copy="Google Trends US Trending Now is a sampled, normalized search-interest snapshot. It does not change any score, ranking, gate, or recommendation in this report." note={`Source: ${report.externalSignalContext.sourceUrl} · retrieved ${new Date(report.externalSignalContext.retrievedAt).toLocaleString()} · attribution: ${report.externalSignalContext.attribution}.`} items={report.externalSignalContext.items.map((item) => `${item.query} · ${item.traffic}`)} />}
    {report.comparisonSignalContext && <section className="report-context"><h2>Manual comparison context · not scored</h2><p>Google Trends Interest over time for the approved US comparison is replayed as context only. It does not change any score, ranking, gate, or recommendation in this report.</p><small>US · Web Search · past 12 months · imported {new Date(report.comparisonSignalContext.importedAt).toLocaleString()} · {report.comparisonSignalContext.granularity.toLowerCase()} periods.</small><GoogleTrendsComparisonTimeline evidence={report.comparisonSignalContext} /><ul>{report.comparisonSignalContext.series.map((series) => <li key={series.term}>{series.term} · {series.values.length} normalized points</li>)}</ul></section>}
    <div className="evidence-summary"><article><h2>Supporting evidence</h2><ul>{report.evidenceSummary.supporting.map((item) => <li key={item}>{item}</li>)}</ul></article><article><h2>Opposing pressure</h2><ul>{report.evidenceSummary.opposing.map((item) => <li key={item}>{item}</li>)}</ul></article></div>
    <div className="report-next"><CheckCircle size={18} /><span>{report.nextStep}</span></div>
  </section>;
}

function ReportContext({ title, copy, note, items }: { title: string; copy: string; note?: string; items: string[] }) {
  return <section className="report-context"><h2>{title}</h2><p>{copy}</p>{note && <small>{note}</small>}<ul>{items.map((item) => <li key={item}>{item}</li>)}</ul></section>;
}

export function MissionReplay({ scenario, setScenario, activeHistory }: { scenario: OfficeScenario; setScenario: (value: OfficeScenario) => void; activeHistory?: LocalMissionDto }) {
  const [position, setPosition] = useState(officeHistories[scenario].length);
  const [filters, setFilters] = useState<ReplayEventCategory[]>(["task", "agent", "budget", "review", "failure"]);
  const history = activeHistory?.events ?? officeHistories[scenario];
  useEffect(() => { setPosition(history.length); }, [activeHistory?.missionId, scenario, history.length]);
  const boundedPosition = Math.min(position, history.length);
  const records = replayEvents(history).filter((item) => filters.includes(item.category));
  let projection: OfficeProjection | null = null;
  let error: string | null = null;
  try { projection = projectOffice(history.slice(0, boundedPosition)); } catch (caught) { error = caught instanceof Error ? caught.message : "This event prefix cannot be projected."; }
  const toggle = (category: ReplayEventCategory) => setFilters((current) => current.includes(category) ? current.filter((item) => item !== category) : [...current, category]);
  return <section className="decision-view replay-view" aria-label="Mission Replay">
    <SectionHeader title="Reconstruct the office timeline" description={`${activeHistory ? `Persisted local mission ${activeHistory.missionId}.` : `Selected synthetic ${scenario.toLowerCase()} history.`} Filters change the list only; mission state never changes.`} aside={<strong className="replay-position">Event {boundedPosition} / {history.length}</strong>} />
    <div className="replay-layout"><aside className="replay-inspector"><header><span>Timeline controls</span><small>Projection only</small></header><label htmlFor="replay-position">Timeline position</label><input id="replay-position" type="range" min="1" max={history.length} value={Math.max(1, boundedPosition)} onChange={(event) => setPosition(Number(event.currentTarget.value))} /><div className="filter-row" role="group" aria-label="Event category filters">{(["task", "agent", "budget", "review", "failure"] as ReplayEventCategory[]).map((category) => <button key={category} className={filters.includes(category) ? "selected" : ""} onClick={() => toggle(category)}>{category}</button>)}</div>{error ? <p className="inline-error">Prefix unavailable: {error}</p> : projection && <div className="replay-snapshot"><span>Projected snapshot</span><strong>{projection.mission.phase}</strong><dl><div><dt>Workers</dt><dd>{projection.agents.length}</dd></div><div><dt>Spent</dt><dd>{projection.ledger.spent}</dd></div><div><dt>Events</dt><dd>{projection.events.length}</dd></div></dl></div>}<div className="replay-scenarios"><span>{activeHistory ? "Demo fallback histories" : "History"}</span>{(Object.keys(officeHistories) as OfficeScenario[]).map((name) => <button className={scenario === name ? "selected" : ""} key={name} onClick={() => { setScenario(name); setPosition(officeHistories[name].length); }}>{name}</button>)}</div></aside><section className="replay-chronology" aria-labelledby="replay-chronology-title"><header className="surface-heading"><div><span>Recorded sequence</span><h2 id="replay-chronology-title">Event chronology</h2></div><small>{records.length} visible</small></header><div className="event-list replay-events">{records.map((event) => <article className={`event ${event.sequence <= boundedPosition ? "replayed" : ""}`} key={event.sequence}><b>{String(event.sequence).padStart(2, "0")}</b><span><strong>{event.type}</strong><small>{event.category} · {event.detail}</small></span><button onClick={() => setPosition(event.sequence)}>Inspect</button></article>)}</div></section></div>
  </section>;
}
