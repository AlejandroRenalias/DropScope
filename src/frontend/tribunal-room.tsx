import type { OfficeProjection } from "./office-projection.js";
import { scaleAngle } from "./research-model.js";
import { PageHead } from "./research-office.js";

function Scale({ venture, ruin }: { venture: number; ruin: number }) {
  const angle = scaleAngle(venture, ruin);
  const radians = (angle * Math.PI) / 180;
  const cx = 70; const cy = 34; const half = 54;
  const left = { x: cx - half * Math.cos(radians), y: cy - half * Math.sin(radians) };
  const right = { x: cx + half * Math.cos(radians), y: cy + half * Math.sin(radians) };
  const pan = (end: { x: number; y: number }, filled: boolean) => <g key={end.x}>
    <line x1={end.x} y1={end.y} x2={end.x - 18} y2={end.y + 34} className="scale-string" />
    <line x1={end.x} y1={end.y} x2={end.x + 18} y2={end.y + 34} className="scale-string" />
    <path d={`M${end.x - 24} ${end.y + 34} h48 a24 12 0 0 1 -48 0 z`} className={filled ? "scale-pan heavy" : "scale-pan"} />
  </g>;
  return <svg className="scale" viewBox="0 0 140 112" role="img" aria-label={`Scale: ${venture} venture claim${venture === 1 ? "" : "s"} against ${ruin} ruin claim${ruin === 1 ? "" : "s"}`}>
    <line x1={cx} y1={cy} x2={cx} y2="98" className="scale-post" />
    <line x1="48" y1="100" x2="92" y2="100" className="scale-post" />
    <line x1={left.x} y1={left.y} x2={right.x} y2={right.y} className="scale-beam" />
    <circle cx={cx} cy={cy} r="4" className="scale-pivot" />
    {pan(left, venture >= ruin)}
    {pan(right, ruin > venture)}
  </svg>;
}

export function TribunalRoom({ projection }: { projection: OfficeProjection }) {
  const room = projection.decisionViews.tribunalRoom;
  const head = (aside?: React.ReactNode) => <PageHead eyebrow="Tribunal Room" title="Recorded policy result" description="Compare the venture case, ruin case, and deterministic recommendation." aside={aside} />;
  if (!room) return <section className="decision-view tribunal-view" aria-label="Tribunal Room">{head()}<section className="panel-card empty-state"><strong>No tribunal result</strong><p>No TribunalCompleted event in this replay.</p></section></section>;

  const { result } = room;
  const tone = result.recommendation === "STOP" ? "stop" : result.recommendation === "CAUTION" ? "caution" : "go";
  const riskCodes = [...new Set(result.reasons.flatMap((reason) => reason.riskReasonCodes))];
  return <section className="decision-view tribunal-view" aria-label="Tribunal Room">
    {head(<span className="badge">Recorded at event {room.recordedAtSequence}</span>)}

    <div className="court">
      <section className="side venture" aria-labelledby="venture-title">
        <div className="eyebrow">Argument 01</div>
        <h2 id="venture-title">Venture case</h2>
        {result.ventureClaimIds.length ? <ul className="claims">{result.ventureClaimIds.map((id) => <li key={id}><span className="mono">{id}</span></li>)}</ul> : <p className="court-empty">No venture claims recorded.</p>}
        <small className="court-count">{result.ventureClaimIds.length} claim{result.ventureClaimIds.length === 1 ? "" : "s"} in favour</small>
      </section>

      <div className="verdict-column">
        <Scale venture={result.ventureClaimIds.length} ruin={result.ruinClaimIds.length} />
        <div className={`verdict-pill ${tone}`}><span>Recommendation</span><strong>{result.recommendation.replaceAll("_", " ")}</strong></div>
        <small>Deterministic policy {result.decidedByPolicyVersion}</small>
      </div>

      <section className="side ruin" aria-labelledby="ruin-title">
        <div className="eyebrow">Argument 02</div>
        <h2 id="ruin-title">Ruin case</h2>
        {result.ruinClaimIds.length ? <ul className="claims">{result.ruinClaimIds.map((id) => <li key={id}><span className="mono">{id}</span></li>)}</ul> : <p className="court-empty">No ruin claims recorded.</p>}
        <small className="court-count">{result.ruinClaimIds.length} claim{result.ruinClaimIds.length === 1 ? "" : "s"} against</small>
        <div className="risk-codes"><span className="eyebrow">Risk-gate reasons</span>{riskCodes.length ? <span className="code-list">{riskCodes.map((code) => <em key={code}>{code}</em>)}</span> : <small>None recorded for this candidate.</small>}</div>
      </section>
    </div>

    <section className="panel-card reasoning" aria-labelledby="reasoning-title">
      <div className="eyebrow" id="reasoning-title">Decision basis</div>
      <h2>Recorded reasoning</h2>
      {result.reasons.length ? <ol className="reason-list">{result.reasons.map((reason) => <li key={reason.code}>
        <span className="mono code">{reason.code}</span>
        <p>{reason.explanation}</p>
        {(reason.claimIds.length > 0 || reason.evidenceIds.length > 0) && <span className="links">{reason.claimIds.map((id) => <em key={`c-${id}`}>claim {id}</em>)}{reason.evidenceIds.map((id) => <em key={`e-${id}`}>evidence {id}</em>)}</span>}
      </li>)}</ol> : <p className="court-empty">No reasons were recorded.</p>}
      <p className="tribunal-meta">Candidate <b className="mono">{result.candidateId}</b> · tribunal <span className="mono">{result.tribunalId}</span></p>
    </section>
  </section>;
}
