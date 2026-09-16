import { StrictMode, useEffect, useState, type ComponentType } from "react";
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
import { officeHistories, projectOffice, projectFinalReport, replayEvents, type AgentState, type OfficeScenario, type OfficeProjection, type ReplayEventCategory } from "./office-projection.js";
import { captureGoogleTrends, confirmSubscriptionWorker, importGoogleTrendsComparison, launchLocalMission, preflightSubscriptionRuntime, reloadLocalMission, runSubscriptionWorker, type LocalMissionDto, type SubscriptionConfirmationDto } from "./runtime-client.js";
import { fixtureIds } from "../fixture-model.js";

type Icon = ComponentType<{ size?: number; weight?: "regular" | "bold" | "fill" }>;
type OfficeView = "floor" | "agent" | "tribunal" | "review" | "report" | "replay";
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

function DecisionView({ projection, view, onSubscriptionPreflight, subscriptionPreflightLoading, onSubscriptionConfirmation, subscriptionConfirmationLoading, onSubscriptionRun, subscriptionRunLoading, subscriptionConfirmation, subscriptionConfirmationEligible, onGoogleTrendsCapture, googleTrendsCaptureLoading, googleTrendsCaptureEligible, onGoogleTrendsComparisonImport, googleTrendsComparisonImportLoading, googleTrendsComparisonImportEligible }: { projection: OfficeProjection; view: OfficeView; onSubscriptionPreflight?: () => void; subscriptionPreflightLoading: boolean; onSubscriptionConfirmation?: () => void; subscriptionConfirmationLoading: boolean; onSubscriptionRun?: () => void; subscriptionRunLoading: boolean; subscriptionConfirmation?: SubscriptionConfirmationDto; subscriptionConfirmationEligible: boolean; onGoogleTrendsCapture?: () => void; googleTrendsCaptureLoading: boolean; googleTrendsCaptureEligible: boolean; onGoogleTrendsComparisonImport?: (file: File) => void; googleTrendsComparisonImportLoading: boolean; googleTrendsComparisonImportEligible: boolean }) {
  if (view === "floor") return null;
  if (view === "agent") return <section className="decision-view" aria-label="Agent Desk"><div className="panel-heading"><div><span className="eyebrow">Agent Desk</span><h2>Worker evidence &amp; usage</h2></div></div>{(googleTrendsCaptureEligible || projection.decisionViews.googleTrendsEvidence) && <article className="decision-card mission-usage-summary"><strong>Google Trends · read-only public-source pilot</strong><p>One fixed US Trending Now RSS request. No login, worker, retry, or subscription usage.</p><small>Results are a sampled, normalized signal—not demand or a sales estimate. The captured labels and traffic buckets become local event history.</small>{projection.decisionViews.googleTrendsEvidence && <small>Captured source: {projection.decisionViews.googleTrendsEvidence.sourceUrl} · {projection.decisionViews.googleTrendsEvidence.geo} · retrieved {new Date(projection.decisionViews.googleTrendsEvidence.retrievedAt).toLocaleString()} · attribution: {projection.decisionViews.googleTrendsEvidence.attribution}.</small>}{onGoogleTrendsCapture && <button onClick={onGoogleTrendsCapture} disabled={googleTrendsCaptureLoading || !googleTrendsCaptureEligible}>{googleTrendsCaptureLoading ? "Capturing Google Trends…" : googleTrendsCaptureEligible ? "Capture Google Trends US now" : "Google Trends capture recorded"}</button>}</article>}{(googleTrendsComparisonImportEligible || projection.decisionViews.googleTrendsComparisonEvidence) && <article className="decision-card mission-usage-summary"><strong>Google Trends · manual comparison context</strong><p>Import only the approved US / Web Search / past-12-month Interest over time CSV for desk cable organizer, under-desk cable tray, and cable management box.</p><small>DropScope never contacts Google, stores the raw CSV, runs a worker, retries, polls, or uses a subscription. The validated timeline is local context only: it changes no score, ranking, gate, or recommendation.</small>{projection.decisionViews.googleTrendsComparisonEvidence && <small>Imported {projection.decisionViews.googleTrendsComparisonEvidence.granularity.toLowerCase()} timeline: {projection.decisionViews.googleTrendsComparisonEvidence.periods.length} periods · {projection.decisionViews.googleTrendsComparisonEvidence.geo} · {projection.decisionViews.googleTrendsComparisonEvidence.attribution} · {new Date(projection.decisionViews.googleTrendsComparisonEvidence.importedAt).toLocaleString()}.</small>}{onGoogleTrendsComparisonImport && <label>Choose exported CSV<input aria-label="Choose Google Trends comparison CSV" type="file" accept=".csv,text/csv" disabled={googleTrendsComparisonImportLoading || !googleTrendsComparisonImportEligible} onChange={(event) => { const file = event.currentTarget.files?.item(0); event.currentTarget.value = ""; if (file) onGoogleTrendsComparisonImport(file); }} /></label>}</article>}{projection.decisionViews.subscriptionRuntime && <article className="decision-card mission-usage-summary"><strong>Subscription runtime · guarded pilot</strong><p>{subscriptionAccessCopy(projection.decisionViews.subscriptionRuntime)}</p><small>Subscription usage not itemized.</small>{onSubscriptionPreflight && <button onClick={onSubscriptionPreflight} disabled={subscriptionPreflightLoading || projection.decisionViews.subscriptionRuntime.access !== "LOCAL_SUBSCRIPTION_NOT_CHECKED"}>{subscriptionPreflightLoading ? "Checking subscription runtime…" : "Check subscription runtime"}</button>}<hr /><strong>First live worker · approval required</strong><p>One fresh thread · {projection.decisionViews.subscriptionRuntime.firstLiveWorker.maximumTurns === 1 ? "one" : projection.decisionViews.subscriptionRuntime.firstLiveWorker.maximumTurns} turn · {projection.decisionViews.subscriptionRuntime.firstLiveWorker.timeoutMs / 1_000}-second maximum · inline fixed pilot evidence · read-only mode · network denied · no retry.</p><small>Confirmation is one-use, stays only in local runtime memory, and expires after {projection.decisionViews.subscriptionRuntime.firstLiveWorker.confirmationTtlMs / 1_000} seconds.</small><small>Any command, file-change, or permission request is automatically declined and ends the run. No request is accepted automatically.</small>{subscriptionConfirmationEligible && onSubscriptionConfirmation && <button onClick={onSubscriptionConfirmation} disabled={subscriptionConfirmationLoading || subscriptionRunLoading || projection.decisionViews.subscriptionRuntime.access !== "LOCAL_CHATGPT_AUTHENTICATED"}>{subscriptionConfirmationLoading ? "Confirming locally…" : "Confirm one live worker"}</button>}{subscriptionConfirmation && <small role="status">Confirmation status: confirmed locally · expires at {new Date(subscriptionConfirmation.expiresAtMs).toLocaleTimeString()}.</small>}{subscriptionConfirmationEligible && onSubscriptionRun && <button onClick={onSubscriptionRun} disabled={subscriptionRunLoading || !subscriptionConfirmation || subscriptionConfirmation.expiresAtMs <= Date.now() || projection.decisionViews.subscriptionRuntime.access !== "LOCAL_CHATGPT_AUTHENTICATED"}>{subscriptionRunLoading ? "Running one live worker…" : "Run one live worker now"}</button>}{projection.decisionViews.subscriptionRuntime.lastWorkerOutcome && <small>Last subscription worker outcome: {projection.decisionViews.subscriptionRuntime.lastWorkerOutcome.outcome} · provider usage unknown · {projection.decisionViews.subscriptionRuntime.lastWorkerOutcome.elapsedMs} ms.</small>}</article>}{projection.decisionViews.missionUsageSummary && <article className="decision-card mission-usage-summary"><strong>Mission usage summary · recorded dry-run provenance</strong><p>Recorded dry-run count: {projection.decisionViews.missionUsageSummary.dryRunCount}</p><small>Recorded dry-run provider usage: not applicable · other attempt provenance: {projection.decisionViews.missionUsageSummary.unrecordedAttemptCount} not recorded</small><small>Mission ledger: {projection.decisionViews.missionUsageSummary.total} total · {projection.decisionViews.missionUsageSummary.reserved} reserved · {projection.decisionViews.missionUsageSummary.committed} committed · {projection.decisionViews.missionUsageSummary.spent} spent · {projection.decisionViews.missionUsageSummary.available} available</small></article>}<div className="decision-grid">{projection.decisionViews.agentDesk.map((agent) => <article className="decision-card" key={agent.attemptId}><strong>{agent.role}</strong><span>{agent.state} · {agent.task}</span><p>{agent.evidence}</p>{agent.provenance === "RECORDED_DRY_RUN" && <small>Recorded dry-run · no live worker or credits used</small>}<small>Replay usage: {agent.usage.units} units · {agent.usage.status}</small></article>)}</div></section>;
  if (view === "tribunal") {
    const room = projection.decisionViews.tribunalRoom;
    return <section className="decision-view" aria-label="Tribunal Room"><div className="panel-heading"><div><span className="eyebrow">Tribunal Room</span><h2>Recorded policy result</h2></div></div>{room ? <div className="decision-grid"><article className="decision-card"><strong>{room.result.recommendation}</strong><span>Candidate {room.result.candidateId} · sequence {room.recordedAtSequence}</span><p>Venture claims: {room.result.ventureClaimIds.join(", ") || "none"}</p><p>Ruin claims: {room.result.ruinClaimIds.join(", ") || "none"}</p><small>{room.result.reasons.map((reason) => reason.explanation).join(" ")}</small></article></div> : <p className="empty-state">No TribunalCompleted event in this replay.</p>}</section>;
  }
  const office = projection.decisionViews.reviewOffice;
  return <section className="decision-view" aria-label="Review Office"><div className="panel-heading"><div><span className="eyebrow">Review Office</span><h2>Blind review record</h2></div></div>{office ? <div className="decision-grid">{office.result.candidateAssessments.map((assessment) => <article className="decision-card" key={assessment.anonymizedCandidateId}><strong>Rank {office.result.ranking.indexOf(assessment.anonymizedCandidateId) + 1} · {assessment.anonymizedCandidateId}</strong><span>{office.result.verdict} · score {assessment.reviewerScore}</span><p>{Object.entries(assessment.dimensionScores).map(([dimension, score]) => `${dimension}: ${score}`).join(" · ")}</p><small>Blocking feedback: {[...assessment.blockingDefects, ...assessment.missingResearchKeys].join(", ") || "none"}</small>{office.divergences.length > 0 ? <small>Divergences: {office.divergences.join(" · ")}</small> : <small>Divergences: none recorded in this replay.</small>}{office.revisionResponse && <small>{office.revisionResponse}</small>}</article>)}</div> : <p className="empty-state">No BlindReviewCompleted event in this replay.</p>}</section>;
}

