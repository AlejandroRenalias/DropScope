import type { MissionEvent } from "../contracts.js";
import type { OfficeProjection } from "./office-projection.js";
import { Radar } from "./radar.js";
import { revisionPath } from "./research-model.js";
import { PageHead } from "./research-office.js";

const dimensions: Record<string, { label: string; short: string }> = {
  sourceIndependence: { label: "Source independence", short: "Sources" },
  decisionCriticalCoverage: { label: "Decision-critical coverage", short: "Coverage" },
  contradictionHandling: { label: "Contradiction handling", short: "Contradictions" },
  claimEvidenceAlignment: { label: "Claim-evidence alignment", short: "Alignment" },
  uncertaintyCalibration: { label: "Uncertainty calibration", short: "Calibration" },
};

function sentence(value: string): string {
  const text = value.replaceAll("_", " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function ReviewOffice({ projection, history }: { projection: OfficeProjection; history: MissionEvent[] }) {
  const office = projection.decisionViews.reviewOffice;
  const path = revisionPath(history);
  const accepted = office?.result.verdict === "ACCEPT";
  const steps = !path.requested && accepted ? path.steps.slice(0, 1) : path.steps;
  const head = (aside?: React.ReactNode) => <PageHead eyebrow="Review Office" title="Blind review record" description="Reviewer ranking, blocking feedback, divergence, and revision response." aside={aside} />;
  if (!office) return <section className="decision-view review-view" aria-label="Review Office">{head()}<section className="panel-card empty-state"><strong>No blind review</strong><p>No BlindReviewCompleted event in this replay.</p></section></section>;

  return <section className="decision-view review-view" aria-label="Review Office">
    {head(<span className={`badge review-verdict ${office.result.verdict === "ACCEPT" ? "ok" : "warn"}`}>Recorded verdict · {office.result.verdict}</span>)}

    {office.result.candidateAssessments.map((assessment) => {
      const rank = office.result.ranking.indexOf(assessment.anonymizedCandidateId) + 1;
      const entries = Object.entries(assessment.dimensionScores);
      const feedback = [...assessment.blockingDefects.map((code) => ({ kind: "defect", text: code })), ...assessment.missingResearchKeys.map((key) => ({ kind: "missing", text: `Missing research: ${key}` }))];
      return <div className="rv-grid" key={assessment.anonymizedCandidateId}>
        <section className="panel-card rv-score" aria-label={`Reviewer score for ${assessment.anonymizedCandidateId}`}>
          <div className="eyebrow">Candidate · {assessment.anonymizedCandidateId}{rank ? ` · rank ${rank}` : ""}</div>
          <div className="rv-score-row"><div className="rv-big">{assessment.reviewerScore}<small> / 100</small></div><div className="rv-badges"><span className={`badge ${assessment.reviewerEligible ? "ok" : "warn"}`}>{assessment.reviewerEligible ? "Eligible" : "Not eligible"}</span><span className="badge">Confidence: {sentence(assessment.confidenceClass)}</span></div></div>
          <Radar axes={entries.map(([key, value]) => ({ label: dimensions[key]?.short ?? key, value }))} margin={55} caption={`Review profile: ${entries.map(([key, value]) => `${dimensions[key]?.label ?? key} ${value}`).join(", ")}`} />
        </section>
        <section className="panel-card rv-dims" aria-label={`Review detail for ${assessment.anonymizedCandidateId}`}>
          <div className="eyebrow">Dimension scores</div>
          <dl className="rv-dimlist">{entries.map(([key, value]) => <div key={key}><dt>{dimensions[key]?.label ?? key}</dt><dd><span className="rv-bar"><i style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></span><b>{value}</b></dd></div>)}</dl>
          <div className="eyebrow rv-gap">Blocking feedback</div>
          <ul className="rv-flags">
            {feedback.length ? feedback.map((item) => <li key={item.text} className="flag"><b aria-hidden="true">!</b><span>{item.text}</span></li>) : <li className="flag ok"><b aria-hidden="true">✓</b><span>No blocking feedback.</span></li>}
            {office.divergences.length ? office.divergences.map((item) => <li key={item} className="flag"><b aria-hidden="true">≠</b><span>Divergence: {item}</span></li>) : <li className="flag ok"><b aria-hidden="true">✓</b><span>Divergences: none recorded in this replay.</span></li>}
          </ul>
        </section>
      </div>;
    })}

    <section className="panel-card rv-path" aria-labelledby="rv-path-title">
      <div className="eyebrow" id="rv-path-title">Revision path</div>
      <ol className="steps">{steps.map((step) => <li key={step.label} className={step.state} aria-current={step.state === "current" ? "step" : undefined}>{step.label}</li>)}</ol>
      <p className="rv-note">{office.revisionResponse ?? (path.requested ? "Revision requested; response is still pending." : accepted ? "No revision was needed for this review." : "A revision has not been requested yet.")}</p>
    </section>
  </section>;
}
