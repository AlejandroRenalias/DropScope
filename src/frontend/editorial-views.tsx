import { useEffect, useState, type ComponentType } from "react";
import { CheckCircle } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { ChartBar } from "@phosphor-icons/react/dist/csr/ChartBar";
import { ClockCounterClockwise } from "@phosphor-icons/react/dist/csr/ClockCounterClockwise";
import { MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { Scales } from "@phosphor-icons/react/dist/csr/Scales";
import { ShieldCheck } from "@phosphor-icons/react/dist/csr/ShieldCheck";
import { Target } from "@phosphor-icons/react/dist/csr/Target";
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

export type OfficeView = "floor" | "agent" | "tribunal" | "review" | "report" | "replay";
type Icon = ComponentType<{ size?: number; weight?: "regular" | "bold" | "fill" }>;

export const navigation: Array<{ view: OfficeView; label: string; icon: Icon }> = [
  { view: "floor", label: "Research Office", icon: Target },
  { view: "agent", label: "Agent Desk", icon: MagnifyingGlass },
  { view: "tribunal", label: "Tribunal Room", icon: Scales },
  { view: "review", label: "Review Office", icon: ShieldCheck },
  { view: "report", label: "Final Report", icon: ChartBar },
  { view: "replay", label: "Mission Replay", icon: ClockCounterClockwise },
];
export function WorkspaceNavigation({ view, onChange }: { view: OfficeView; onChange: (view: OfficeView) => void }) {
  return <nav className="workspace-nav" aria-label="Primary navigation">
    {navigation.map(({ view: target, label, icon: Icon }) => <button aria-label={label} className={view === target ? "active" : ""} onClick={() => onChange(target)} aria-current={view === target ? "page" : undefined} key={target}><span className="nav-icon" aria-hidden="true"><Icon size={17} weight={view === target ? "fill" : "regular"} /></span><span className="nav-label">{label}</span></button>)}
  </nav>;
}

function StateLabel({ state }: { state: AgentState | OfficeProjection["mission"]["status"] }) {
  return <span className={`state-label ${state.toLowerCase()}`}>{state}</span>;
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
