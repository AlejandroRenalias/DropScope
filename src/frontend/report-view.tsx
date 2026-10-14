import { Check } from "@phosphor-icons/react/dist/csr/Check";
import { GoogleTrendsComparisonTimeline } from "./google-trends-comparison-timeline.js";
import { projectFinalReport, type FinalReportProjection } from "./office-projection.js";
import { PageHead } from "./research-office.js";
import { Radar } from "./radar.js";
import type { LocalMissionDto } from "./runtime-client.js";

function sentence(value: string): string {
  const text = value.replaceAll("_", " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function ReportContext({ title, copy, note, items }: { title: string; copy: string; note?: string; items: string[] }) {
  return <section className="panel-card report-context"><h2>{title}</h2><p>{copy}</p>{note && <small>{note}</small>}<ul>{items.map((item) => <li key={item}>{item}</li>)}</ul></section>;
}

function Hero({ report }: { report: FinalReportProjection }) {
  const leader = report.priorities[0];
  const headline = leader ? `${leader.candidateId} leads the priorities.` : "No candidate cleared the gates.";
  const lead = leader
    ? `Highest recorded research-priority score of ${report.priorities.length} candidate${report.priorities.length === 1 ? "" : "s"} that cleared the evidence gates.`
    : "None of the recorded candidates cleared the evidence and safety gates.";
  return <article className="rp-hero" aria-label="Report headline">
    <div className="rp-top"><span>{leader ? "Research priority #1" : "Outcome"}</span><span>Reviewer verdict · {sentence(report.reviewerVerdict)}</span></div>
    <h2>{headline}</h2>
    <p>{lead}</p>
    <div className="rp-pills">
      <div><span>{leader ? "Priority score" : "Priority score"}</span><b>{leader ? leader.researchPriorityScore : "None"}</b></div>
      <div><span>Safety gate</span><b>{sentence(report.safetyGate)}</b></div>
      <div><span>Evidence quality</span><b>{report.evidenceQuality} / 100</b></div>
      <div><span>Held out</span><b>{report.heldOut.length} candidate{report.heldOut.length === 1 ? "" : "s"}</b></div>
    </div>
  </article>;
}

export function FinalReport({ events, fixtureId }: { events?: LocalMissionDto["events"]; fixtureId?: string }) {
  const report = projectFinalReport(events, fixtureId);
  const title = report.autopsy ? "Failure Autopsy" : report.investigation ? "Product Investigation" : "Recorded opportunity priorities";
  const axes = [
    { label: "Customer problem", value: report.customerProblemEvidence },
    { label: "Evidence quality", value: report.evidenceQuality },
    { label: "Trend durability", value: report.trendDurability },
    { label: "Low ad saturation", value: 100 - report.advertisingSaturation },
    { label: "Low ops risk", value: 100 - report.operationalRisk },
    { label: "Low failure risk", value: 100 - report.failureRisk },
  ];
  const outcomeTone = report.outcome === "RANKED" ? "ok" : "warn";
  return <section className="decision-view report-view" aria-label="Final Report">
    <PageHead eyebrow="Final report" title={title} description={report.sourceLabel} aside={<span className={`badge ${outcomeTone}`}>{sentence(report.outcome)}</span>} />
    <Hero report={report} />

    <div className="rp-grid">
      <section className="panel-card" aria-labelledby="rp-priority-title">
        <div className="eyebrow" id="rp-priority-title">Priority order</div>
        {report.priorities.length ? <ol className="rp-rank">{report.priorities.slice(0, 5).map((candidate, index) => <li key={candidate.candidateId}><span className="rp-n">{index + 1}</span><div><strong>{candidate.candidateId}</strong><div className="rp-bar"><i style={{ width: `${Math.max(0, Math.min(100, candidate.researchPriorityScore))}%` }} /></div></div><b>{candidate.researchPriorityScore}</b></li>)}</ol> : <p className="rp-empty">None cleared the recorded evidence gates.</p>}
        <div className="eyebrow rp-gap">Held out</div>
        {report.heldOut.length ? <ul className="rp-held">{report.heldOut.map((candidate) => <li key={candidate.candidateId}><strong>{candidate.candidateId}</strong><span>{candidate.reasonCodes.map((code) => <em key={code} title={code}>{sentence(code)}</em>)}</span></li>)}</ul> : <p className="rp-empty">No held-out candidates in this report.</p>}
      </section>

      <section className="panel-card" aria-labelledby="rp-profile-title">
        <div className="eyebrow" id="rp-profile-title">Score profile{report.priorities[0] ? ` · ${report.priorities[0].candidateId}` : ""}</div>
        <Radar axes={axes} caption={`Score profile: ${axes.map((axis) => `${axis.label} ${axis.value}`).join(", ")}`} />
        <p className="rp-note">Risk and saturation axes are inverted, so a larger area is better. Scores are out of 100.</p>
        <div className="rp-vs">
          <div className="pro"><h3>Supporting evidence</h3><ul>{report.evidenceSummary.supporting.map((item) => <li key={item}>{item}</li>)}</ul></div>
          <div className="con"><h3>Opposing pressure</h3><ul>{report.evidenceSummary.opposing.map((item) => <li key={item}>{item}</li>)}</ul></div>
        </div>
      </section>
    </div>

    {report.autopsy && <ReportContext title="What would change this conclusion" copy={report.autopsy.conclusion} items={report.autopsy.evidenceThatCouldChangeConclusion} />}
    {report.investigation && <ReportContext title="Automatic failure-autopsy pressure" copy={report.investigation.autopsyConclusion} items={report.investigation.opposingEvidence} />}
    {report.externalSignalContext && <ReportContext title="External signal context · not scored" copy="Google Trends US Trending Now is a sampled, normalized search-interest snapshot. It does not change any score, ranking, gate, or recommendation in this report." note={`Source: ${report.externalSignalContext.sourceUrl} · retrieved ${new Date(report.externalSignalContext.retrievedAt).toLocaleString()} · attribution: ${report.externalSignalContext.attribution}.`} items={report.externalSignalContext.items.map((item) => `${item.query} · ${item.traffic}`)} />}
    {report.comparisonSignalContext && <section className="panel-card report-context"><h2>Manual comparison context · not scored</h2><p>Google Trends Interest over time for the approved US comparison is replayed as context only. It does not change any score, ranking, gate, or recommendation in this report.</p><small>US · Web Search · past 12 months · imported {new Date(report.comparisonSignalContext.importedAt).toLocaleString()} · {report.comparisonSignalContext.granularity.toLowerCase()} periods.</small><GoogleTrendsComparisonTimeline evidence={report.comparisonSignalContext} /><ul>{report.comparisonSignalContext.series.map((series) => <li key={series.term}>{series.term} · {series.values.length} normalized points</li>)}</ul></section>}

    <div className="rp-next"><span className="hex-mark"><Check size={18} weight="bold" aria-hidden /></span><div><strong>Next step</strong><span>{report.nextStep}</span></div></div>
  </section>;
}
