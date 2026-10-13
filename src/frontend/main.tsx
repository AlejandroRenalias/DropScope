import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Theme } from "@radix-ui/themes";
import { CaretDown } from "@phosphor-icons/react/dist/csr/CaretDown";
import { CheckCircle } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { Play } from "@phosphor-icons/react/dist/csr/Play";
import { Warning } from "@phosphor-icons/react/dist/csr/Warning";
import "@radix-ui/themes/styles.css";
import "./styles.css";
import "./command-center.css";
import { fixtureIds } from "../fixture-model.js";
import { officeHistories, projectOffice, type OfficeScenario } from "./office-projection.js";
import {
  captureGoogleTrends,
  confirmSubscriptionWorker,
  importGoogleTrendsComparison,
  launchLocalMission,
  preflightSubscriptionRuntime,
  reloadLocalMission,
  runSubscriptionWorker,
  type LocalMissionDto,
  type SubscriptionConfirmationDto,
} from "./runtime-client.js";
import {
  DecisionView,
  WorkspaceNavigation,
  navigation,
  type OfficeView,
} from "./editorial-views.js";
import { CommandFrame, ResearchOfficeCenter } from "./research-office.js";
import { uniqueAgents } from "./research-model.js";
import { MissionReplay } from "./mission-replay.js";
import { FinalReport } from "./report-view.js";

type RuntimeState = "idle" | "loading" | "success" | "error";

const fixturePresentation: Record<string, { label: string; description: string }> = {
  "crosscurrent-workspace-market": { label: "Learn a Market", description: "Run the complete synthetic opportunity-research mission." },
  "failure-autopsy-pilot": { label: "Failure Autopsy", description: "Test why a fixed concept should stop before more effort is spent." },
  "product-investigation-pilot": { label: "Product Investigation", description: "Research one fixed product with automatic failure pressure." },
  "live-worker-pilot": { label: "Guarded live-worker pilot", description: "Prepare the fixed one-turn worker path with separate local approval." },
  "google-trends-pilot": { label: "Google Trends capture", description: "Record one fixed public-source snapshot after an explicit action." },
  "google-trends-comparison-pilot": { label: "Google Trends comparison", description: "Import the approved comparison CSV as unscored local context." },
};

