import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Theme } from "@radix-ui/themes";
import { CaretDown } from "@phosphor-icons/react/dist/csr/CaretDown";
import { CheckCircle } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { Play } from "@phosphor-icons/react/dist/csr/Play";
import { Warning } from "@phosphor-icons/react/dist/csr/Warning";
import "@radix-ui/themes/styles.css";
import "./styles.css";
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
  FinalReport,
  MissionReplay,
  ResearchOffice,
  WorkspaceNavigation,
  type OfficeView,
} from "./editorial-views.js";

type RuntimeState = "idle" | "loading" | "success" | "error";

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
  const [view, setView] = useState<OfficeView>("floor");

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
      })
      .catch((error: unknown) => {
        setRuntimeState("error");
        setRuntimeMessage(error instanceof Error ? error.message : "Could not reload the browser-saved mission.");
      });
  }, []);

  const history = activeMission?.events ?? officeHistories[scenario];
  const projection = projectOffice(history);
  const floorAgents = [...new Map(projection.agents.map((agent) => [agent.id, agent])).values()];
  const status = projection.mission.status;
  const StatusIcon = status === "BLOCKED" ? Warning : status === "COMPLETED" ? CheckCircle : Play;
  const workingAgents = floorAgents.filter((agent) => agent.state === "WORKING").length;
  const floorStatus = status === "BLOCKED" ? "Policy block" : status === "COMPLETED" ? "Mission complete" : "Replay running";

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
      } catch {
        setRuntimeState("success");
        setRuntimeMessage(`Mission ${mission.missionId} launched, but browser storage is unavailable. It will not auto-reload after refresh.`);
      }
    } catch (error: unknown) {
      setRuntimeState("error");
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
    } catch (error: unknown) {
      setRuntimeState("error");
      setRuntimeMessage(error instanceof Error ? error.message : "Could not reload the local mission.");
    }
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

  return <div className={`app ${reduced ? "reduced" : ""}`}>
    <header className="topbar">
      <div className="brand"><b>D</b><span>DropScope</span><em>Research OS</em></div>
      <WorkspaceNavigation view={view} onChange={setView} />
      <div className="topbar-mission">
        <div className="topbar-mission-copy"><span>{projection.mission.phase}</span><strong>{projection.mission.name}</strong></div>
        <button className="mission-controls-link" type="button" aria-controls="mission-controls-panel" aria-expanded={controlsOpen} onClick={() => setControlsOpen((value) => !value)}><span>Mission controls</span><CaretDown size={14} aria-hidden="true" /></button>
      </div>
    </header>
    <main className="content">
      <section className="command-ribbon" id="mission-controls" aria-label="Local mission controls">
        <div className="command-panel" id="mission-controls-panel" hidden={!controlsOpen}>
          <div className="runtime-identity"><span>{activeMission ? "Persisted mission source" : "Synthetic event replay"}</span><strong>{activeMission ? `Mission ${activeMission.missionId}` : "No local mission selected"}</strong><small>Read-only projection</small></div>
          <div className="runtime-actions"><label htmlFor="fixture-select">Fixture</label><select id="fixture-select" value={fixtureId} onChange={(event) => setFixtureId(event.currentTarget.value)}>{fixtureIds.map((id) => <option value={id} key={id}>{id}</option>)}</select><button className="primary-action" onClick={() => void launch()} disabled={runtimeState === "loading"}>Launch local mission</button><button onClick={() => void reload()} disabled={runtimeState === "loading"}>Reload saved mission</button></div>
        </div>
        {runtimeMessage && <span className={`runtime-message ${runtimeState}`} role="status">{runtimeMessage}</span>}
      </section>

      <header className="mission-overview">
        <div className="mission-copy"><span className="section-label">Mission brief</span><h1>{projection.mission.name}</h1><p title={activeMission ? `Persisted local mission ${activeMission.missionId}` : projection.sourceLabel}>{activeMission ? `Persisted local mission ${activeMission.missionId}.` : projection.sourceLabel}</p><div className="mission-meta"><span>{activeMission ? "Local event history" : "Synthetic demo fallback"}</span><span>Read-only projection</span></div></div>
        <div className="mission-state"><span className={`mission-status ${status.toLowerCase()}`}><StatusIcon size={15} />{projection.mission.phase}</span><strong>{floorStatus}</strong><small>{floorAgents.length} assigned workers / {workingAgents} active</small></div>
      </header>

      <div className="scenario-switcher" role="group" aria-label="Replay state"><span>{activeMission ? "Demo fallback" : "Replay state"}</span>{(Object.keys(officeHistories) as OfficeScenario[]).map((name) => <button className={scenario === name ? "selected" : ""} onClick={() => { setScenario(name); setApprovalOpen(false); }} key={name}>{name}</button>)}</div>

      {view === "report" ? <FinalReport events={activeMission?.events} fixtureId={activeMission?.fixtureId} /> : view === "replay" ? <MissionReplay scenario={scenario} setScenario={setScenario} activeHistory={activeMission} /> : <DecisionView projection={projection} view={view} onSubscriptionPreflight={activeMission ? () => void checkSubscriptionRuntime() : undefined} subscriptionPreflightLoading={subscriptionPreflightLoading} onSubscriptionConfirmation={activeMission ? () => void confirmSubscription() : undefined} subscriptionConfirmationLoading={subscriptionConfirmationLoading} onSubscriptionRun={activeMission ? () => void runSubscription() : undefined} subscriptionRunLoading={subscriptionRunLoading} subscriptionConfirmation={subscriptionConfirmation} subscriptionConfirmationEligible={activeMission?.fixtureId === "live-worker-pilot"} onGoogleTrendsCapture={activeMission ? () => void runGoogleTrendsCapture() : undefined} googleTrendsCaptureLoading={googleTrendsCaptureLoading} googleTrendsCaptureEligible={activeMission?.fixtureId === "google-trends-pilot" && projection.mission.status === "RUNNING"} onGoogleTrendsComparisonImport={activeMission ? (file) => void importGoogleTrendsComparisonCsv(file) : undefined} googleTrendsComparisonImportLoading={googleTrendsComparisonImportLoading} googleTrendsComparisonImportEligible={activeMission?.fixtureId === "google-trends-comparison-pilot" && projection.mission.status === "RUNNING"} />}
      {view === "floor" && <ResearchOffice projection={projection} agents={floorAgents} onApproval={() => setApprovalOpen((value) => !value)} reduced={reduced} setReduced={setReduced} />}
      {approvalOpen && status === "BLOCKED" && <div className="approval-note" role="status"><Warning size={17} /><span><strong>Policy block</strong> This replay stopped with unresolved safety evidence. This local disclosure does not change mission data or policy.</span></div>}
    </main>
  </div>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><Theme appearance="dark" accentColor="orange" grayColor="sand" radius="small"><Office /></Theme></StrictMode>);