function FinalReport({ events }: { events?: LocalMissionDto["events"] }) {
  const report = projectFinalReport(events);
  return <section className="decision-view report-view" aria-label="Final Report"><div className="panel-heading"><div><span className="eyebrow">Final Report</span><h2>Recorded opportunity priorities</h2></div><span className={`report-outcome ${report.outcome.toLowerCase()}`}>{report.outcome.replaceAll("_", " ")}</span></div><p className="source-note">{report.sourceLabel}</p><div className="report-metrics"><div><span>Customer problem</span><strong>{report.customerProblemEvidence}/100</strong></div><div><span>Evidence quality</span><strong>{report.evidenceQuality}/100</strong></div><div><span>Ad saturation</span><strong>{report.advertisingSaturation}/100</strong></div><div><span>Operational risk</span><strong>{report.operationalRisk}/100</strong></div><div><span>Failure risk</span><strong>{report.failureRisk}/100</strong></div><div><span>Safety / gate</span><strong>{report.safetyGate}</strong></div></div><div className="report-columns"><article className="decision-card"><strong>Top priorities</strong>{report.priorities.length ? <ol>{report.priorities.slice(0, 5).map((candidate) => <li key={candidate.candidateId}><span>{candidate.candidateId}</span><b>{candidate.researchPriorityScore}</b></li>)}</ol> : <p>None cleared the recorded evidence gates.</p>}</article><article className="decision-card"><strong>Held-out reasons</strong>{report.heldOut.length ? <ul>{report.heldOut.map((candidate) => <li key={candidate.candidateId}><span>{candidate.candidateId}</span><small>{candidate.reasonCodes.join(", ")}</small></li>)}</ul> : <p>No held-out candidates in this report.</p>}</article><article className="decision-card"><strong>Recorded review</strong><p>{report.reviewerVerdict}</p><small>The verdict is read from the existing replay review event.</small></article></div>{report.externalSignalContext && <article className="decision-card external-signal-context"><strong>External signal context · not scored</strong><p>Google Trends US Trending Now is a sampled, normalized search-interest snapshot. It does not change any score, ranking, gate, or recommendation in this report.</p><small>Source: {report.externalSignalContext.sourceUrl} · retrieved {new Date(report.externalSignalContext.retrievedAt).toLocaleString()} · attribution: {report.externalSignalContext.attribution}.</small><ul>{report.externalSignalContext.items.map((item) => <li key={`${item.query}-${item.traffic}`}>{item.query} · {item.traffic}</li>)}</ul></article>}{report.comparisonSignalContext && <article className="decision-card external-signal-context"><strong>Manual comparison context · not scored</strong><p>Google Trends Interest over time for the approved US comparison is replayed as context only. It does not change any score, ranking, gate, or recommendation in this report.</p><small>US · Web Search · past 12 months · imported {new Date(report.comparisonSignalContext.importedAt).toLocaleString()} · {report.comparisonSignalContext.granularity.toLowerCase()} periods.</small><ul>{report.comparisonSignalContext.series.map((series) => <li key={series.term}>{series.term} · {series.values.length} normalized points</li>)}</ul></article>}<div className="report-columns evidence-summary"><article className="decision-card"><strong>Supporting evidence</strong><ul>{report.evidenceSummary.supporting.map((item) => <li key={item}>{item}</li>)}</ul></article><article className="decision-card"><strong>Opposing pressure</strong><ul>{report.evidenceSummary.opposing.map((item) => <li key={item}>{item}</li>)}</ul></article></div><div className="report-next"><CheckCircle size={18} /><span>{report.nextStep}</span></div></section>;
}