function Office() {
  const [scenario, setScenario] = useState<OfficeScenario>("RUNNING");
  const [activeMission, setActiveMission] = useState<LocalMissionDto>();
  const [fixtureId, setFixtureId] = useState("crosscurrent-workspace-market");
  const [runtimeState, setRuntimeState] = useState<RuntimeState>("idle");
  const [runtimeMessage, setRuntimeMessage] = useState("");
  const [subscriptionPreflightLoading, setSubscriptionPreflightLoading] = useState(false);
  const [subscriptionConfirmationLoading, setSubscriptionConfirmationLoading] = useState(false);
  const [subscriptionRunLoading, setSubscriptionRunLoading] = useState(false);
  const [subscriptionConfirmation, setSubscriptionConfirmation] = useState<SubscriptionConfirmationDto>();
  const [googleTrendsCaptureLoading, setGoogleTrendsCaptureLoading] = useState(false);
  const [googleTrendsComparisonImportLoading, setGoogleTrendsComparisonImportLoading] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [view, setView] = useState<OfficeView>("floor");
  const [replayPosition, setReplayPosition] = useState<number | null>(null);

  useEffect(() => {
    let missionId: string | null;
    try {
      missionId = window.localStorage.getItem("dropscope.activeMissionId");
    } catch {
      setRuntimeState("error");
      setRuntimeMessage("Browser storage is unavailable, so no previous local mission can be restored.");
      return;
    }
    if (!missionId) return;
    setRuntimeState("loading");
    void reloadLocalMission(missionId)
      .then((mission) => {
        setActiveMission(mission);
        setRuntimeState("success");
        setRuntimeMessage("Reloaded the browser-saved local mission.");
        setControlsOpen(false);
      })
      .catch((error: unknown) => {
        setRuntimeState("error");
        setRuntimeMessage(error instanceof Error ? error.message : "Could not reload the browser-saved mission.");
      });
  }, []);

  useEffect(() => { setReplayPosition(null); }, [activeMission?.missionId, scenario]);

  const history = activeMission?.events ?? officeHistories[scenario];
  const replayAt = view === "replay" ? Math.max(1, Math.min(replayPosition ?? history.length, history.length)) : history.length;
  const shownHistory = replayAt >= history.length ? history : history.slice(0, replayAt);
  let projection = projectOffice(history);
  if (shownHistory !== history) { try { projection = projectOffice(shownHistory); } catch { projection = projectOffice(history); } }
  const floorAgents = uniqueAgents(projection);
  const status = projection.mission.status;
  const workingAgents = floorAgents.filter((agent) => agent.state === "WORKING").length;
  const synthetic = !activeMission || ["crosscurrent-workspace-market", "mixed-opportunity-market", "failure-autopsy-pilot", "product-investigation-pilot"].includes(activeMission.fixtureId);
  const demoRuntimeUnavailable = !activeMission && runtimeState === "error" && runtimeMessage.startsWith("Local runtime is unavailable.");
  const previewStates = <div className="scenario-switcher" role="group" aria-label="Replay state"><span>{view === "floor" ? "Preview state" : activeMission ? "Demo fallback" : "Replay state"}</span>{(Object.keys(officeHistories) as OfficeScenario[]).map((name) => <button className={scenario === name ? "selected" : ""} onClick={() => { setScenario(name); setApprovalOpen(false); }} key={name}>{name}</button>)}</div>;
  const runtimeSetupNote = <p className="runtime-start-note">Start the local runtime in a second terminal: <code>npm.cmd run runtime:dev</code>. Launching a fixture does not start a live worker or use a subscription.</p>;

  const launch = async () => {
    setRuntimeState("loading");
    setRuntimeMessage("Launching local mission…");
    setSubscriptionConfirmation(undefined);
    try {
      const mission = await launchLocalMission(fixtureId);
      setActiveMission(mission);
      try {
        window.localStorage.setItem("dropscope.activeMissionId", mission.missionId);
        setRuntimeState("success");
        setRuntimeMessage(`Mission ${mission.missionId} launched and persisted.`);
        setControlsOpen(false);
      } catch {
        setRuntimeState("success");
        setRuntimeMessage(`Mission ${mission.missionId} launched, but browser storage is unavailable. It will not auto-reload after refresh.`);
        setControlsOpen(false);
      }
    } catch (error: unknown) {
      setRuntimeState("error");
      setControlsOpen(true);
      setRuntimeMessage(error instanceof Error ? error.message : "Could not launch the local mission.");
    }
  };

  const reload = async () => {
    let missionId: string | null;
    try {
      missionId = window.localStorage.getItem("dropscope.activeMissionId");
    } catch {
      setRuntimeState("error");
      setRuntimeMessage("Browser storage is unavailable, so there is no saved mission to reload.");
      return;
    }
    if (!missionId) {
      setRuntimeState("error");
      setRuntimeMessage("No local mission has been launched yet.");
      return;
    }
    setRuntimeState("loading");
    setRuntimeMessage("Reloading persisted mission…");
    try {
      const mission = await reloadLocalMission(missionId);
      setActiveMission(mission);
      setSubscriptionConfirmation(undefined);
      setRuntimeState("success");
      setRuntimeMessage("Persisted local mission reloaded.");
      setControlsOpen(false);
    } catch (error: unknown) {
      setRuntimeState("error");
      setControlsOpen(true);
      setRuntimeMessage(error instanceof Error ? error.message : "Could not reload the local mission.");
    }
  };

  const selectedFixture = fixturePresentation[fixtureId] ?? { label: fixtureId, description: "Run the selected fixed local mission." };
  const RuntimeStatusIcon = runtimeState === "error" ? Warning : runtimeState === "success" ? CheckCircle : Play;
  const runtimeStatusTitle = runtimeState === "error" ? activeMission ? "Action needs attention" : "Local runtime needs attention" : runtimeState === "loading" ? "Working locally" : "Mission ready";
  const showMissionNextActions = Boolean(activeMission && runtimeState === "success" && (runtimeMessage.includes("launched") || runtimeMessage.includes("mission reloaded") || runtimeMessage.includes("browser-saved local mission")));

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
    } finally {
      setGoogleTrendsCaptureLoading(false);
    }
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
    } finally {
      setGoogleTrendsComparisonImportLoading(false);
    }
  };

  const currentLabel = navigation.find((item) => item.view === view)?.label ?? "Research Office";
  const liveKind = status === "BLOCKED" ? "blocked" : status === "COMPLETED" ? "completed" : workingAgents > 0 ? "working" : "idle";
  const liveText = status === "BLOCKED" ? "Policy block" : status === "COMPLETED" ? "Mission complete" : workingAgents > 0 ? `${workingAgents} researcher${workingAgents === 1 ? "" : "s"} working` : "No researchers working";
  const sourceDetail = activeMission ? `Persisted local mission ${activeMission.missionId}.` : projection.sourceLabel;

  return <div className={`app ${view === "floor" ? "view-floor" : ""} ${reduced ? "reduced" : ""}`}>
    <header className="topbar">
      <div className="topbar-row">
        <div className="brand"><span className="brand-mark" aria-hidden="true" /><span className="brand-name">DropScope</span><em>Research OS</em></div>
        <div className={`research-navigation ${workspaceOpen ? "is-open" : ""}`} onKeyDown={(event) => { if (event.key === "Escape" && workspaceOpen) { setWorkspaceOpen(false); event.currentTarget.querySelector<HTMLButtonElement>(".workspace-toggle")?.focus(); } }}>
          <button className="workspace-toggle" type="button" aria-controls="research-navigation-links" aria-expanded={workspaceOpen} onClick={() => setWorkspaceOpen((value) => !value)}><span className="ws-label">Workspace </span><span className="ws-current">{currentLabel}</span><CaretDown size={16} aria-hidden="true" /></button>
          <div id="research-navigation-links"><WorkspaceNavigation view={view} onChange={(next) => { setWorkspaceOpen(false); setView(next); }} /></div>
        </div>
        <div className="topbar-spacer" />
        <div className={`live-status ${liveKind}`} aria-live="polite"><span className="dot" aria-hidden="true" /><b>{liveText}</b></div>
        <span className="event-counter" title="Latest recorded event of the replayed history">Event {shownHistory.length} / {history.length}</span>
        <button className="mission-controls-link" type="button" aria-label="Mission controls" aria-controls="mission-controls-panel" aria-expanded={controlsOpen} onClick={() => setControlsOpen((value) => !value)}><span className="mc-full" aria-hidden="true">Mission controls</span><span className="mc-short" aria-hidden="true">Controls</span><CaretDown size={14} aria-hidden="true" /></button>
      </div>
    </header>
    <div className={`source-banner ${runtimeState === "error" && !demoRuntimeUnavailable ? "action-error" : ""}`}>
      <div className="source-banner-row">
        <span className="source-notice"><strong className="source-label">{synthetic ? "Synthetic demo · recorded replay" : "Local history · recorded replay"}</strong><span className="source-copy">{synthetic ? "Illustrative data, not market research." : "Inspect attempt provenance before treating findings as market evidence."}</span></span>
        <details className="source-details"><summary>Source details</summary><p>{sourceDetail} Read-only projection.</p></details>
      </div>
      {view === "floor" && runtimeMessage && <div className="runtime-context" role="status"><strong>{demoRuntimeUnavailable ? "Local runtime is offline. The synthetic demo remains available." : runtimeStatusTitle}</strong><details><summary>Runtime details</summary><p><strong>{runtimeStatusTitle}</strong> {runtimeMessage}</p></details>{showMissionNextActions && <button className="quiet-button" onClick={() => setView("report")}>Read final report</button>}</div>}
    </div>
    <main className="content">
      <section className="command-ribbon" id="mission-controls" aria-label="Local mission controls">
        <section className={`command-panel ${activeMission ? "mission-selected" : "first-mission"}`} id="mission-controls-panel" aria-label={activeMission ? "Mission controls" : "First mission setup"} hidden={!controlsOpen}>
          <div className="runtime-identity"><span>{activeMission ? "Persisted mission source" : "First local mission"}</span><strong>{activeMission ? `Mission ${activeMission.missionId}` : "Record a mission before you inspect it."}</strong><small>{activeMission ? "Read-only projection" : "Choose one fixed fixture. DropScope writes event history locally and keeps policy authority in the engine."}</small></div>
          <div className="runtime-actions"><div className="fixture-field"><label htmlFor="fixture-select">Fixture</label><select id="fixture-select" value={fixtureId} onChange={(event) => setFixtureId(event.currentTarget.value)}>{fixtureIds.map((id) => <option value={id} key={id}>{fixturePresentation[id]?.label ?? id}</option>)}</select><small>{selectedFixture.description}</small></div><div className="runtime-buttons"><button className="primary-action" onClick={() => void launch()} disabled={runtimeState === "loading"}>Launch local mission</button><button onClick={() => void reload()} disabled={runtimeState === "loading"}>Reload saved mission</button></div></div>
          {!activeMission && <><div className="mission-route" aria-label="First mission path"><span><strong>Choose fixture</strong><small>Fixed research scope</small></span><span><strong>Launch locally</strong><small>Replayable event history</small></span><span><strong>Inspect evidence</strong><small>Sources, usage, and policy</small></span><span><strong>Read decision</strong><small>Verdict and next action</small></span></div>{view === "floor" ? <details className="runtime-start-disclosure"><summary>Local setup instructions</summary>{runtimeSetupNote}</details> : runtimeSetupNote}</>}
          <div className="prototype-settings">{previewStates}<button className="quiet-button" onClick={() => setReduced(!reduced)}>{reduced ? "Motion off" : "Reduce motion"}</button></div>
        </section>
        {view !== "floor" && runtimeMessage && <span className={`runtime-message ${runtimeState}`} role="status"><RuntimeStatusIcon size={17} aria-hidden="true" /><span className="runtime-message-copy"><strong>{runtimeStatusTitle}</strong><small>{runtimeMessage}</small></span>{showMissionNextActions && <span className="runtime-next-actions"><button onClick={() => setView("agent")}>Inspect evidence</button><button onClick={() => setView("report")}>Read final report</button></span>}</span>}
      </section>

      <CommandFrame label={view === "floor" ? "Research Office floor" : undefined} floor={view === "floor"} projection={projection} history={shownHistory} onApproval={() => setApprovalOpen((value) => !value)} onNavigate={setView}>
        {view === "floor" ? <ResearchOfficeCenter projection={projection} agents={floorAgents} synthetic={synthetic} onEvidence={() => setView("agent")} onNavigate={setView} onApproval={() => setApprovalOpen((value) => !value)} />
          : view === "report" ? <FinalReport events={activeMission?.events} fixtureId={activeMission?.fixtureId} />
            : view === "replay" ? <MissionReplay scenario={scenario} setScenario={setScenario} activeHistory={activeMission} history={history} position={replayAt} setPosition={setReplayPosition} />
              : <DecisionView projection={projection} history={history} view={view} onSubscriptionPreflight={activeMission ? () => void checkSubscriptionRuntime() : undefined} subscriptionPreflightLoading={subscriptionPreflightLoading} onSubscriptionConfirmation={activeMission ? () => void confirmSubscription() : undefined} subscriptionConfirmationLoading={subscriptionConfirmationLoading} onSubscriptionRun={activeMission ? () => void runSubscription() : undefined} subscriptionRunLoading={subscriptionRunLoading} subscriptionConfirmation={subscriptionConfirmation} subscriptionConfirmationEligible={activeMission?.fixtureId === "live-worker-pilot"} onGoogleTrendsCapture={activeMission ? () => void runGoogleTrendsCapture() : undefined} googleTrendsCaptureLoading={googleTrendsCaptureLoading} googleTrendsCaptureEligible={activeMission?.fixtureId === "google-trends-pilot" && projection.mission.status === "RUNNING"} onGoogleTrendsComparisonImport={activeMission ? (file) => void importGoogleTrendsComparisonCsv(file) : undefined} googleTrendsComparisonImportLoading={googleTrendsComparisonImportLoading} googleTrendsComparisonImportEligible={activeMission?.fixtureId === "google-trends-comparison-pilot" && projection.mission.status === "RUNNING"} />}
      </CommandFrame>      {approvalOpen && status === "BLOCKED" && <div className="approval-note" role="status"><Warning size={17} /><span><strong>Policy block</strong> This replay stopped with unresolved safety evidence. This local disclosure does not change mission data or policy.</span></div>}
    </main>
  </div>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><Theme appearance="light" accentColor="blue" grayColor="slate" radius="small"><Office /></Theme></StrictMode>);
