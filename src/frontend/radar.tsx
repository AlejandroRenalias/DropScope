/** Radar profile. Risk-like scores are inverted by the caller so a larger area is always better. */
export function Radar({ axes, caption, margin = 85 }: { axes: Array<{ label: string; value: number }>; caption: string; margin?: number }) {
  const size = 320; const centre = size / 2; const radius = size / 2 - 58; const count = axes.length;
  const point = (index: number, scale: number) => { const angle = -Math.PI / 2 + (2 * Math.PI * index) / count; return [centre + Math.cos(angle) * radius * scale, centre + Math.sin(angle) * radius * scale] as const; };
  const ring = (scale: number) => axes.map((_, index) => point(index, scale).join(",")).join(" ");
  const shape = axes.map((axis, index) => point(index, Math.max(0, Math.min(100, axis.value)) / 100).join(",")).join(" ");
  return <svg className="radar" viewBox={`${-margin} 0 ${size + 2 * margin} ${size}`} role="img" aria-label={caption}>
    {[0.25, 0.5, 0.75, 1].map((scale) => <polygon key={scale} points={ring(scale)} className="radar-ring" />)}
    {axes.map((_, index) => { const [x, y] = point(index, 1); return <line key={index} x1={centre} y1={centre} x2={x} y2={y} className="radar-axis" />; })}
    <polygon points={shape} className="radar-shape" />
    {axes.map((axis, index) => { const [x, y] = point(index, Math.max(0, Math.min(100, axis.value)) / 100); return <circle key={axis.label} cx={x} cy={y} r="4.5" className="radar-dot" />; })}
    {axes.map((axis, index) => { const [x, y] = point(index, 1.2); const anchor = x < centre - 8 ? "end" : x > centre + 8 ? "start" : "middle"; return <text key={axis.label} x={x} y={y + 5} textAnchor={anchor} className="radar-label">{axis.label}</text>; })}
  </svg>;
}
