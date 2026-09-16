import type { GoogleTrendsComparisonEvidence } from "../contracts.js";

const WIDTH = 520;
const HEIGHT = 150;
const PADDING_X = 8;
const PADDING_Y = 12;
const COLORS = ["#79d4d7", "#e1b366", "#b79be8"] as const;

export function buildComparisonTimelinePath(values: readonly number[], width = WIDTH, height = HEIGHT): string {
  if (values.length === 0) return "";
  const innerWidth = Math.max(1, width - PADDING_X * 2);
  const innerHeight = Math.max(1, height - PADDING_Y * 2);
  return values.map((value, index) => {
    const x = PADDING_X + (values.length === 1 ? innerWidth / 2 : (index / (values.length - 1)) * innerWidth);
    const y = PADDING_Y + (1 - value / 100) * innerHeight;
    return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
}

export function GoogleTrendsComparisonTimeline({ evidence }: { evidence: GoogleTrendsComparisonEvidence | null }) {
  if (!evidence) return null;
  return <figure className="comparison-timeline" aria-label={`Google Trends comparison timeline, ${evidence.periods.length} ${evidence.granularity.toLowerCase()} periods, context only`}>
    <div className="comparison-timeline-heading"><strong>Interest over time</strong><span>{evidence.periods.length} {evidence.granularity.toLowerCase()} periods · context only · not scored</span></div>
    <svg className="comparison-timeline-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Normalized Google Trends lines from 0 to 100">
      <line x1={PADDING_X} y1={PADDING_Y} x2={WIDTH - PADDING_X} y2={PADDING_Y} className="comparison-timeline-gridline" />
      <line x1={PADDING_X} y1={HEIGHT - PADDING_Y} x2={WIDTH - PADDING_X} y2={HEIGHT - PADDING_Y} className="comparison-timeline-gridline" />
      {evidence.series.map((series, index) => <path key={series.term} d={buildComparisonTimelinePath(series.values)} className="comparison-timeline-line" style={{ stroke: COLORS[index] }} aria-label={`${series.term}: ${series.values.join(", ")}`} />)}
    </svg>
    <figcaption className="comparison-timeline-legend">{evidence.series.map((series, index) => <span key={series.term}><i style={{ backgroundColor: COLORS[index] }} />{series.term}</span>)}</figcaption>
  </figure>;
}