function MissionReplay({ scenario, setScenario, activeHistory }: { scenario: OfficeScenario; setScenario: (value: OfficeScenario) => void; activeHistory?: LocalMissionDto }) {
  const [position, setPosition] = useState(officeHistories[scenario].length);
  const [filters, setFilters] = useState<ReplayEventCategory[]>(["task", "agent", "budget", "review", "failure"]);
  const history = activeHistory?.events ?? officeHistories[scenario];
  useEffect(() => { setPosition(history.length); }, [activeHistory?.missionId, scenario, history.length]);
  const boundedPosition = Math.min(position, history.length);
  const records = replayEvents(history).filter((item) => filters.includes(item.category));
  const prefix = history.slice(0, boundedPosition);
  let projection: OfficeProjection | null = null;
  let error: string | null = null;
  try { projection = projectOffice(prefix); } catch (caught) { error = caught instanceof Error ? caught.message : "This event prefix cannot be projected."; }
  const toggle = (category: ReplayEventCategory) => setFilters((current) => current.includes(category) ? current.filter((item) => item !== category) : [...current, category]);
  return <section className="decision-view replay-view" aria-label="Mission Replay"><div className="panel-heading"><div><span className="eyebrow">Mission Replay</span><h2>Reconstruct the office timeline</h2></div><span className="replay-position">Event {boundedPosition} / {history.length}</span></div><p className="source-note">{activeHistory ? `Persisted local mission ${activeHistory.missionId}.` : `Selected synthetic ${scenario.toLowerCase()} history.`} Filters change the list only; the office is projected from the valid event prefix and mission state never changes.</p><div className="replay-controls"><label htmlFor="replay-position">Position</label><input id="replay-position" type="range" min="1" max={history.length} value={Math.max(1, boundedPosition)} onChange={(event) => setPosition(Number(event.currentTarget.value))} /><div className="filter-row" role="group" aria-label="Event category filters">{(["task", "agent", "budget", "review", "failure"] as ReplayEventCategory[]).map((category) => <button key={category} className={filters.includes(category) ? "selected" : ""} onClick={() => toggle(category)}>{category}</button>)}</div></div>{error ? <p className="empty-state">Prefix unavailable: {error}</p> : projection && <div className="replay-snapshot"><strong>{projection.mission.phase}</strong><span>{projection.agents.length} projected workers · {projection.ledger.spent} spent · {projection.events.length} recent events</span></div>}<div className="event-list replay-events">{records.map((event) => <div className={`event ${event.sequence <= boundedPosition ? "replayed" : ""}`} key={event.sequence}><b>{String(event.sequence).padStart(2, "0")}</b><span><strong>{event.type}</strong><small>{event.category} · {event.detail}</small></span><button onClick={() => setPosition(event.sequence)}>Inspect</button></div>)}</div><div className="replay-scenarios"><span>{activeHistory ? "Demo fallback histories" : "History"}</span>{(Object.keys(officeHistories) as OfficeScenario[]).map((name) => <button className={scenario === name ? "selected" : ""} key={name} onClick={() => { setScenario(name); setPosition(officeHistories[name].length); }}>{name}</button>)}</div></section>;
}

function Office() {
  const [scenario, setScenario] = useState<OfficeScenario>("RUNNING");
  const [activeMission, setActiveMission] = useState<LocalMissionDto>();
  const [fixtureId, setFixtureId] = useState("crosscurrent-workspace-market");
  const [runtimeState, setRuntimeState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [runtimeMessage, setRuntimeMessage] = useState("");
  const [subscriptionPreflightLoading, setSubscriptionPreflightLoading] = useState(false);
  const [subscriptionConfirmationLoading, setSubscriptionConfirmationLoading] = useState(false);
  const [subscriptionRunLoading, setSubscriptionRunLoading] = useState(false);
  const [subscriptionConfirmation, setSubscriptionConfirmation] = useState<SubscriptionConfirmationDto>();
  const [googleTrendsCaptureLoading, setGoogleTrendsCaptureLoading] = useState(false);
  const [googleTrendsComparisonImportLoading, setGoogleTrendsComparisonImportLoading] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [view, setView] = useState<OfficeView>("floor");
  useEffect(() => {
    let missionId: string | null;
    try { missionId = window.localStorage.getItem("dropscope.activeMissionId"); }
    catch { setRuntimeState("error"); setRuntimeMessage("Browser storage is unavailable, so no previous local mission can be restored."); return; }
    if (!missionId) return;
    setRuntimeState("loading");
    void reloadLocalMission(missionId).then((mission) => { setActiveMission(mission); setRuntimeState("success"); setRuntimeMessage("Reloaded the browser-saved local mission."); }).catch((error: unknown) => { setRuntimeState("error"); setRuntimeMessage(error instanceof Error ? error.message : "Could not reload the browser-saved mission."); });
  }, []);
  const history = activeMission?.events ?? officeHistories[scenario];
  const projection = projectOffice(history);
  const floorAgents = [...new Map(projection.agents.map((agent) => [agent.id, agent])).values()];
  const status = projection.mission.status;
  const StatusIcon = status === "BLOCKED" ? Warning : status === "COMPLETED" ? CheckCircle : Play;
  const workingAgents = floorAgents.filter((agent) => agent.state === "WORKING").length;
  const floorStatus = status === "BLOCKED" ? "Policy block" : status === "COMPLETED" ? "Mission complete" : "Replay running";
  const launch = async () => {
    setRuntimeState("loading"); setRuntimeMessage("Launching local mission…");
    setSubscriptionConfirmation(undefined);
    try {
      const mission = await launchLocalMission(fixtureId);
      setActiveMission(mission);
      try { window.localStorage.setItem("dropscope.activeMissionId", mission.missionId); setRuntimeState("success"); setRuntimeMessage(`Mission ${mission.missionId} launched and persisted.`); }
      catch { setRuntimeState("success"); setRuntimeMessage(`Mission ${mission.missionId} launched, but browser storage is unavailable. It will not auto-reload after refresh.`); }
    }
    catch (error: unknown) { setRuntimeState("error"); setRuntimeMessage(error instanceof Error ? error.message : "Could not launch the local mission."); }
  };
  const reload = async () => {
    let missionId: string | null;
    try { missionId = window.localStorage.getItem("dropscope.activeMissionId"); }
    catch { setRuntimeState("error"); setRuntimeMessage("Browser storage is unavailable, so there is no saved mission to reload."); return; }
    if (!missionId) { setRuntimeState("error"); setRuntimeMessage("No local mission has been launched yet."); return; }
    setRuntimeState("loading"); setRuntimeMessage("Reloading persisted mission…");
    try { const mission = await reloadLocalMission(missionId); setActiveMission(mission); setSubscriptionConfirmation(undefined); setRuntimeState("success"); setRuntimeMessage("Persisted local mission reloaded."); }
    catch (error: unknown) { setRuntimeState("error"); setRuntimeMessage(error instanceof Error ? error.message : "Could not reload the local mission."); }
  };
  const confirmSubscription = async () => {
    if (!activeMission || activeMission.fixtureId !== "live-worker-pilot") return;
    setSubscriptionConfirmationLoading(true);
    setRuntimeState("loading");
    setRuntimeMessage("Requesting one-use local confirmation…");
    try {
      const confirmation = await confirmSubscriptionWorker(activeMission.missionId);
      setSubscriptionConfirmation(confirmation);
      setRuntimeState("success");
      setRuntimeMessage("Local confirmation recorded in memory. No worker was started.");
    } catch (error: unknown) {
      setRuntimeState("error");
      setRuntimeMessage(error instanceof Error ? error.message : "Could not confirm the local subscription worker.");
    } finally {
      setSubscriptionConfirmationLoading(false);
    }
  };
  const checkSubscriptionRuntime = async () => {
    if (!activeMission) return;
    setSubscriptionPreflightLoading(true);
    setRuntimeState("loading");
    setRuntimeMessage("Checking subscription runtime…");
    try {
      const mission = await preflightSubscriptionRuntime(activeMission.missionId);
      setActiveMission(mission);
      setRuntimeState("success");
      setRuntimeMessage("Subscription runtime check recorded. No worker was started.");
    } catch (error: unknown) {
      setRuntimeState("error");
      setRuntimeMessage(error instanceof Error ? error.message : "Could not check the local subscription runtime.");
    } finally {
      setSubscriptionPreflightLoading(false);
    }
  };
  const runSubscription = async () => {
    if (!activeMission || activeMission.fixtureId !== "live-worker-pilot" || !subscriptionConfirmation) return;
    setSubscriptionRunLoading(true);
    setRuntimeState("loading");
    setRuntimeMessage("Starting the confirmed one-turn live worker…");
    try {
      const mission = await runSubscriptionWorker(activeMission.missionId);
      setActiveMission(mission);
      setSubscriptionConfirmation(undefined);
      setRuntimeState("success");
      setRuntimeMessage("One live worker finished and its closed outcome was recorded.");
    } catch (error: unknown) {
      setSubscriptionConfirmation(undefined);
      setRuntimeState("error");
      setRuntimeMessage(error instanceof Error ? error.message : "Could not run the confirmed subscription worker.");
    } finally {
      setSubscriptionRunLoading(false);
    }
  };
  const runGoogleTrendsCapture = async () => {
    if (!activeMission || activeMission.fixtureId !== "google-trends-pilot") return;
    setGoogleTrendsCaptureLoading(true);
    setRuntimeState("loading");
    setRuntimeMessage("Capturing one fixed Google Trends US source…");
    try {
      const mission = await captureGoogleTrends(activeMission.missionId);
      setActiveMission(mission);
      setRuntimeState("success");
      setRuntimeMessage("Google Trends capture outcome and evidence were recorded locally.");
    } catch (error: unknown) {
      setRuntimeState("error");
      setRuntimeMessage(error instanceof Error ? error.message : "Could not capture Google Trends.");
    } finally { setGoogleTrendsCaptureLoading(false); }
  };
  const importGoogleTrendsComparisonCsv = async (file: File) => {
    if (!activeMission || activeMission.fixtureId !== "google-trends-comparison-pilot") return;
    setGoogleTrendsComparisonImportLoading(true);
    setRuntimeState("loading");
    setRuntimeMessage("Importing the selected Google Trends comparison CSV locally…");
    try {
      const mission = await importGoogleTrendsComparison(activeMission.missionId, await file.text());
      setActiveMission(mission);
      setRuntimeState("success");
      setRuntimeMessage("Google Trends comparison context was imported locally. The raw CSV was not stored.");
    } catch (error: unknown) {
      setRuntimeState("error");
      setRuntimeMessage(error instanceof Error ? error.message : "Could not import the Google Trends comparison CSV.");
    } finally { setGoogleTrendsComparisonImportLoading(false); }
  };

  return <div className={`app ${reduced ? "reduced" : ""}`}>
    <header className="topbar"><div className="brand"><b>D</b><span>DropScope</span><em>RESEARCH OS</em></div><div className="topbar-mission"><span>MISSION</span><strong>{projection.mission.name}</strong></div></header>
    <div className="shell">
      <aside className="sidebar"><div className="sidebar-label">Workspace</div><nav aria-label="Primary navigation"><button className={`nav-item ${view === "floor" ? "active" : ""}`} onClick={() => setView("floor")}><Play size={18} /><span>Research Office</span></button><button className={`nav-item ${view === "agent" ? "active" : ""}`} onClick={() => setView("agent")}><Target size={18} /><span>Agent Desk</span></button><button className={`nav-item ${view === "tribunal" ? "active" : ""}`} onClick={() => setView("tribunal")}><ShieldCheck size={18} /><span>Tribunal Room</span></button><button className={`nav-item ${view === "review" ? "active" : ""}`} onClick={() => setView("review")}><Archive size={18} /><span>Review Office</span></button><button className={`nav-item ${view === "report" ? "active" : ""}`} onClick={() => setView("report")}><ChartLineUp size={18} /><span>Final Report</span></button><button className={`nav-item ${view === "replay" ? "active" : ""}`} onClick={() => setView("replay")}><List size={18} /><span>Mission Replay</span></button></nav><div className="sidebar-foot"><span className="online-dot" />{activeMission ? "Local event history" : "Synthetic event replay"}<small>Read-only projection</small></div></aside>
      <main className="content">
        <section className="runtime-controls" aria-label="Local mission controls"><div><span className="eyebrow">Local runtime</span><strong>{activeMission ? `Mission ${activeMission.missionId}` : "Synthetic demo fallback"}</strong></div><label htmlFor="fixture-select">Fixture</label><select id="fixture-select" value={fixtureId} onChange={(event) => setFixtureId(event.currentTarget.value)}>{fixtureIds.map((id) => <option value={id} key={id}>{id}</option>)}</select><button onClick={() => void launch()} disabled={runtimeState === "loading"}>Launch local mission</button><button onClick={() => void reload()} disabled={runtimeState === "loading"}>Reload saved mission</button>{runtimeMessage && <span className={`runtime-message ${runtimeState}`} role="status">{runtimeMessage}</span>}</section>
        <section className="page-heading"><div><div className="heading-kicker"><span>Mission</span><strong>{projection.mission.name}</strong><span className={`mission-status ${status.toLowerCase()}`}><StatusIcon size={14} />{projection.mission.phase}</span></div><p className="source-note" title={activeMission ? `Persisted local mission ${activeMission.missionId}` : projection.sourceLabel}>{activeMission ? `Persisted local mission ${activeMission.missionId}.` : projection.sourceLabel}</p></div><div className="scenario-switcher" role="group" aria-label="Replay state"><span>{activeMission ? "Demo fallback" : "Replay state"}</span>{(Object.keys(officeHistories) as OfficeScenario[]).map((name) => <button className={scenario === name ? "selected" : ""} onClick={() => { setScenario(name); setApprovalOpen(false); }} key={name}>{name}</button>)}</div></section>
        <div className="floor-status"><span className="eyebrow"><span className="live-dot" />{floorStatus}</span><span>{floorAgents.length} assigned workers · {workingAgents} active</span></div>
        {view === "report" ? <FinalReport events={activeMission?.events} /> : view === "replay" ? <MissionReplay scenario={scenario} setScenario={setScenario} activeHistory={activeMission} /> : <DecisionView projection={projection} view={view} onSubscriptionPreflight={activeMission ? () => void checkSubscriptionRuntime() : undefined} subscriptionPreflightLoading={subscriptionPreflightLoading} onSubscriptionConfirmation={activeMission ? () => void confirmSubscription() : undefined} subscriptionConfirmationLoading={subscriptionConfirmationLoading} onSubscriptionRun={activeMission ? () => void runSubscription() : undefined} subscriptionRunLoading={subscriptionRunLoading} subscriptionConfirmation={subscriptionConfirmation} subscriptionConfirmationEligible={activeMission?.fixtureId === "live-worker-pilot"} onGoogleTrendsCapture={activeMission ? () => void runGoogleTrendsCapture() : undefined} googleTrendsCaptureLoading={googleTrendsCaptureLoading} googleTrendsCaptureEligible={activeMission?.fixtureId === "google-trends-pilot" && projection.mission.status === "RUNNING"} onGoogleTrendsComparisonImport={activeMission ? (file) => void importGoogleTrendsComparisonCsv(file) : undefined} googleTrendsComparisonImportLoading={googleTrendsComparisonImportLoading} googleTrendsComparisonImportEligible={activeMission?.fixtureId === "google-trends-comparison-pilot" && projection.mission.status === "RUNNING"} />}
        {view === "floor" && <OfficeScene agents={floorAgents} onApproval={() => setApprovalOpen((value) => !value)} />}
        {approvalOpen && status === "BLOCKED" && <div className="approval-note" role="status"><Warning size={16} /><span><strong>Policy block</strong> This replay stopped with unresolved safety evidence. This local disclosure does not change mission data or policy.</span></div>}
        {view === "floor" && <section className="lower-layout"><WorkGraph tasks={projection.tasks} /><div className="context-stack"><MissionLedger projection={projection} /><EventTrail projection={projection} reduced={reduced} setReduced={setReduced} /></div></section>}
      </main>
    </div>
  </div>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><Theme appearance="dark" accentColor="cyan" grayColor="slate" radius="small"><Office /></Theme></StrictMode>);
